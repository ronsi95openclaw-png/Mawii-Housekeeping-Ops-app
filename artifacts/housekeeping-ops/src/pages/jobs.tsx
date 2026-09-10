import { useState, type FormEvent } from 'react';
import { useLocation } from 'wouter';
import { 
  useListJobs, useCreateJob, useGetJob, useUpdateJob, useUpdateJobChecklist, 
  useSendJobMessage, useListTeam, useListJobMessages, useListCustomers, useListCustomerAddresses,
  getListJobsQueryKey, getGetJobQueryKey, getGetDashboardSummaryQueryKey, getListJobMessagesQueryKey
} from '@workspace/api-client-react';
import type { Job } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Search, ChevronRight, ClipboardCheck, MapPin, Check, MessageSquare, Phone, CheckCircle2, Send, X, ArrowRight } from 'lucide-react';
import { LoadingState, ErrorState, EmptyState, PageIntro, Badge, Avatar, statusTone, statusLabel, formatDate, formatTime, whatsappUrl, todayISO } from '@/lib/shared';

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
};

export function Jobs() {
  const [location, setLocation] = useLocation();
  const jobs = useListJobs();
  const create = useCreateJob();
  const queryClient = useQueryClient();
  
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState('all');
  
  const params = new URLSearchParams(location.split('?')[1] || '');
  const selectedId = Number(params.get('job')) || null;
  
  if (jobs.isLoading) return <LoadingState label="Loading jobs" />;
  if (jobs.isError) return <ErrorState onRetry={() => void jobs.refetch()} />;
  
  const filtered = (jobs.data || []).filter((job) => (filter === 'all' || job.status === filter) && `${job.clientName} ${job.address} ${job.serviceType}`.toLowerCase().includes(search.toLowerCase()));
  const selectedJob = selectedId ? (jobs.data || []).find((j) => j.id === selectedId) : null;
  
  const submitCreate = (data: NewJobForm) => {
    create.mutate({ data }, { onSuccess: () => { setShowCreate(false); void queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() }); } });
  };
  
  return (
    <div className="content-stack">
      <PageIntro eyebrow="Work orders" title="Jobs" body="Every visit, one clear owner, no lost context." action={<button className="button button-primary" onClick={() => setShowCreate(true)} data-testid="button-create-job"><Plus size={16} />Create job</button>} />
      
      <section className="panel jobs-toolbar">
        <div className="search-wrap">
          <Search size={17} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search client, address, or service" data-testid="input-search-jobs" />
        </div>
        <div className="filter-tabs">
          {['all', 'scheduled', 'in_progress', 'attention', 'completed'].map((value) => (
            <button key={value} className={filter === value ? 'filter-active' : ''} onClick={() => setFilter(value)} data-testid={`button-filter-${value}`}>
              {value === 'all' ? 'All jobs' : statusLabel(value)}
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
            <JobDetail job={selectedJob} />
          ) : (
            <div className="panel detail-placeholder dot-grid">
              <ClipboardCheck size={28} />
              <strong>Select a job</strong>
              <span>Open a work order to review its team, checklist, and proof trail.</span>
            </div>
          )}
        </div>
      ) : (
        <EmptyState title="No jobs match that view" body="Try clearing the search or changing the status filter." action={<button className="button button-secondary" onClick={() => { setSearch(''); setFilter('all'); }} data-testid="button-clear-job-filters">Clear filters</button>} />
      )}
      
      {showCreate && <CreateJobDialog pending={create.isPending} onClose={() => setShowCreate(false)} onSubmit={submitCreate} />}
    </div>
  );
}

function CreateJobDialog({ onClose, onSubmit, pending }: { onClose: () => void; onSubmit: (data: NewJobForm) => void; pending: boolean }) {
  const team = useListTeam();
  const customers = useListCustomers();
  const [form, setForm] = useState({ clientName: '', address: '', scheduledDate: todayISO(), startTime: '09:00', endTime: '12:00', serviceType: 'Standard cleaning', serviceVariant: '2 bed / 2 bath Standard', addOns: [] as string[], durationMinutes: 180, frequency: 'Every 4 weeks', notes: '', clientPhone: '', teamMemberIds: [] as number[], customerId: '', addressId: '' });
  
  const selectedCustomerId = Number(form.customerId);
  const addresses = useListCustomerAddresses(selectedCustomerId, { query: { enabled: !!selectedCustomerId, queryKey: ['addresses', selectedCustomerId] } });
  
  const update = (key: keyof typeof form, value: any) => setForm((current) => ({ ...current, [key]: value }));
  const toggleAddOn = (addOn: string) => setForm((current) => ({ ...current, addOns: current.addOns.includes(addOn) ? current.addOns.filter((item) => item !== addOn) : [...current.addOns, addOn] }));
  
  const handleTeamMemberToggle = (id: number) => {
    setForm(current => ({
      ...current,
      teamMemberIds: current.teamMemberIds.includes(id) 
        ? current.teamMemberIds.filter(mId => mId !== id)
        : [...current.teamMemberIds, id]
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
    <div className="modal-scrim">
      <form className="modal panel" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(form); }}>
        <div className="modal-head">
          <div><span className="eyebrow">Elevate OS intake</span><h3>Add a job</h3></div>
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
          
          <label className="span-2">Service address<input required value={form.address} onChange={(e) => update('address', e.target.value)} data-testid="input-job-address" /></label>
          
          <label>Date<input type="date" required value={form.scheduledDate} onChange={(e) => update('scheduledDate', e.target.value)} data-testid="input-job-date" /></label>
          
          <fieldset className="add-on-field" style={{ gridRow: 'span 2' }}>
            <legend>Assigned team</legend>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {(team.data || []).map(member => (
                <label key={member.id}>
                  <input type="checkbox" checked={form.teamMemberIds.includes(member.id)} onChange={() => handleTeamMemberToggle(member.id)} />
                  {member.name}
                </label>
              ))}
              {!(team.data || []).length && <span style={{fontSize: '9px', color: 'hsl(var(--muted-foreground))'}}>No team members available.</span>}
            </div>
          </fieldset>

          <label>Start<input type="time" required value={form.startTime} onChange={(e) => update('startTime', e.target.value)} data-testid="input-job-start" /></label>
          <label>End<input type="time" required value={form.endTime} onChange={(e) => update('endTime', e.target.value)} data-testid="input-job-end" /></label>
          
          <label>Appointment<select required value={form.serviceType} onChange={(e) => update('serviceType', e.target.value)} data-testid="input-job-service">{SERVICE_OPTIONS.map((service) => <option key={service}>{service}</option>)}</select></label>
          <label>Variant<input value={form.serviceVariant} onChange={(e) => update('serviceVariant', e.target.value)} data-testid="input-job-variant" /></label>
          <label>Duration (minutes)<input type="number" min="0" value={form.durationMinutes} onChange={(e) => update('durationMinutes', Number(e.target.value))} data-testid="input-job-duration" /></label>
          <label>Frequency<input value={form.frequency} onChange={(e) => update('frequency', e.target.value)} data-testid="input-job-frequency" /></label>
          
          <fieldset className="span-2 add-on-field">
            <legend>Add-ons</legend>
            <div>
              {['Laundry', 'Inside Oven', 'Inside Fridge', 'Inside Cabinets'].map((addOn) => (
                <label key={addOn}><input type="checkbox" checked={form.addOns.includes(addOn)} onChange={() => toggleAddOn(addOn)} />{addOn}</label>
              ))}
            </div>
          </fieldset>
          
          <label className="span-2">Additional information<textarea rows={3} value={form.notes} onChange={(e) => update('notes', e.target.value)} placeholder="Access instructions or client requests" data-testid="input-job-notes" /></label>
        </div>
        
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
  const checklist = useUpdateJobChecklist();
  const sendMessage = useSendJobMessage();
  const messages = useListJobMessages(job.id, { query: { enabled: !!job.id, queryKey: getListJobMessagesQueryKey(job.id) } });
  const [message, setMessage] = useState('');
  const [whatsappTemplate, setWhatsappTemplate] = useState<'assignment' | 'reminder' | 'schedule' | 'job'>('job');
  
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
      
      <div className="detail-section">
        <div className="detail-section-head" style={{ marginBottom: '6px' }}>
          <div><span className="eyebrow">Details</span><h3>Service Information</h3></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11px' }}>
          <div><span className="muted-copy">Variant:</span> <strong>{current.serviceVariant || 'Standard'}</strong></div>
          <div><span className="muted-copy">Frequency:</span> <strong>{current.frequency || 'One-time'}</strong></div>
          <div><span className="muted-copy">Duration:</span> <strong>{current.durationMinutes ? `${current.durationMinutes} mins` : 'Unspecified'}</strong></div>
          <div><span className="muted-copy">Add-ons:</span> <strong>{current.addOns?.join(', ') || 'None'}</strong></div>
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
          <button className="text-button" onClick={() => patch({ teamMemberIds: [] })} data-testid="button-clear-team">Clear team</button>
        </div>
        <label style={{ display: 'block', marginBottom: '10px', fontSize: '10px' }}>
          Owner-triggered WhatsApp template
          <select value={whatsappTemplate} onChange={(e) => setWhatsappTemplate(e.target.value as typeof whatsappTemplate)} style={{ display: 'block', width: '100%', marginTop: '5px' }}>
            <option value="assignment">Assignment</option>
            <option value="reminder">Reminder</option>
            <option value="schedule">Schedule update</option>
            <option value="job">Job update</option>
          </select>
        </label>
        <div className="assigned-team">
          {current.team?.length ? current.team.map((member) => (
            <div className="assigned-member" key={member.id}>
              <Avatar member={member} />
              <div><strong>{member.name}</strong><span>{member.role}</span></div>
              <a
                href={whatsappUrl(member.phone, whatsappMessage(whatsappTemplate, member.name, current))}
                target="_blank"
                rel="noreferrer"
                className="button button-secondary"
                style={{ height: '28px', padding: '0 8px', fontSize: '9px' }}
                data-testid={`link-whatsapp-team-${member.id}`}
                aria-label={`Owner-triggered WhatsApp for ${member.name}`}
              >
                <MessageSquare size={13} /> Owner-triggered WhatsApp
              </a>
              <a href={`tel:${member.phone}`} className="icon-button" data-testid={`link-call-team-${member.id}`} aria-label={`Call ${member.name}`}><Phone size={14} /></a>
            </div>
          )) : (
            <span className="muted-copy">No team assigned.</span>
          )}
        </div>
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
    </section>
  );
}

function whatsappMessage(
  template: 'assignment' | 'reminder' | 'schedule' | 'job',
  memberName: string,
  job: Job,
) {
  const greeting = `Hi ${memberName},`;
  if (template === 'assignment') return `${greeting} you're assigned to ${job.clientName}'s ${job.serviceType} job on ${formatDate(job.scheduledDate)} at ${formatTime(job.startTime)}.`;
  if (template === 'reminder') return `${greeting} reminder for ${job.clientName}'s ${job.serviceType} job on ${formatDate(job.scheduledDate)} at ${formatTime(job.startTime)}.`;
  if (template === 'schedule') return `${greeting} schedule update: ${job.clientName}'s job is on ${formatDate(job.scheduledDate)} from ${formatTime(job.startTime)} to ${formatTime(job.endTime)}.`;
  return `${greeting} job update for ${job.clientName}: ${job.serviceType} at ${job.address}.`;
}
