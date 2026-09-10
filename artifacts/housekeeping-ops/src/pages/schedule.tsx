import { useState, useMemo } from 'react';
import { useListJobs } from '@workspace/api-client-react';
import type { Job } from '@workspace/api-client-react';
import { ChevronLeft, ChevronRight, X, Clock3, MapPin, UserRound, ArrowRight } from 'lucide-react';
import { Link } from 'wouter';
import { LoadingState, ErrorState, PageIntro, Badge, Avatar, formatDate, formatTime, statusTone, statusLabel, startOfWeek } from '@/lib/shared';

export function Schedule() {
  const jobs = useListJobs();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selected, setSelected] = useState<Job | null>(null);
  
  const week = useMemo(() => { 
    const d = startOfWeek(); 
    d.setDate(d.getDate() + weekOffset * 7); 
    return Array.from({ length: 7 }, (_, i) => { const day = new Date(d); day.setDate(d.getDate() + i); return day; }); 
  }, [weekOffset]);
  
  if (jobs.isLoading) return <LoadingState label="Loading the week" />;
  if (jobs.isError) return <ErrorState onRetry={() => void jobs.refetch()} />;
  
  const jobList = jobs.data || [];
  
  return (
    <div className="content-stack">
      <PageIntro 
        eyebrow="Dispatch view" 
        title="Schedule" 
        body="See the shape of the week, then make the next move." 
        action={
          <div className="week-controls">
            <button className="icon-button" onClick={() => setWeekOffset((v) => v - 1)} data-testid="button-previous-week"><ChevronLeft size={17} /></button>
            <button className="button button-secondary" onClick={() => setWeekOffset(0)} data-testid="button-current-week">This week</button>
            <button className="icon-button" onClick={() => setWeekOffset((v) => v + 1)} data-testid="button-next-week"><ChevronRight size={17} /></button>
          </div>
        } 
      />
      
      <div className="schedule-meta">
        <span className="mono">{formatDate(week[0].toISOString().slice(0, 10), { month: 'short', day: 'numeric' })} — {formatDate(week[6].toISOString().slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        <span className="schedule-legend">
          <i className="legend-dot legend-teal" />Scheduled 
          <i className="legend-dot legend-orange" />In progress 
          <i className="legend-dot legend-red" />Attention
        </span>
      </div>
      
      <section className="panel schedule-board" data-testid="schedule-board">
        <div className="schedule-head">
          <span className="eyebrow">Week view</span>
          {week.map((day) => (
            <div key={day.toISOString()} className={`day-head ${day.toDateString() === new Date().toDateString() ? 'day-today' : ''}`}>
              <span>{day.toLocaleDateString('en-US', { weekday: 'short' })}</span>
              <strong>{day.getDate()}</strong>
            </div>
          ))}
        </div>
        <div className="schedule-row">
          <div className="time-axis"><span>8 AM</span><span>10 AM</span><span>12 PM</span><span>2 PM</span><span>4 PM</span></div>
          {week.map((day) => { 
            const dayJobs = jobList.filter((job) => job.scheduledDate === day.toISOString().slice(0, 10)); 
            return (
              <div className="day-column" key={day.toISOString()}>
                {dayJobs.length ? dayJobs.map((job) => (
                  <button className={`schedule-job schedule-${job.status}`} key={job.id} onClick={() => setSelected(job)} data-testid={`schedule-job-${job.id}`}>
                    <span>{formatTime(job.startTime)}</span>
                    <strong>{job.clientName}</strong>
                    <small>{job.serviceType}</small>
                    <div className="mini-crew">{job.team?.slice(0, 2).map((member) => <Avatar key={member.id} member={member} size="sm" />)}</div>
                  </button>
                )) : <span className="day-empty">open</span>}
              </div>
            ); 
          })}
        </div>
      </section>
      
      {selected && <JobQuickView job={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function JobQuickView({ job, onClose }: { job: Job; onClose: () => void }) {
  return (
    <div className="drawer-scrim" onClick={onClose}>
      <aside className="job-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div><span className="eyebrow">Job #{String(job.id).padStart(4, '0')}</span><h3>{job.clientName}</h3></div>
          <button className="icon-button" onClick={onClose} data-testid="button-close-job-drawer"><X size={17} /></button>
        </div>
        <Badge tone={statusTone(job.status)}>{statusLabel(job.status)}</Badge>
        <div className="drawer-facts">
          <span><Clock3 size={15} />{formatTime(job.startTime)} – {formatTime(job.endTime)}</span>
          <span><MapPin size={15} />{job.address}</span>
          <span><UserRound size={15} />{job.team?.map((m) => m.name).join(', ') || 'Unassigned'}</span>
        </div>
        <Link href={`/jobs?job=${job.id}`} onClick={onClose} className="button button-primary drawer-action" data-testid="link-open-job-detail">Open full job <ArrowRight size={15} /></Link>
      </aside>
    </div>
  );
}
