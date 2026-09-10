import { useState, useRef } from 'react';
import { 
  useListActivityHistory, useListJobs, useListIncidents, useReviewIncident, 
  useListEmployees, useCreateWorkerRate, useListPayouts, useListTimeEntries, useApproveTimeCorrection, useRejectTimeCorrection
} from '@workspace/api-client-react';
import { PageIntro, LoadingState, ErrorState, EmptyState, formatDate, statusTone, Badge, statusLabel, formatTime } from '@/lib/shared';
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
                      <Badge tone={incident.status === 'open' ? 'red' : 'orange'}>{statusLabel(incident.status)}</Badge>
                    </div>
                    <p style={{ whiteSpace: 'normal', marginTop: '6px' }}>{incident.description}</p>
                    {incident.status === 'open' && (
                      <div className="team-actions" style={{ marginTop: '12px' }}>
                        <button className="button button-secondary" style={{ height: '28px' }} onClick={() => reviewIncident.mutate({ id: incident.id, data: { status: 'reviewed' } }, { onSuccess: () => void qc.invalidateQueries({ queryKey: ['incidents'] }) })}>Mark Reviewed</button>
                      </div>
                    )}
                    {incident.status === 'reviewed' && (
                      <div className="team-actions" style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                        <button className="button button-primary" style={{ height: '28px' }} onClick={() => reviewIncident.mutate({ id: incident.id, data: { status: 'resolved', resolution: 'Resolved with client' } }, { onSuccess: () => void qc.invalidateQueries({ queryKey: ['incidents'] }) })}><Check size={14}/> Resolve</button>
                        <button className="button button-secondary" style={{ height: '28px' }} onClick={() => reviewIncident.mutate({ id: incident.id, data: { status: 'reclean' } }, { onSuccess: () => void qc.invalidateQueries({ queryKey: ['incidents'] }) })}>Request Reclean</button>
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

  const handleApprove = (id: number) => {
    approve.mutate({ id }, { onSuccess: () => void qc.invalidateQueries({ queryKey: ['timeEntries'] }) });
  };

  const handleReject = (id: number) => {
    if (!rejectReason.trim()) return;
    reject.mutate({ id, data: { reason: rejectReason } }, { 
      onSuccess: () => {
        setRejectingId(null);
        setRejectReason('');
        void qc.invalidateQueries({ queryKey: ['timeEntries'] });
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
  const initialEnd = now.toISOString().slice(0, 10);
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const employees = useListEmployees();
  const payouts = useListPayouts({ start, end });
  
  if (employees.isLoading || payouts.isLoading) return <LoadingState label="Loading financials" />;
  if (employees.isError || payouts.isError) return <ErrorState />;

  const handleCsvDownload = () => {
    window.open(`/api/payouts?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&format=csv`, '_blank');
  };

  return (
    <div className="content-stack">
      <PageIntro eyebrow="Financials" title="Payouts & Rates" body="Review approved hours and manage worker rates." action={<button className="button button-secondary" onClick={handleCsvDownload}><Download size={15}/> Export CSV</button>} />
      <section className="panel jobs-toolbar">
        <label>From<input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>
        <label>Through<input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
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
            {items.map((item) => (
              <div className="activity-row" key={item.id}>
                <span className="activity-icon"><ActivityIcon size={15} /></span>
                <div className="activity-copy">
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </div>
                <time>{formatDate(item.createdAt, { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' })}</time>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No activity recorded" body="System events and updates will appear here." />
        )}
      </section>
    </div>
  );
}
