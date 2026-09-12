import { useState, useRef } from 'react';
import { 
  useListActivityHistory, useListJobs, useListIncidents, useReviewIncident, 
  useListEmployees, useCreateWorkerRate, useListPayouts, useListTimeEntries, useApproveTimeCorrection, useRejectTimeCorrection,
  getListIncidentsQueryKey, getGetOwnerReportQueryKey,
  useListPayPeriods, useCreatePayPeriod, useApprovePayPeriod, useMarkPayPeriodPaid, useAddPayoutAdjustment, useGetOwnerReport,
  getListPayPeriodsQueryKey, getListPayoutsQueryKey
} from '@workspace/api-client-react';
import { PageIntro, LoadingState, ErrorState, EmptyState, formatDate, statusTone, Badge, statusLabel, formatTime, todayISO } from '@/lib/shared';
import { AlertTriangle, Activity as ActivityIcon, ShieldCheck, Check, DollarSign, Download } from 'lucide-react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';

export function Quality() {
  const incidents = useListIncidents();
  const reviewIncident = useReviewIncident();
  const qc = useQueryClient();

  if (incidents.isLoading) return <LoadingState label="Loading quality metrics" />;
  if (incidents.isError) return <ErrorState onRetry={() => void incidents.refetch()} />;

  const activeIncidents = (incidents.data || []).filter(i => i.status !== 'resolved');

  return (
    <div className="content-stack">
      <PageIntro eyebrow="Quality Assurance" title="Incidents & QA" body="Review issues, manage recleans, and maintain standards." />
      
      <div className="dashboard-grid">
        <section className="panel attention-card">
          <div className="section-heading">
            <div><span className="eyebrow">Open Issues</span><h3>Incident Reports</h3></div>
            <Badge tone={activeIncidents.length ? 'red' : 'green'}>{activeIncidents.length ? `${activeIncidents.length} active` : 'All clear'}</Badge>
          </div>
          
          {activeIncidents.length ? (
            <div className="attention-list">
              {activeIncidents.map((incident) => (
                <div className="attention-row" key={incident.id} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px', alignItems: 'start' }}>
                  <span className="attention-mark"><AlertTriangle size={14} /></span>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong>Job #{incident.jobId}</strong>
                       <div style={{ display: 'flex', gap: '6px' }}>
                         <Badge tone={incident.severity === 'critical' || incident.severity === 'high' ? 'red' : incident.severity === 'medium' ? 'orange' : 'neutral'}>{incident.severity}</Badge>
                         <Badge tone={incident.status === 'open' ? 'red' : 'orange'}>{statusLabel(incident.status)}</Badge>
                       </div>
                    </div>
                    <p style={{ whiteSpace: 'normal', marginTop: '6px' }}>{incident.description}</p>
                    {incident.status === 'open' && (
                      <div className="team-actions" style={{ marginTop: '12px' }}>
                         <button className="button button-secondary" style={{ height: '28px' }} onClick={() => reviewIncident.mutate({ id: incident.id, data: { status: 'in_review' } }, { onSuccess: () => void qc.invalidateQueries({ queryKey: getListIncidentsQueryKey() }) })}>Mark In Review</button>
                      </div>
                    )}
                     {(incident.status === 'in_review' || incident.status === 'reclean') && (
                      <div className="team-actions" style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                        <button className="button button-primary" style={{ height: '28px' }} onClick={() => reviewIncident.mutate({ id: incident.id, data: { status: 'resolved', resolution: 'Resolved with client' } }, { onSuccess: () => void qc.invalidateQueries({ queryKey: getListIncidentsQueryKey() }) })}><Check size={14}/> Resolve</button>
                        {incident.status === 'in_review' && <button className="button button-secondary" style={{ height: '28px' }} onClick={() => reviewIncident.mutate({ id: incident.id, data: { status: 'reclean' } }, { onSuccess: () => void qc.invalidateQueries({ queryKey: getListIncidentsQueryKey() }) })}>Request Reclean</button>}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="all-clear">
              <ShieldCheck size={22} />
              <strong>No open incidents.</strong>
              <span>Quality metrics look good.</span>
            </div>
          )}
        </section>
        
        <TimeCorrectionQueue />
      </div>
    </div>
  );
}

function TimeCorrectionQueue() {
  const qc = useQueryClient();
  const timeEntries = useListTimeEntries({ status: 'pending' }, { query: { queryKey: ['timeEntries'] } });
  const approve = useApproveTimeCorrection();
  const reject = useRejectTimeCorrection();
  
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Approving or rejecting a correction changes what the worker is owed, so the money
  // screens must not keep serving the figures from before the decision.
  const refreshAfterDecision = () => {
    void qc.invalidateQueries({ queryKey: ['timeEntries'] });
    void qc.invalidateQueries({ queryKey: getListPayoutsQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetOwnerReportQueryKey() });
  };

  const handleApprove = (id: number) => {
    approve.mutate({ id }, { onSuccess: refreshAfterDecision });
  };

  const handleReject = (id: number) => {
    if (!rejectReason.trim()) return;
    reject.mutate({ id, data: { reason: rejectReason } }, { 
      onSuccess: () => {
        setRejectingId(null);
        setRejectReason('');
        refreshAfterDecision();
      } 
    });
  };

  return (
    <section className="panel attention-card">
      <div className="section-heading">
        <div><span className="eyebrow">Time Clock</span><h3>Pending Corrections</h3></div>
      </div>
      
      {!timeEntries.data?.length ? (
        <div className="all-clear" style={{ minHeight: '100px' }}>
          <Check size={22} />
          <strong>No pending requests.</strong>
        </div>
      ) : (
        <div className="attention-list">
          {timeEntries.data.map((entry) => (
            <div className="attention-row" key={entry.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>{entry.correctionMinutes! > 0 ? '+' : ''}{entry.correctionMinutes} mins adjustment</strong>
                <Badge tone="orange">Pending</Badge>
              </div>
              <p style={{ margin: 0 }}>Worker #{entry.employeeId} on Job #{entry.jobId} · {formatDate(entry.clockIn, { hour: 'numeric', minute: '2-digit' })}</p>
              
              {rejectingId === entry.id ? (
                <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                  <input type="text" placeholder="Reason..." value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} style={{ flex: 1, padding: '4px', fontSize: '10px' }} />
                  <button className="button button-primary" style={{ height: '26px' }} onClick={() => handleReject(entry.id)} disabled={!rejectReason.trim() || reject.isPending}>Confirm</button>
                  <button className="button button-secondary" style={{ height: '26px' }} onClick={() => setRejectingId(null)}>Cancel</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                  <button className="button button-primary" style={{ height: '26px' }} onClick={() => handleApprove(entry.id)} disabled={approve.isPending || reject.isPending}>Approve</button>
                  <button className="button button-secondary" style={{ height: '26px' }} onClick={() => setRejectingId(entry.id)} disabled={approve.isPending || reject.isPending}>Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function Payouts() {
  const now = new Date();
  const initialStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const initialEnd = todayISO();
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const employees = useListEmployees({ includeInactive: 'true' });
  const payouts = useListPayouts({ start, end });
  const periods = useListPayPeriods();
  const createPeriod = useCreatePayPeriod();
  const approvePeriod = useApprovePayPeriod();
  const markPaid = useMarkPayPeriodPaid();
  const addAdjustment = useAddPayoutAdjustment();
  const qc = useQueryClient();
  
  if (employees.isLoading || payouts.isLoading) return <LoadingState label="Loading financials" />;
  if (employees.isError || payouts.isError) return <ErrorState />;

  const handleCsvDownload = () => {
    window.open(`/api/payouts?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&format=csv`, '_blank');
  };

  const currentPeriod = (periods.data as Array<{ id: number; startsOn: string; endsOn: string; status: string }> | undefined)?.find(
    period => period.startsOn === start && period.endsOn === end,
  );

  const handleCreatePeriod = () => {
    createPeriod.mutate({ data: { startsOn: start, endsOn: end } }, {
      onSuccess: () => void qc.invalidateQueries({ queryKey: getListPayPeriodsQueryKey() }),
    });
  };

  const handleAdjustment = (employeeId: number) => {
    if (!currentPeriod) return;
    const amount = window.prompt('Adjustment amount (use a negative value to subtract):', '0');
    if (amount === null || amount.trim() === '') return;
    const reason = window.prompt('Reason for this adjustment:');
    if (!reason?.trim()) return;
    addAdjustment.mutate({ id: currentPeriod.id, data: { employeeId, amount, reason } }, {
      onSuccess: () => void qc.invalidateQueries({ queryKey: getListPayoutsQueryKey({ start, end }) }),
    });
  };

  return (
    <div className="content-stack">
      <PageIntro eyebrow="Financials" title="Payouts & Rates" body="Review approved hours and manage worker rates." action={<button className="button button-secondary" onClick={handleCsvDownload}><Download size={15}/> Export CSV</button>} />
      <section className="panel jobs-toolbar">
        <label>From<input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <label>Through<input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
      </section>

      <section className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <span className="eyebrow">Pay period</span>
          <strong style={{ display: 'block', marginTop: '4px' }}>
            {currentPeriod ? `${currentPeriod.startsOn} – ${currentPeriod.endsOn}` : 'No period created for this range'}
          </strong>
          {currentPeriod && <Badge tone={currentPeriod.status === 'paid' ? 'green' : currentPeriod.status === 'approved' ? 'orange' : 'neutral'}>{currentPeriod.status}</Badge>}
        </div>
        <div className="team-actions">
          {!currentPeriod && <button className="button button-secondary" onClick={handleCreatePeriod} disabled={createPeriod.isPending}>Create pay period</button>}
          {currentPeriod?.status === 'draft' && <button className="button button-primary" onClick={() => approvePeriod.mutate({ id: currentPeriod.id }, { onSuccess: () => void qc.invalidateQueries({ queryKey: getListPayPeriodsQueryKey() }) })} disabled={approvePeriod.isPending}>Approve period</button>}
          {currentPeriod?.status === 'approved' && <button className="button button-primary" onClick={() => markPaid.mutate({ id: currentPeriod.id }, { onSuccess: () => void qc.invalidateQueries({ queryKey: getListPayPeriodsQueryKey() }) })} disabled={markPaid.isPending}>Mark paid</button>}
        </div>
      </section>
      
      {payouts.data?.length ? (
        <div className="job-list">
          {payouts.data.map(payout => {
            const employee = employees.data?.find(e => e.id === payout.employeeId);
            return (
              <div className="job-list-row" key={payout.id} style={{ cursor: 'default' }}>
                <div className="job-list-main">
                  <strong>{employee?.name || `Worker #${payout.employeeId}`}</strong>
                  <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
                    <span><DollarSign size={13}/> {payout.approvedHours.toFixed(2)} hours</span>
                    <span>${payout.hourlyRate ?? '—'} / hour</span>
                     <strong>{payout.amount == null ? 'Rate needed' : `$${payout.amount.toFixed(2)}`}</strong>
                     {currentPeriod?.status !== 'paid' && <button className="text-button" onClick={() => handleAdjustment(payout.employeeId)}>Add adjustment</button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No payouts this period" body="When jobs are completed and time is approved, worker earnings will appear here." />
      )}
    </div>
  );
}

export function Reports() {
  const now = new Date();
  const [start, setStart] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
  const [end, setEnd] = useState(todayISO());
  const report = useGetOwnerReport({ start, end });
  const data = report.data as {
    jobs?: { volume?: number; completed?: number };
    employees?: Array<{ name?: string; role?: string; approvedMinutes?: number; amount?: number }>;
    recurringServices?: number;
    incidents?: Record<string, number>;
    customerHistoryCount?: number;
  } | undefined;

  if (report.isLoading) return <LoadingState label="Loading owner report" />;
  if (report.isError) return <ErrorState onRetry={() => void report.refetch()} />;

  return (
    <div className="content-stack">
      <PageIntro eyebrow="Owner control center" title="Operations report" body="Review completion, recurring services, quality, and customer history for a selected date range." />
      <section className="panel jobs-toolbar">
        <label>From<input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <label>Through<input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
      </section>
      <div className="dashboard-grid">
        <section className="panel">
          <span className="eyebrow">Jobs</span>
          <h3>{data?.jobs?.completed ?? 0} completed of {data?.jobs?.volume ?? 0}</h3>
          <p className="muted-copy">Scheduled jobs in this range</p>
        </section>
        <section className="panel">
          <span className="eyebrow">Customers</span>
          <h3>{data?.customerHistoryCount ?? 0}</h3>
          <p className="muted-copy">Customers with service history</p>
        </section>
        <section className="panel">
          <span className="eyebrow">Recurring services</span>
          <h3>{data?.recurringServices ?? 0}</h3>
          <p className="muted-copy">Active plans</p>
        </section>
        <section className="panel">
          <span className="eyebrow">Incidents</span>
          <h3>{Object.values(data?.incidents ?? {}).reduce((sum, count) => sum + count, 0)}</h3>
          <p className="muted-copy">{Object.entries(data?.incidents ?? {}).map(([key, count]) => `${key}: ${count}`).join(' · ') || 'No incidents in range'}</p>
        </section>
      </div>
      <section className="panel">
        <div className="section-heading"><div><span className="eyebrow">Labor snapshot</span><h3>Employee totals</h3></div></div>
        {data?.employees?.length ? data.employees.map((employee, index) => (
          <div className="activity-row" key={`${employee.name}-${index}`}>
            <div className="activity-copy"><strong>{employee.name || 'Employee'}</strong><span>{employee.role || 'team member'}</span></div>
            <span>{((employee.approvedMinutes ?? 0) / 60).toFixed(1)} hours</span>
          </div>
        )) : <EmptyState title="No employee totals" body="Approved time will appear here as the report data accumulates." />}
      </section>
    </div>
  );
}

// The server has always sent jobId on activity events; the generated type only gains it
// at the next codegen run, so it is read optionally to keep this working either way.
const activityJobId = (item: unknown) => (item as { jobId?: number | null }).jobId ?? null;

export function ActivityPage() {
  const activity = useListActivityHistory();
  
  if (activity.isLoading) return <LoadingState label="Loading paper trail" />;
  if (activity.isError) return <ErrorState onRetry={() => void activity.refetch()} />;
  
  const items = activity.data || [];

  return (
    <div className="content-stack">
      <PageIntro eyebrow="The paper trail" title="Activity History" body="A durable log of every operation." />
      <section className="panel activity-panel">
        {items.length ? (
          <div className="activity-list" style={{ marginTop: 0 }}>
            {items.map((item) => {
              const body = (
                <>
                  <span className="activity-icon"><ActivityIcon size={15} /></span>
                  <div className="activity-copy">
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                  </div>
                  <time>{formatDate(item.createdAt, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}</time>
                </>
              );
              // An entry about a job opens it; one that belongs to no job stays inert.
              const jobId = activityJobId(item);
              return jobId ? (
                <Link href={`/jobs?job=${jobId}`} className="activity-row" key={item.id} data-testid={`activity-row-${item.id}`}>{body}</Link>
              ) : (
                <div className="activity-row" key={item.id} data-testid={`activity-row-${item.id}`}>{body}</div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="No activity recorded" body="System events and updates will appear here." />
        )}
      </section>
    </div>
  );
}
