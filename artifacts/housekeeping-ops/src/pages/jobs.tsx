import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useSearch } from 'wouter';
import { 
  useListJobs, useCreateJob, useGetJob, useUpdateJob, useUpdateJobChecklist, 
  useSendJobMessage, useListEmployees, useListJobMessages, useListCustomers, useListCustomerAddresses,
  useGetElevateImportStatus, getGetElevateImportStatusQueryKey,
  getListJobsQueryKey, getGetJobQueryKey, getGetDashboardSummaryQueryKey, getListJobMessagesQueryKey,
  useListJobReminders, useCreateJobReminder, getListJobRemindersQueryKey,
  useListNotifications, getListNotificationsQueryKey
} from '@workspace/api-client-react';
import type { Job } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Search, ChevronRight, ClipboardCheck, MapPin, Check, MessageSquare, Phone, CheckCircle2, Send, X, ArrowRight, AlertTriangle, LoaderCircle, RefreshCw, Edit2 } from 'lucide-react';
import { ADD_ON_OPTIONS, addOnTotals, money } from '@/lib/pricing';
import { LoadingState, ErrorState, EmptyState, PageIntro, Badge, Avatar, statusTone, statusLabel, formatDate, formatTime, todayISO } from '@/lib/shared';

const SERVICE_OPTIONS = ['Standard cleaning', 'Deep cleaning', 'Move In/Out cleaning'];

type NewJobForm = {
  clientName: string;
  address: string;
  scheduledDate: string;
  startTime: string;
  endTime: string;
  serviceType: string;
  serviceVariant: string;
  addOns: string[];
  durationMinutes: number;
  frequency: string;
  notes: string;
  clientPhone: string;
  teamMemberIds: number[];
  employeeIds: number[];
};

export function Jobs() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const jobs = useListJobs();
  const elevate = useGetElevateImportStatus({ query: { queryKey: getGetElevateImportStatusQueryKey(), refetchInterval: 30_000 } });
  const create = useCreateJob();
  const queryClient = useQueryClient();
  const lastImportEvent = useRef<number | null>(null);
  
  const notifications = useListNotifications({ limit: 30 }, { query: { queryKey: getListNotificationsQueryKey({ limit: 30 }), refetchInterval: 30_000 } });
  const jobsWithUnreadMessages = new Set(
    (notifications.data || []).filter((item) => item.kind === 'message' && !item.readAt && item.jobId).map((item) => item.jobId),
  );

  const [query, setQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Called directly rather than through a generated hook: the endpoint is newer than the
  // last codegen run. Swap to useSyncElevateMailbox once the client is regenerated.
  const runMailboxSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const response = await fetch('/api/integrations/elevate/gmail-sync', { method: 'POST', headers: { accept: 'application/json' } });
      // Read as text first: an empty or non-JSON body (a proxy error page, a redirect) made
      // response.json() throw a browser-level message that described nothing.
      const raw = await response.text();
      let result: any = null;
      try { result = raw ? JSON.parse(raw) : null; } catch { /* handled below */ }
      if (!response.ok || !result) {
        throw new Error(result?.detail ?? result?.error ?? `HTTP ${response.status} ${response.statusText}${raw ? ` — ${raw.slice(0, 200)}` : ' — empty response'}`);
      }
      const problems = (result.problems ?? []) as string[];
      setSyncResult(
        `${result.created} new job${result.created === 1 ? '' : 's'} imported from ${result.scanned} email${result.scanned === 1 ? '' : 's'}`
        + (result.alreadyImported ? `, ${result.alreadyImported} already here` : '')
        + (result.skippedPast ? `, ${result.skippedPast} skipped as past` : '')
        + (problems.length ? `. ${problems.length} could not be read: ${problems[0]}` : '.')
        + (result.serverStartedAt ? ` (API started ${new Date(result.serverStartedAt).toLocaleTimeString()})` : ' (API build predates this check — restart the API workflow)'),
      );
      void queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
      void elevate.refetch();
    } catch (error) {
      setSyncResult(`Could not read the Elevate mailbox. ${error instanceof Error ? error.message : ''}`.trim());
    } finally {
      setSyncing(false);
    }
  };
  const [filter, setFilter] = useState(() => new URLSearchParams(window.location.search).get('filter') || 'all');

  // wouter's location is the pathname only — the query string lives in useSearch().
  const params = new URLSearchParams(search);
  const selectedId = Number(params.get('job')) || null;
  const requestedNew = params.get('new') === '1';
  const requestedDate = params.get('date') || undefined;
  const [asOverlay, setAsOverlay] = useState(() => window.matchMedia('(max-width: 1050px)').matches);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1050px)');
    const sync = (event: MediaQueryListEvent) => setAsOverlay(event.matches);
    mediaQuery.addEventListener('change', sync);
    return () => mediaQuery.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (requestedNew) setShowCreate(true);
  }, [requestedNew]);

  const closeCreate = () => {
    setShowCreate(false);
    if (requestedNew) setLocation('/jobs');
  };

  useEffect(() => {
    const newestEvent = elevate.data?.recentEvents?.[0]?.id;
    if (!newestEvent) return;
    if (lastImportEvent.current !== null && newestEvent !== lastImportEvent.current) {
      void queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    }
    lastImportEvent.current = newestEvent;
  }, [elevate.data?.recentEvents, queryClient]);
  
  if (jobs.isLoading) return <LoadingState label="Loading jobs" />;
  if (jobs.isError) return <ErrorState onRetry={() => void jobs.refetch()} />;
  
  const matchesFilter = (job: Job) => filter === 'all' || (filter === 'unassigned' ? !job.team?.length : job.status === filter);
  const filtered = (jobs.data || []).filter((job) => matchesFilter(job) && `${job.clientName} ${job.address} ${job.serviceType}`.toLowerCase().includes(query.toLowerCase()));
  const selectedJob = selectedId ? (jobs.data || []).find((j) => j.id === selectedId) : null;
  
  const submitCreate = (data: NewJobForm) => {
    create.mutate({ data }, { onSuccess: () => { closeCreate(); void queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() }); } });
  };
  
  return (
    <div className="content-stack">
      <PageIntro eyebrow="Work orders" title="Jobs" body="Every visit, one clear owner, no lost context." action={<button className="button button-primary" onClick={() => setShowCreate(true)} data-testid="button-create-job"><Plus size={16} />Create job</button>} />

      <section className={`panel import-status ${elevate.data?.failedCount ? 'import-status-warning' : ''}`} data-testid="elevate-import-status">
        <div className="import-status-main">
          <span className={`import-mark ${elevate.data?.failedCount ? 'import-mark-warning' : ''}`}>
            {elevate.isFetching ? <LoaderCircle size={17} className="spin" /> : elevate.data?.failedCount ? <AlertTriangle size={17} /> : <RefreshCw size={17} />}
          </span>
          <div>
            <span className="eyebrow">Elevate OS automation</span>
            <strong>{elevate.isError ? 'Import status unavailable' : elevate.data?.failedCount ? `${elevate.data.failedCount} failed deliver${elevate.data.failedCount === 1 ? 'y' : 'ies'} recorded` : 'Appointments import automatically'}</strong>
            <p>{elevate.isError ? 'Mawii could not load the delivery history. Try again to confirm new appointments are arriving.' : elevate.data?.lastReceivedAt ? `Last delivery ${formatDate(elevate.data.lastReceivedAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${elevate.data.totalReceived} received` : 'Ready for the GoHighLevel workflow webhook. New and updated appointment deliveries are deduplicated by appointment ID.'}</p>
          </div>
        </div>
        {elevate.data?.recentEvents?.length ? (
          <div className="import-events">
            {elevate.data.recentEvents.slice(0, 3).map((event) => (
              <div key={event.id} className={event.success ? 'import-event-ok' : 'import-event-failed'}>
                <span>{event.success ? event.duplicate ? 'Updated' : 'Imported' : 'Failed'}</span>
                <strong>{event.externalId || 'Unknown appointment'}</strong>
                <small>{event.message}</small>
              </div>
            ))}
          </div>
        ) : null}
        <div className="team-actions">
          <button className="button button-primary" onClick={() => void runMailboxSync()} disabled={syncing} data-testid="button-sync-elevate-mailbox">
            {syncing ? <><LoaderCircle size={14} className="spin" />Checking…</> : <><RefreshCw size={14} />Check Elevate email</>}
          </button>

        </div>
        {syncResult ? <p className={syncResult.startsWith('Could not') ? 'form-error' : 'muted-copy'} data-testid="text-sync-result">{syncResult}</p> : null}
      </section>
      
      <section className="panel jobs-toolbar">
        <div className="search-wrap">
          <Search size={17} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search client, address, or service" data-testid="input-search-jobs" />
        </div>
        <div className="filter-tabs">
          {['all', 'unassigned', 'scheduled', 'in_progress', 'attention', 'completed'].map((value) => (
            <button key={value} className={filter === value ? 'filter-active' : ''} onClick={() => setFilter(value)} data-testid={`button-filter-${value}`}>
              {value === 'all' ? 'All jobs' : value === 'unassigned' ? 'Needs crew' : statusLabel(value)}
            </button>
          ))}
        </div>
        <span className="job-total mono">{filtered.length} shown</span>
      </section>
      
      {filtered.length ? (
        <div className="jobs-layout">
          <section className="job-list" data-testid="job-list">
            {filtered.map((job) => (
              <button className={`job-list-row ${selectedId === job.id ? 'job-selected' : ''}`} key={job.id} onClick={() => setLocation(`/jobs?job=${job.id}`)} data-testid={`button-job-row-${job.id}`}>
                <span className={`job-status-bar bar-${job.status}`} />
                <div className="job-list-main">
                  <div className="job-title-line">
                    <strong>{job.clientName}</strong>
                    {jobsWithUnreadMessages.has(job.id) ? <span className="unread-flag" data-testid={`unread-job-${job.id}`}>New message</span> : null}
                    <Badge tone={statusTone(job.status)}>{statusLabel(job.status)}</Badge>
                  </div>
                  <span><MapPin size={13} />{job.address}</span>
                  <small>{job.serviceType} · {formatDate(job.scheduledDate)} · {formatTime(job.startTime)}</small>
                </div>
                <div className="job-list-team">
                  {job.team?.slice(0, 3).map((member) => <Avatar key={member.id} member={member} size="sm" />)}
                </div>
                <ChevronRight size={16} className="row-chevron" />
              </button>
            ))}
          </section>
          
          {selectedJob ? (
            asOverlay ? (
              <div className="modal-scrim" onClick={() => setLocation('/jobs')}>
                <div className="detail-overlay" onClick={(e) => e.stopPropagation()}>
                  <button className="icon-button detail-overlay-close" onClick={() => setLocation('/jobs')} aria-label="Close job" data-testid="button-close-job-detail"><X size={17} /></button>
                  <JobDetail job={selectedJob} />
                </div>
              </div>
            ) : <JobDetail job={selectedJob} />
          ) : (
            <div className="panel detail-placeholder dot-grid">
              <ClipboardCheck size={28} />
              <strong>Select a job</strong>
              <span>Open a work order to review its team, checklist, and proof trail.</span>
            </div>
          )}
        </div>
      ) : (
        <EmptyState title="No jobs match that view" body="Try clearing the search or changing the status filter." action={<button className="button button-secondary" onClick={() => { setQuery(''); setFilter('all'); }} data-testid="button-clear-job-filters">Clear filters</button>} />
      )}
      
      {showCreate && <CreateJobDialog pending={create.isPending} failed={create.isError} initialDate={requestedDate} onClose={closeCreate} onSubmit={submitCreate} />}
    </div>
  );
}

function EditJobDialog({ job, onClose, onSubmit, pending, failed }: { job: Job; onClose: () => void; onSubmit: (data: Record<string, unknown>) => void; pending: boolean; failed?: boolean }) {
  const [form, setForm] = useState({
    scheduledDate: job.scheduledDate,
    startTime: job.startTime,
    endTime: job.endTime,
    serviceType: job.serviceType,
    serviceVariant: job.serviceVariant || '',
    durationMinutes: job.durationMinutes ?? 180,
    addOns: job.addOns || [],
    employeeIds: job.assignedEmployees?.map((member) => member.id) ?? [],
  });
  const employees = useListEmployees();

  const toggleAddOn = (addOn: string) => setForm((current) => ({ ...current, addOns: current.addOns.includes(addOn) ? current.addOns.filter((item) => item !== addOn) : [...current.addOns, addOn] }));
  const toggleEmployee = (id: number) => setForm((current) => ({ ...current, employeeIds: current.employeeIds.includes(id) ? current.employeeIds.filter((item) => item !== id) : [...current.employeeIds, id] }));

  return (
    <div className="modal-scrim" onClick={onClose}>
      <form className="modal panel" onClick={(e) => e.stopPropagation()} onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(form); }}>
        <div className="modal-head">
          <div><span className="eyebrow">Work order</span><h3>Edit job</h3></div>
          <button type="button" className="icon-button" onClick={onClose} data-testid="button-close-edit-job"><X size={17} /></button>
        </div>
        <div className="form-grid">
          <label>Date<input type="date" required value={form.scheduledDate} onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} data-testid="input-edit-date" /></label>
          <label>Duration (minutes)<input type="number" min={30} step={30} value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })} data-testid="input-edit-duration" /></label>
          <label>Start<input type="time" required value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} data-testid="input-edit-start" /></label>
          <label>End<input type="time" required value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} data-testid="input-edit-end" /></label>
          <label>Service<select value={form.serviceType} onChange={(e) => setForm({ ...form, serviceType: e.target.value })} data-testid="select-edit-service">
            {SERVICE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select></label>
          <label>Variant<input value={form.serviceVariant} onChange={(e) => setForm({ ...form, serviceVariant: e.target.value })} data-testid="input-edit-variant" /></label>
          <fieldset className="span-2 add-on-field">
            <legend>Add-ons{addOnTotals(form.addOns).count ? ` · +${addOnTotals(form.addOns).minutes} min · ${money(addOnTotals(form.addOns).amount)}` : ""}</legend>
            <div>
              {ADD_ON_OPTIONS.map((addOn) => (
                <label key={addOn}><input type="checkbox" checked={form.addOns.includes(addOn)} onChange={() => toggleAddOn(addOn)} />{addOn}</label>
              ))}
            </div>
          </fieldset>
          <fieldset className="span-2 add-on-field">
            <legend>Assigned team</legend>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {(employees.data || []).map((employee) => (
                <label key={employee.id}>
                  <input type="checkbox" checked={form.employeeIds.includes(employee.id)} onChange={() => toggleEmployee(employee.id)} data-testid={`checkbox-edit-employee-${employee.id}`} />
                  {employee.name} · {employee.role}
                </label>
              ))}
              {!(employees.data || []).length && <span className="muted-copy">No employees available.</span>}
            </div>
          </fieldset>
        </div>
        {failed ? <p className="form-error">That change could not be saved. Check your connection and try again.</p> : null}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onClose}>Cancel</button>
          <button className="button button-primary" disabled={pending} data-testid="button-save-job-edit">{pending ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </div>
  );
}

export function CreateJobDialog({ onClose, onSubmit, pending, initialDate, failed }: { onClose: () => void; onSubmit: (data: NewJobForm) => void; pending: boolean; initialDate?: string; failed?: boolean }) {
  const employees = useListEmployees();
  const customers = useListCustomers();
  const [form, setForm] = useState({ clientName: '', address: '', scheduledDate: initialDate || todayISO(), startTime: '09:00', endTime: '12:00', serviceType: 'Standard cleaning', serviceVariant: '2 bed / 2 bath Standard', addOns: [] as string[], durationMinutes: 180, frequency: 'Every 4 weeks', notes: '', clientPhone: '', teamMemberIds: [] as number[], employeeIds: [] as number[], customerId: '', addressId: '' });
  
  const selectedCustomerId = Number(form.customerId);
  const addresses = useListCustomerAddresses(selectedCustomerId, { query: { enabled: !!selectedCustomerId, queryKey: ['addresses', selectedCustomerId] } });
  const knownAddresses = useListJobs();
  const [unit, setUnit] = useState({ type: 'house', building: '', number: '' });

  const addressSuggestions = Array.from(new Set((knownAddresses.data || []).map((job) => job.address).filter(Boolean)));
  const fullAddress = unit.type === 'apartment'
    ? [form.address, unit.building && `Bldg ${unit.building}`, unit.number && `Apt ${unit.number}`].filter(Boolean).join(', ')
    : form.address;

  const update = (key: keyof typeof form, value: any) => setForm((current) => ({ ...current, [key]: value }));
  const toggleAddOn = (addOn: string) => setForm((current) => ({ ...current, addOns: current.addOns.includes(addOn) ? current.addOns.filter((item) => item !== addOn) : [...current.addOns, addOn] }));
  
  const handleEmployeeToggle = (id: number) => {
    setForm(current => ({
      ...current,
      employeeIds: current.employeeIds.includes(id)
        ? current.employeeIds.filter(employeeId => employeeId !== id)
        : [...current.employeeIds, id]
    }));
  };
  
  const handleCustomerChange = (id: string) => {
    const cust = (customers.data || []).find(c => c.id.toString() === id);
    if (cust) {
      setForm(f => ({ ...f, customerId: id, clientName: cust.name, clientPhone: cust.phone || f.clientPhone, addressId: '', address: '' }));
    } else {
      setForm(f => ({ ...f, customerId: '', addressId: '' }));
    }
  };
  
  const handleAddressChange = (id: string) => {
    const addr = (addresses.data || []).find(a => a.id.toString() === id);
    if (addr) {
      const addressString = `${addr.line1}${addr.line2 ? `, ${addr.line2}` : ''}, ${addr.city}, ${addr.state} ${addr.postalCode}`;
      setForm(f => ({ ...f, addressId: id, address: addressString }));
    } else {
      setForm(f => ({ ...f, addressId: '' }));
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <form className="modal panel" onClick={(e) => e.stopPropagation()} onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit({ ...form, address: fullAddress }); }}>
        <div className="modal-head">
          <div><span className="eyebrow">Work order</span><h3>Add a job</h3></div>
          <button type="button" className="icon-button" onClick={onClose} data-testid="button-close-create-job"><X size={17} /></button>
        </div>
        <div className="form-grid">
          <label className="span-2">Select existing customer (optional)
            <select value={form.customerId} onChange={e => handleCustomerChange(e.target.value)}>
              <option value="">-- New or unlinked client --</option>
              {(customers.data || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {form.customerId && (
            <label className="span-2">Select existing address (optional)
              <select value={form.addressId} onChange={e => handleAddressChange(e.target.value)}>
                <option value="">-- Enter manually --</option>
                {(addresses.data || []).map(a => <option key={a.id} value={a.id}>{a.line1}</option>)}
              </select>
            </label>
          )}
          
          <div className="span-2" style={{ borderTop: '1px solid hsl(var(--border))', margin: '8px 0' }} />

          <label>Client name<input required value={form.clientName} onChange={(e) => update('clientName', e.target.value)} data-testid="input-job-client" /></label>
          <label>Client phone<input value={form.clientPhone} onChange={(e) => update('clientPhone', e.target.value)} data-testid="input-job-phone" /></label>
          
          <label className="span-2">Service address
            <input required list="known-addresses" value={form.address} onChange={(e) => update('address', e.target.value)} placeholder="Street address" data-testid="input-job-address" />
            <datalist id="known-addresses">{addressSuggestions.map((option) => <option key={option} value={option} />)}</datalist>
          </label>
          <label>Property type
            <select value={unit.type} onChange={(e) => setUnit({ ...unit, type: e.target.value })} data-testid="select-property-type">
              <option value="house">House</option>
              <option value="apartment">Apartment / unit</option>
            </select>
          </label>
          {unit.type === 'apartment' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <label>Building<input value={unit.building} onChange={(e) => setUnit({ ...unit, building: e.target.value })} placeholder="3" data-testid="input-job-building" /></label>
              <label>Unit<input value={unit.number} onChange={(e) => setUnit({ ...unit, number: e.target.value })} placeholder="210" data-testid="input-job-unit" /></label>
            </div>
          ) : <div />}
          
          <label>Date<input type="date" required value={form.scheduledDate} onChange={(e) => update('scheduledDate', e.target.value)} data-testid="input-job-date" /></label>
          
          <fieldset className="add-on-field" style={{ gridRow: 'span 2' }}>
            <legend>Assigned team</legend>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {(employees.data || []).map(employee => (
                <label key={employee.id}>
                  <input type="checkbox" checked={form.employeeIds.includes(employee.id)} onChange={() => handleEmployeeToggle(employee.id)} />
                  {employee.name} · {employee.role}
                </label>
              ))}
              {!(employees.data || []).length && <span style={{fontSize: '9px', color: 'hsl(var(--muted-foreground))'}}>No employees available.</span>}
            </div>
          </fieldset>

          <label>Start<input type="time" required value={form.startTime} onChange={(e) => update('startTime', e.target.value)} data-testid="input-job-start" /></label>
          <label>End<input type="time" required value={form.endTime} onChange={(e) => update('endTime', e.target.value)} data-testid="input-job-end" /></label>
          
          <label>Appointment<select required value={form.serviceType} onChange={(e) => update('serviceType', e.target.value)} data-testid="input-job-service">{SERVICE_OPTIONS.map((service) => <option key={service}>{service}</option>)}</select></label>
          <label>Variant<input value={form.serviceVariant} onChange={(e) => update('serviceVariant', e.target.value)} data-testid="input-job-variant" /></label>
          <label>Duration (minutes)<input type="number" min="0" value={form.durationMinutes} onChange={(e) => update('durationMinutes', Number(e.target.value))} data-testid="input-job-duration" /></label>
          <label>Frequency<input value={form.frequency} onChange={(e) => update('frequency', e.target.value)} data-testid="input-job-frequency" /></label>
          
          <fieldset className="span-2 add-on-field">
            <legend>Add-ons{addOnTotals(form.addOns).count ? ` · +${addOnTotals(form.addOns).minutes} min · ${money(addOnTotals(form.addOns).amount)}` : ""}</legend>
            <div>
              {ADD_ON_OPTIONS.map((addOn) => (
                <label key={addOn}><input type="checkbox" checked={form.addOns.includes(addOn)} onChange={() => toggleAddOn(addOn)} />{addOn}</label>
              ))}
            </div>
          </fieldset>
          
          <label className="span-2">Additional information<textarea rows={3} value={form.notes} onChange={(e) => update('notes', e.target.value)} placeholder="Access instructions or client requests" data-testid="input-job-notes" /></label>
        </div>
        
        {failed ? <p className="form-error">That job could not be created. Check the required fields and your connection, then try again.</p> : null}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onClose} data-testid="button-cancel-create-job">Cancel</button>
          <button className="button button-primary" disabled={pending} data-testid="button-submit-create-job">{pending ? 'Creating…' : 'Create job'}<ArrowRight size={15} /></button>
        </div>
      </form>
    </div>
  );
}

function JobDetail({ job }: { job: Job }) {
  const qc = useQueryClient();
  const detail = useGetJob(job.id, { query: { queryKey: getGetJobQueryKey(job.id) } });
  const update = useUpdateJob();
  const employees = useListEmployees();
  const checklist = useUpdateJobChecklist();
  const sendMessage = useSendJobMessage();
  const messages = useListJobMessages(job.id, { query: { enabled: !!job.id, queryKey: getListJobMessagesQueryKey(job.id) } });
  const reminders = useListJobReminders(job.id, { query: { enabled: !!job.id, queryKey: getListJobRemindersQueryKey(job.id) } });
  const createReminder = useCreateJobReminder();
  const [message, setMessage] = useState('');
  const [reminderTitle, setReminderTitle] = useState('');
  const [reminderBody, setReminderBody] = useState('');
  const [editing, setEditing] = useState(false);

  const current = detail.data || job;
  
  const patch = (data: Parameters<typeof update.mutate>[0]['data']) => {
    update.mutate({ id: job.id, data }, { 
      onSuccess: (result) => { 
        qc.setQueryData(getGetJobQueryKey(job.id), result); 
        void qc.invalidateQueries({ queryKey: getListJobsQueryKey() }); 
        void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); 
      } 
    });
  };
  
  const toggleChecklist = (itemId: number, completed: boolean) => {
    checklist.mutate({ id: job.id, data: { itemId, completed } }, { 
      onSuccess: (result) => { 
        qc.setQueryData(getGetJobQueryKey(job.id), result); 
        void qc.invalidateQueries({ queryKey: getListJobsQueryKey() }); 
      } 
    });
  };
  
  return (
    <section className="panel job-detail" data-testid={`job-detail-${job.id}`}>
      <div className="detail-top">
        <div>
          <span className="eyebrow">Job #{String(current.id).padStart(4, '0')} · {formatDate(current.scheduledDate, { weekday: 'long', month: 'short', day: 'numeric' })}</span>
          <h2>{current.clientName}</h2>
          <p><MapPin size={14} />{current.address}</p>
        </div>
        <select value={current.status} onChange={(e) => patch({ status: e.target.value as 'scheduled' | 'in_progress' | 'completed' | 'attention' })} data-testid="select-job-status">
          <option value="scheduled">Scheduled</option>
          <option value="in_progress">In progress</option>
          <option value="attention">Attention</option>
          <option value="completed">Completed</option>
        </select>
      </div>
      
      <div className="detail-stat-row">
        <div><span>Window</span><strong>{formatTime(current.startTime)} – {formatTime(current.endTime)}</strong></div>
        <div><span>Service</span><strong>{current.serviceType}</strong></div>
        <div><span>Contact</span><strong>{current.clientPhone || 'Not provided'}</strong></div>
      </div>

      <button className="button button-secondary" onClick={() => setEditing(true)} data-testid="button-edit-job"><Edit2 size={15} />Edit or reschedule</button>
      {editing ? <EditJobDialog job={current} pending={update.isPending} failed={update.isError} onClose={() => setEditing(false)} onSubmit={(data) => { patch(data); setEditing(false); }} /> : null}
      
      <div className="detail-section">
        <div className="detail-section-head" style={{ marginBottom: '6px' }}>
          <div><span className="eyebrow">Details</span><h3>Service Information</h3></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11px' }}>
          <div><span className="muted-copy">Variant:</span> <strong>{current.serviceVariant || 'Standard'}</strong></div>
          <div><span className="muted-copy">Frequency:</span> <strong>{current.frequency || 'One-time'}</strong></div>
          <div><span className="muted-copy">Duration:</span> <strong>{current.durationMinutes ? `${current.durationMinutes} mins` : 'Unspecified'}</strong></div>
          <div><span className="muted-copy">Add-ons:</span> <strong>{current.addOns?.length ? `${current.addOns.join(', ')} · +${addOnTotals(current.addOns).minutes} min · ${money(addOnTotals(current.addOns).amount)}` : 'None'}</strong></div>
        </div>
      </div>

      <div className="detail-section">
        <div className="detail-section-head">
          <div><span className="eyebrow">Closeout</span><h3>Checklist</h3></div>
          <span className="mono">{current.checklist?.filter((i) => i.completed).length || 0}/{current.checklist?.length || 0}</span>
        </div>
        {current.checklist?.length ? (
          <div className="checklist">
            {current.checklist.map((item) => (
              <label className={`check-row ${item.completed ? 'check-complete' : ''}`} key={item.id}>
                <input type="checkbox" checked={item.completed} onChange={(e) => toggleChecklist(item.id, e.target.checked)} data-testid={`checkbox-checklist-${item.id}`} />
                <span>{item.label}</span>
                {item.completed && <Check size={15} />}
              </label>
            ))}
          </div>
        ) : (
          <p className="muted-copy">No checklist items have been added to this job.</p>
        )}
      </div>
      
      <div className="detail-section">
        <div className="detail-section-head">
          <div><span className="eyebrow">Crew</span><h3>Assigned team</h3></div>
          <button className="text-button" onClick={() => patch({ employeeIds: [] })} data-testid="button-clear-team">Clear team</button>
        </div>
        <div className="assigned-team">
           {current.assignedEmployees?.length ? current.assignedEmployees.map((member) => (
            <div className="assigned-member" key={member.id}>
              <Avatar member={member} />
              <div><strong>{member.name}</strong><span>{member.role}</span></div>
               <a href={`tel:${member.phone ?? ''}`} className="icon-button" data-testid={`link-call-team-${member.id}`} aria-label={`Call ${member.name}`}><Phone size={14} /></a>
               <button className="icon-button" onClick={() => patch({ employeeIds: (current.assignedEmployees || []).filter((assigned) => assigned.id !== member.id).map((assigned) => assigned.id) })} data-testid={`button-unassign-${member.id}`} aria-label={`Remove ${member.name} from this job`}><X size={14} /></button>
            </div>
          )) : (
            <span className="muted-copy">No team assigned.</span>
          )}
        </div>
         <label style={{ marginTop: '12px' }}>Assign someone
           <select
             value=""
             onChange={(e) => {
               const employeeId = Number(e.target.value);
               if (!employeeId) return;
               patch({ employeeIds: [...(current.assignedEmployees?.map((assigned) => assigned.id) || []), employeeId] });
             }}
             data-testid="select-assign-employee"
           >
             <option value="">Choose an employee…</option>
             {(employees.data || [])
               .filter((employee) => !current.assignedEmployees?.some((assigned) => assigned.id === employee.id))
               .map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.role}</option>)}
           </select>
         </label>
      </div>
      
      <div className="detail-section proof-section">
        <div className="detail-section-head">
          <div><span className="eyebrow">Proof trail</span><h3>Photos</h3></div>
          <Badge tone={current.photos?.length ? 'green' : 'neutral'}>{current.photos?.length || 0} uploaded</Badge>
        </div>
        {current.photos?.length ? (
          <div className="photo-grid">
            {current.photos.map((photo) => <img key={photo.id} src={photo.url} alt={photo.label} data-testid={`img-proof-${photo.id}`} />)}
          </div>
        ) : (
          <div className="proof-empty"><CheckCircle2 size={17} /><span>Photos from the crew will land here when the job is closed.</span></div>
        )}
      </div>
      
      <div className="message-box">
        <div>
          <span className="eyebrow">Customer communication</span>
          <h3>Send an SMS</h3>
          <span className="message-note" style={{ marginTop: '5px' }}>Channel: SMS · Audience: Customer</span>
        </div>
        
        {messages.data?.length ? (
          <div style={{ display: 'grid', gap: '8px', marginBottom: '12px', marginTop: '12px' }}>
            {messages.data.map((msg) => (
              <div key={msg.id} style={{ fontSize: '11px', background: 'hsl(var(--card))', padding: '8px', borderRadius: '6px' }}>
                <div>{msg.body}</div>
                <div style={{ marginTop: '4px', fontSize: '9px', color: 'hsl(var(--muted-foreground))' }}>
                  {formatDate(msg.createdAt, { hour: 'numeric', minute: '2-digit' })} · {msg.channel.toUpperCase()} · {msg.audience === 'customer' ? 'Customer' : 'Employee'} · {msg.status === 'queued' ? 'Queued / Not Delivered' : statusLabel(msg.status)}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="message-input">
          <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. We’ll see you between 9 and 10." data-testid="input-job-message" />
          <button
            disabled={!message.trim() || sendMessage.isPending}
            onClick={() => sendMessage.mutate({
              id: job.id,
              data: {
                recipient: 'client',
                body: message.trim(),
                channel: 'sms',
                audience: 'customer',
                recipientPhone: current.clientPhone || undefined,
                recipientName: current.clientName || undefined,
              }
            }, { onSuccess: () => { setMessage(''); void qc.invalidateQueries({ queryKey: getListJobMessagesQueryKey(job.id) }); } })}
            data-testid="button-send-job-message"
          ><Send size={15} /></button>
        </div>
        <span className="message-note">
          <MessageSquare size={13} /> 
          Goes to {current.clientName}{current.clientPhone ? ` · ${current.clientPhone}` : ''} · Queued for future Twilio delivery · {sendMessage.isPending ? 'Queueing...' : 'Not delivered yet'}
        </span>
      </div>

      <div className="detail-section">
        <div className="detail-section-head">
          <div><span className="eyebrow">Internal operations</span><h3>Cleaner reminders</h3></div>
        </div>
        {reminders.data?.length ? (
          <div style={{ display: 'grid', gap: '7px', marginBottom: '10px' }}>
            {reminders.data.map((reminder) => <div key={reminder.id} style={{ padding: '8px', background: 'hsl(var(--secondary))', borderRadius: '7px' }}><strong>{reminder.title}</strong><p style={{ margin: '3px 0 0', fontSize: '11px' }}>{reminder.body}</p></div>)}
          </div>
        ) : <p className="muted-copy">No internal reminders have been sent.</p>}
        <div className="form-grid">
          <label>Reminder title<input value={reminderTitle} onChange={(event) => setReminderTitle(event.target.value)} placeholder="Arrival reminder" /></label>
          <label className="span-2">Message<textarea rows={2} value={reminderBody} onChange={(event) => setReminderBody(event.target.value)} placeholder="Please confirm access details before leaving." /></label>
        </div>
        <button
          className="button button-secondary"
          disabled={!reminderTitle.trim() || !reminderBody.trim() || createReminder.isPending}
          onClick={() => createReminder.mutate({ jobId: job.id, data: { title: reminderTitle.trim(), body: reminderBody.trim() } }, {
            onSuccess: () => {
              setReminderTitle('');
              setReminderBody('');
              void qc.invalidateQueries({ queryKey: getListJobRemindersQueryKey(job.id) });
            },
          })}
        >{createReminder.isPending ? 'Sending…' : 'Send internal reminder'}</button>
      </div>
    </section>
  );
}

