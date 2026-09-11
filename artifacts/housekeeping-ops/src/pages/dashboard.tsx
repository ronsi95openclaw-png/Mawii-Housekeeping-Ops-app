import { useGetDashboardSummary, useGetActivity, useListJobs, useTriggerDailySummary, getGetDashboardSummaryQueryKey, getGetActivityQueryKey } from '@workspace/api-client-react';
import type { Job } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { CalendarDays, Zap, CheckCircle2, AlertTriangle, Clock3, MapPin, ArrowRight, Activity as ActivityIcon, BellRing } from 'lucide-react';
import { LoadingState, ErrorState, PageIntro, EmptyState, Badge, statusTone, statusLabel, formatTime, formatDate, Avatar } from '@/lib/shared';

export function Dashboard() {
  const summary = useGetDashboardSummary();
  const activity = useGetActivity();
  const jobs = useListJobs();
  const qc = useQueryClient();
  const triggerSummary = useTriggerDailySummary();
  
  if (summary.isLoading || activity.isLoading || jobs.isLoading) return <LoadingState label="Setting up your day" />;
  if (summary.isError || activity.isError || jobs.isError) return <ErrorState onRetry={() => { void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); void qc.invalidateQueries({ queryKey: getGetActivityQueryKey() }); }} />;
  
  const data = summary.data;
  const attention = (jobs.data || []).filter((j) => j.status === 'attention').slice(0, 3);
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date());
  
  return (
    <div className="content-stack">
      <PageIntro eyebrow={`${weekday} · live board`} title="The day, at a glance." body="Keep the crew moving and every handoff documented." action={<div style={{ display: 'flex', gap: '8px' }}><button className="button button-secondary" disabled={triggerSummary.isPending} onClick={() => triggerSummary.mutate(undefined)}><BellRing size={15} />{triggerSummary.isPending ? 'Sending…' : 'Send daily summary'}</button><Link href="/schedule" className="button button-secondary" data-testid="link-view-schedule">Open schedule <ArrowRight size={15} /></Link></div>} />
      
      <section className="metric-grid animate-rise delay-1">
        {[
          { label: 'Today’s jobs', value: data?.todayJobs ?? 0, sub: 'on the board', icon: CalendarDays, tone: 'teal' },
          { label: 'Open jobs', value: data?.openJobs ?? 0, sub: 'need a next step', icon: Zap, tone: 'orange' },
          { label: 'Completed this week', value: data?.completedThisWeek ?? 0, sub: 'proof trails closed', icon: CheckCircle2, tone: 'blue' },
          { label: 'Attention needed', value: data?.attentionNeeded ?? attention.length, sub: 'worth a look now', icon: AlertTriangle, tone: 'red' },
        ].map(({ label, value, sub, icon: Icon, tone }) => (
          <div className="metric-card panel" key={label} data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}>
            <div className={`metric-icon metric-${tone}`}><Icon size={18} /></div>
            <div><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>
          </div>
        ))}
      </section>
      
      <div className="dashboard-grid">
        <section className="panel next-job-card animate-rise delay-2">
          <div className="section-heading"><div><span className="eyebrow">Up next</span><h3>Next job</h3></div><Clock3 size={18} className="muted-icon" /></div>
          {data?.nextJob ? <NextJob job={data.nextJob} /> : <EmptyState title="No next job yet" body="Your upcoming jobs will appear here as Elevate OS sends them through." action={<Link href="/jobs" className="text-link" data-testid="link-next-empty">View jobs <ArrowRight size={14} /></Link>} />}
        </section>
        
        <section className="panel attention-card animate-rise delay-2">
          <div className="section-heading"><div><span className="eyebrow">Needs a hand</span><h3>Attention queue</h3></div><Badge tone={attention.length ? 'red' : 'green'}>{attention.length ? `${attention.length} open` : 'All clear'}</Badge></div>
          {attention.length ? (
            <div className="attention-list">
              {attention.map((job) => (
                <Link href={`/jobs?job=${job.id}`} className="attention-row" key={job.id} data-testid={`link-attention-job-${job.id}`}>
                  <span className="attention-mark"><AlertTriangle size={14} /></span>
                  <div><strong>{job.clientName}</strong><p>{job.notes || 'Review this job before the crew arrives.'}</p></div>
                  <ArrowRight size={15} />
                </Link>
              ))}
            </div>
          ) : (
            <div className="all-clear"><CheckCircle2 size={22} /><strong>No loose ends.</strong><span>The board is in good shape.</span></div>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="section-heading"><div><span className="eyebrow">Today’s operations</span><h3>Assignment health</h3></div><span className="muted-copy">{data?.unreadNotifications ?? 0} unread owner notifications</span></div>
        {data?.operations?.length ? (
          <div className="activity-list">
            {data.operations.map((operation) => (
              <Link href={`/jobs?job=${operation.id}`} className="activity-row" key={operation.id}>
                <span className={`activity-icon activity-${operation.status}`}><CalendarDays size={15} /></span>
                <div className="activity-copy"><strong>{operation.clientName} · {formatTime(operation.startTime)}</strong><span>{operation.assignedEmployees?.map((employee) => employee.name).join(', ') || 'Unassigned'} · {operation.assignments?.map((assignment) => assignment.status).join(', ') || 'No acknowledgement'}</span></div>
                <small>{operation.pendingIncidents + operation.pendingCorrections ? `${operation.pendingIncidents} incidents · ${operation.pendingCorrections} corrections` : 'Clear'}</small>
              </Link>
            ))}
          </div>
        ) : <EmptyState title="No jobs today" body="Today’s assigned work will appear here once it is scheduled." />}
      </section>
      
      <section className="panel activity-panel animate-rise delay-3">
        <div className="section-heading"><div><span className="eyebrow">The paper trail</span><h3>Recent activity</h3></div><Link href="/activity" className="text-link" data-testid="link-all-activity">All activity <ArrowRight size={14} /></Link></div>
        {activity.data?.length ? (
          <div className="activity-list">
            {activity.data.slice(0, 6).map((item) => (
              <div className="activity-row" key={item.id} data-testid={`activity-row-${item.id}`}>
                <span className={`activity-icon activity-${item.type}`}><ActivityIcon size={15} /></span>
                <div className="activity-copy"><strong>{item.title}</strong><span>{item.detail}</span></div>
                <time>{formatDate(item.createdAt, { hour: 'numeric', minute: '2-digit' })}</time>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="Activity will collect here" body="Messages, checklist updates, and proof photos will show up as work happens." />
        )}
      </section>
    </div>
  );
}

function NextJob({ job }: { job: Job }) {
  return (
    <Link href={`/jobs?job=${job.id}`} className="next-job-body" data-testid={`link-next-job-${job.id}`}>
      <div className="next-job-time"><strong>{formatTime(job.startTime)}</strong><span>{job.endTime ? `until ${formatTime(job.endTime)}` : 'start time'}</span></div>
      <div className="next-job-info">
        <Badge tone={statusTone(job.status)}>{statusLabel(job.status)}</Badge>
        <h4>{job.clientName}</h4>
        <p><MapPin size={14} />{job.address}</p>
        <div className="crew-stack">
          {job.team?.slice(0, 3).map((member) => <Avatar key={member.id} member={member} size="sm" />)}
          <span>{job.team?.length || 0} crew assigned</span>
        </div>
      </div>
      <ArrowRight size={18} className="next-arrow" />
    </Link>
  );
}
