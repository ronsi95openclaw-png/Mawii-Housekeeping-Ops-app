import { useState, useMemo } from 'react';
import { useListJobs, useCreateJob, getListJobsQueryKey } from '@workspace/api-client-react';
import type { Job } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { CreateJobDialog } from '@/pages/jobs';
import { ChevronLeft, ChevronRight, X, Clock3, MapPin, UserRound, ArrowRight, Plus } from 'lucide-react';
import { Link } from 'wouter';
import { LoadingState, ErrorState, PageIntro, Badge, Avatar, formatDate, formatTime, statusTone, statusLabel, startOfWeek, todayISO } from '@/lib/shared';

type ScheduleView = 'day' | 'week' | 'month';

const VIEW_LABELS: Record<ScheduleView, string> = { day: 'Today', week: 'This week', month: 'This month' };

function isoOf(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function Schedule() {
  const jobs = useListJobs();
  const create = useCreateJob();
  const queryClient = useQueryClient();
  const [view, setView] = useState<ScheduleView>('week');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Job | null>(null);
  const [createDate, setCreateDate] = useState<string | null>(null);

  const week = useMemo(() => {
    if (view === 'day') {
      const day = new Date();
      day.setDate(day.getDate() + offset);
      return [day];
    }
    if (view === 'week') {
      const start = startOfWeek();
      start.setDate(start.getDate() + offset * 7);
      return Array.from({ length: 7 }, (_, i) => { const day = new Date(start); day.setDate(start.getDate() + i); return day; });
    }
    const anchor = new Date();
    anchor.setDate(1);
    anchor.setMonth(anchor.getMonth() + offset);
    const gridStart = new Date(anchor);
    gridStart.setDate(1 - gridStart.getDay());
    const weeks = Math.ceil((new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate() + gridStart.getDay()) / 7);
    return Array.from({ length: weeks * 7 }, (_, i) => { const day = new Date(gridStart); day.setDate(gridStart.getDate() + i); return day; });
  }, [view, offset]);

  if (jobs.isLoading) return <LoadingState label="Loading the schedule" />;
  if (jobs.isError) return <ErrorState onRetry={() => void jobs.refetch()} />;

  const jobList = jobs.data || [];
  const anchorDay = week[Math.floor(week.length / 2)];
  const rangeLabel = view === 'day'
    ? formatDate(isoOf(week[0]), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : view === 'week'
      ? `${formatDate(isoOf(week[0]), { month: 'short', day: 'numeric' })} — ${formatDate(isoOf(week[6]), { month: 'short', day: 'numeric', year: 'numeric' })}`
      : anchorDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const submitCreate = (data: Parameters<typeof create.mutate>[0]['data']) => {
    create.mutate({ data }, { onSuccess: () => { setCreateDate(null); void queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() }); } });
  };

  return (
    <div className="content-stack">
      <PageIntro 
        eyebrow="Dispatch view" 
        title="Schedule" 
        body="See the shape of the week, then make the next move." 
        action={
          <div className="week-controls">
            <button className="icon-button" onClick={() => setOffset((v) => v - 1)} data-testid="button-previous-period"><ChevronLeft size={17} /></button>
            <button className="button button-secondary" onClick={() => setOffset(0)} data-testid="button-current-period">{VIEW_LABELS[view]}</button>
            <button className="icon-button" onClick={() => setOffset((v) => v + 1)} data-testid="button-next-period"><ChevronRight size={17} /></button>
            <button className="button button-primary" onClick={() => setCreateDate(todayISO())} data-testid="button-schedule-new-job"><Plus size={16} />New job</button>
          </div>
        }
      />
      
      <div className="schedule-meta">
        <div className="view-switch" role="group" aria-label="Schedule range">
          {(Object.keys(VIEW_LABELS) as ScheduleView[]).map((value) => (
            <button key={value} className={view === value ? 'view-active' : ''} onClick={() => { setView(value); setOffset(0); }} data-testid={`button-view-${value}`}>{VIEW_LABELS[value]}</button>
          ))}
        </div>
        <span className="mono">{rangeLabel}</span>
        <span className="schedule-legend">
          <i className="legend-dot legend-teal" />Scheduled 
          <i className="legend-dot legend-orange" />In progress 
          <i className="legend-dot legend-red" />Attention
        </span>
      </div>
      
      {view === 'month' ? <MonthBoard days={week} jobList={jobList} anchorMonth={anchorDay.getMonth()} onPick={setSelected} onAdd={setCreateDate} /> : (
      <section className="panel schedule-board" data-testid="schedule-board">
        <div className="schedule-head" style={view === 'day' ? { gridTemplateColumns: '58px 1fr' } : undefined}>
          <span className="eyebrow">{view === 'day' ? 'Day view' : 'Week view'}</span>
          {week.map((day) => (
            <div key={day.toISOString()} className={`day-head ${day.toDateString() === new Date().toDateString() ? 'day-today' : ''}`}>
              <span>{day.toLocaleDateString('en-US', { weekday: 'short' })}</span>
              <strong>{day.getDate()}</strong>
            </div>
          ))}
        </div>
        <div className="schedule-row" style={view === 'day' ? { gridTemplateColumns: '58px 1fr' } : undefined}>
          <div className="time-axis"><span>8 AM</span><span>10 AM</span><span>12 PM</span><span>2 PM</span><span>4 PM</span></div>
          {week.map((day) => {
            const dayISO = isoOf(day);
            const dayJobs = jobList.filter((job) => job.scheduledDate === dayISO);
            return (
              <div className="day-column" key={day.toISOString()}>
                <button type="button" onClick={() => setCreateDate(dayISO)} className="day-add" aria-label={`Add a job on ${formatDate(dayISO, { weekday: 'long', month: 'short', day: 'numeric' })}`} data-testid={`button-add-job-${dayISO}`}><Plus size={15} /></button>
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
      )}

      {selected && <JobQuickView job={selected} onClose={() => setSelected(null)} />}
      {createDate ? <CreateJobDialog pending={create.isPending} initialDate={createDate} onClose={() => setCreateDate(null)} onSubmit={submitCreate} /> : null}
    </div>
  );
}

function MonthBoard({ days, jobList, anchorMonth, onPick, onAdd }: { days: Date[]; jobList: Job[]; anchorMonth: number; onPick: (job: Job) => void; onAdd: (dayISO: string) => void }) {
  return (
    <section className="panel month-board" data-testid="schedule-board">
      <div className="month-head">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => <span key={label}>{label}</span>)}
      </div>
      <div className="month-grid">
        {days.map((day) => {
          const dayISO = isoOf(day);
          const dayJobs = jobList.filter((job) => job.scheduledDate === dayISO);
          return (
            <div className={`month-cell ${day.getMonth() === anchorMonth ? '' : 'month-cell-muted'} ${dayISO === todayISO() ? 'month-cell-today' : ''}`} key={dayISO}>
              <div className="month-cell-head">
                <strong>{day.getDate()}</strong>
                <button type="button" onClick={() => onAdd(dayISO)} className="month-add" aria-label={`Add a job on ${dayISO}`} data-testid={`button-add-job-${dayISO}`}><Plus size={13} /></button>
              </div>
              {dayJobs.slice(0, 3).map((job) => (
                <button className={`month-chip schedule-${job.status}`} key={job.id} onClick={() => onPick(job)} data-testid={`month-job-${job.id}`}>
                  <span>{formatTime(job.startTime)}</span>
                  <strong>{job.clientName}</strong>
                </button>
              ))}
              {dayJobs.length > 3 ? <span className="month-more">+{dayJobs.length - 3} more</span> : null}
            </div>
          );
        })}
      </div>
    </section>
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
