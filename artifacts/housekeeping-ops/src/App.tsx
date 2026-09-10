import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity as ActivityIcon, AlertTriangle, ArrowRight, Bell, CalendarDays, Check,
  CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Clock3, Home, LayoutDashboard,
  ListFilter, LoaderCircle, MapPin, Menu, MessageSquare, Phone, Plus, Search, Send,
  Settings2, Sparkles, UserRound, UsersRound, X, Zap
} from 'lucide-react';
import { Link, Route, Switch, useLocation, useRoute } from 'wouter';
import {
  getGetActivityQueryKey, getGetDashboardSummaryQueryKey, getGetJobQueryKey, getListJobsQueryKey,
  getListTeamQueryKey, useCreateJob, useCreateTeamMember, useGetActivity, useGetDashboardSummary,
  useGetJob, useHealthCheck, useListJobs, useListTeam, useSendJobMessage, useUpdateJob,
  useUpdateJobChecklist
} from '@workspace/api-client-react';
import type { Job, TeamMember } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

const navItems = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/schedule', label: 'Schedule', icon: CalendarDays },
  { href: '/jobs', label: 'Jobs', icon: ClipboardCheck },
  { href: '/team', label: 'Team', icon: UsersRound },
  { href: '/settings', label: 'Settings', icon: Settings2 },
];

function formatDate(value?: string | Date, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) {
  if (!value) return '—';
  const date = value instanceof Date
    ? value
    : /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00`)
      : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', options).format(date);
}
function formatTime(value?: string) {
  if (!value) return '—';
  const [h, m] = value.split(':').map(Number);
  const hour = h > 12 ? h - 12 : h || 12;
  return `${hour}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
function startOfWeek() {
  const d = new Date(); const day = d.getDay(); d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)); return d;
}
function statusLabel(status: string) { return status.replace('_', ' '); }
function initials(member: TeamMember) { return member.initials || member.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase(); }
function whatsappUrl(phone: string, message?: string) {
  const digits = phone.replace(/\D/g, '');
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
}

function Avatar({ member, size = 'md' }: { member?: TeamMember; size?: 'sm' | 'md' | 'lg' }) {
  return <span data-testid={`avatar-${member?.id ?? 'fallback'}`} className={`avatar avatar-${size}`}>{member ? initials(member) : '—'}</span>;
}

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'orange' | 'red' | 'blue' }) {
  return <span className={`badge badge-${tone}`} data-testid="status-badge">{children}</span>;
}
function statusTone(status?: string): 'neutral' | 'green' | 'orange' | 'red' | 'blue' {
  if (status === 'completed' || status === 'available') return 'green';
  if (status === 'attention' || status === 'off') return 'red';
  if (status === 'in_progress' || status === 'assigned') return 'orange';
  return 'blue';
}
function LoadingState({ label = 'Loading operations' }: { label?: string }) {
  return <div className="loading-state panel" data-testid="loading-state"><LoaderCircle size={18} className="spin" /><span>{label}</span></div>;
}
function ErrorState({ onRetry }: { onRetry?: () => void }) {
  return <div className="empty-state panel" data-testid="error-state"><AlertTriangle size={22} /><strong>Couldn’t load this view</strong><p>Try again in a moment. Your saved work is safe.</p>{onRetry && <button className="button button-secondary" onClick={onRetry} data-testid="button-retry">Try again</button>}</div>;
}
function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <div className="empty-state panel" data-testid="empty-state"><Sparkles size={22} /><strong>{title}</strong><p>{body}</p>{action}</div>;
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const health = useHealthCheck();
  const dateLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
  const activeLocation = location.split('?')[0];
  return <div className="app-shell">
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="brand"><span className="brand-mark"><Sparkles size={18} /></span><span><b>housekeeping</b><small>ops / field desk</small></span><button className="close-sidebar" onClick={() => setOpen(false)} data-testid="button-close-menu"><X size={17} /></button></div>
      <div className="workspace-label eyebrow">Operations desk</div>
      <nav className="main-nav" aria-label="Primary navigation">
        {navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setOpen(false)} className={`nav-link ${activeLocation === href ? 'nav-active' : ''}`} data-testid={`link-nav-${label.toLowerCase()}`}><Icon size={17} /><span>{label}</span>{label === 'Jobs' && <span className="nav-count">8</span>}</Link>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="sync-line"><span className={`status-dot ${health.isError ? 'status-dot-warn' : ''}`} />{health.isLoading ? 'Checking connection' : health.isError ? 'Connection delayed' : 'Elevate OS connected'}</div>
        <div className="user-card"><Avatar member={{ id: 0, name: 'Mara Chen', role: 'Owner', phone: '', status: 'available' }} /><div><strong>Mara Chen</strong><small>Owner · Field desk</small></div><button className="icon-button" data-testid="button-user-menu"><ChevronRight size={15} /></button></div>
      </div>
    </aside>
    {open && <button className="sidebar-scrim" onClick={() => setOpen(false)} aria-label="Close navigation" data-testid="button-dismiss-menu" />}
    <main className="main-area">
      <header className="topbar"><button className="mobile-menu" onClick={() => setOpen(true)} data-testid="button-open-menu"><Menu size={21} /></button><div><span className="eyebrow">Today · {dateLabel}</span><h2>{activeLocation === '/' ? 'Good morning, Mara' : navItems.find((item) => item.href === activeLocation)?.label || 'Operations'}</h2></div><div className="topbar-actions"><button className="icon-button notification-button" data-testid="button-notifications"><Bell size={18} /><i /></button><Link href="/jobs" className="button button-primary top-add" data-testid="link-new-job"><Plus size={16} />New job</Link></div></header>
      <div className="page-wrap">{children}</div>
    </main>
  </div>;
}

function PageIntro({ eyebrow, title, body, action }: { eyebrow: string; title: string; body?: string; action?: ReactNode }) {
  return <div className="page-intro animate-rise"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{body && <p>{body}</p>}</div>{action}</div>;
}

function Dashboard() {
  const summary = useGetDashboardSummary();
  const activity = useGetActivity();
  const jobs = useListJobs();
  const qc = useQueryClient();
  if (summary.isLoading || activity.isLoading || jobs.isLoading) return <LoadingState label="Setting up your day" />;
  if (summary.isError || activity.isError || jobs.isError) return <ErrorState onRetry={() => { void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); void qc.invalidateQueries({ queryKey: getGetActivityQueryKey() }); }} />;
  const data = summary.data;
  const attention = (jobs.data || []).filter((j) => j.status === 'attention').slice(0, 3);
  return <div className="content-stack">
    <PageIntro eyebrow="Monday · live board" title="The day, at a glance." body="Keep the crew moving and every handoff documented." action={<Link href="/schedule" className="button button-secondary" data-testid="link-view-schedule">Open schedule <ArrowRight size={15} /></Link>} />
    <section className="metric-grid animate-rise delay-1">
      {[
        { label: 'Today’s jobs', value: data?.todayJobs ?? 0, sub: 'on the board', icon: CalendarDays, tone: 'teal' },
        { label: 'Open jobs', value: data?.openJobs ?? 0, sub: 'need a next step', icon: Zap, tone: 'orange' },
        { label: 'Completed this week', value: data?.completedThisWeek ?? 0, sub: 'proof trails closed', icon: CheckCircle2, tone: 'blue' },
        { label: 'Attention needed', value: data?.attentionNeeded ?? attention.length, sub: 'worth a look now', icon: AlertTriangle, tone: 'red' },
      ].map(({ label, value, sub, icon: Icon, tone }) => <div className="metric-card panel" key={label} data-testid={`metric-${label.toLowerCase().replaceAll(' ', '-')}`}><div className={`metric-icon metric-${tone}`}><Icon size={18} /></div><div><span>{label}</span><strong>{value}</strong><small>{sub}</small></div></div>)}
    </section>
    <div className="dashboard-grid">
      <section className="panel next-job-card animate-rise delay-2">
        <div className="section-heading"><div><span className="eyebrow">Up next</span><h3>Next job</h3></div><Clock3 size={18} className="muted-icon" /></div>
        {data?.nextJob ? <NextJob job={data.nextJob} /> : <EmptyState title="No next job yet" body="Your upcoming jobs will appear here as Elevate OS sends them through." action={<Link href="/jobs" className="text-link" data-testid="link-next-empty">View jobs <ArrowRight size={14} /></Link>} />}
      </section>
      <section className="panel attention-card animate-rise delay-2">
        <div className="section-heading"><div><span className="eyebrow">Needs a hand</span><h3>Attention queue</h3></div><Badge tone={attention.length ? 'red' : 'green'}>{attention.length ? `${attention.length} open` : 'All clear'}</Badge></div>
        {attention.length ? <div className="attention-list">{attention.map((job) => <Link href={`/jobs?job=${job.id}`} className="attention-row" key={job.id} data-testid={`link-attention-job-${job.id}`}><span className="attention-mark"><AlertTriangle size={14} /></span><div><strong>{job.clientName}</strong><p>{job.notes || 'Review this job before the crew arrives.'}</p></div><ArrowRight size={15} /></Link>)}</div> : <div className="all-clear"><CheckCircle2 size={22} /><strong>No loose ends.</strong><span>The board is in good shape.</span></div>}
      </section>
    </div>
    <section className="panel activity-panel animate-rise delay-3">
      <div className="section-heading"><div><span className="eyebrow">The paper trail</span><h3>Recent activity</h3></div><Link href="/jobs" className="text-link" data-testid="link-all-activity">All jobs <ArrowRight size={14} /></Link></div>
      {activity.data?.length ? <div className="activity-list">{activity.data.slice(0, 6).map((item) => <div className="activity-row" key={item.id} data-testid={`activity-row-${item.id}`}><span className={`activity-icon activity-${item.type}`}><ActivityIcon size={15} /></span><div className="activity-copy"><strong>{item.title}</strong><span>{item.detail}</span></div><time>{formatDate(item.createdAt, { hour: 'numeric', minute: '2-digit' })}</time></div>)}</div> : <EmptyState title="Activity will collect here" body="Messages, checklist updates, and proof photos will show up as work happens." />}
    </section>
  </div>;
}

function NextJob({ job }: { job: Job }) {
  return <Link href={`/jobs?job=${job.id}`} className="next-job-body" data-testid={`link-next-job-${job.id}`}><div className="next-job-time"><strong>{formatTime(job.startTime)}</strong><span>{job.endTime ? `until ${formatTime(job.endTime)}` : 'start time'}</span></div><div className="next-job-info"><Badge tone={statusTone(job.status)}>{statusLabel(job.status)}</Badge><h4>{job.clientName}</h4><p><MapPin size={14} />{job.address}</p><div className="crew-stack">{job.team?.slice(0, 3).map((member) => <Avatar key={member.id} member={member} size="sm" />)}<span>{job.team?.length || 0} crew assigned</span></div></div><ArrowRight size={18} className="next-arrow" /></Link>;
}

function Schedule() {
  const jobs = useListJobs();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selected, setSelected] = useState<Job | null>(null);
  const week = useMemo(() => { const d = startOfWeek(); d.setDate(d.getDate() + weekOffset * 7); return Array.from({ length: 7 }, (_, i) => { const day = new Date(d); day.setDate(d.getDate() + i); return day; }); }, [weekOffset]);
  if (jobs.isLoading) return <LoadingState label="Loading the week" />;
  if (jobs.isError) return <ErrorState onRetry={() => void jobs.refetch()} />;
  const jobList = jobs.data || [];
  return <div className="content-stack">
    <PageIntro eyebrow="Dispatch view" title="Schedule" body="See the shape of the week, then make the next move." action={<div className="week-controls"><button className="icon-button" onClick={() => setWeekOffset((v) => v - 1)} data-testid="button-previous-week"><ChevronLeft size={17} /></button><button className="button button-secondary" onClick={() => setWeekOffset(0)} data-testid="button-current-week">This week</button><button className="icon-button" onClick={() => setWeekOffset((v) => v + 1)} data-testid="button-next-week"><ChevronRight size={17} /></button></div>} />
    <div className="schedule-meta"><span className="mono">{formatDate(week[0].toISOString().slice(0, 10), { month: 'short', day: 'numeric' })} — {formatDate(week[6].toISOString().slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' })}</span><span className="schedule-legend"><i className="legend-dot legend-teal" />Scheduled <i className="legend-dot legend-orange" />In progress <i className="legend-dot legend-red" />Attention</span></div>
    <section className="panel schedule-board" data-testid="schedule-board"><div className="schedule-head"><span className="eyebrow">Week view</span>{week.map((day) => <div key={day.toISOString()} className={`day-head ${day.toDateString() === new Date().toDateString() ? 'day-today' : ''}`}><span>{day.toLocaleDateString('en-US', { weekday: 'short' })}</span><strong>{day.getDate()}</strong></div>)}</div><div className="schedule-row"><div className="time-axis"><span>8 AM</span><span>10 AM</span><span>12 PM</span><span>2 PM</span><span>4 PM</span></div>{week.map((day) => { const dayJobs = jobList.filter((job) => job.scheduledDate === day.toISOString().slice(0, 10)); return <div className="day-column" key={day.toISOString()}>{dayJobs.length ? dayJobs.map((job) => <button className={`schedule-job schedule-${job.status}`} key={job.id} onClick={() => setSelected(job)} data-testid={`schedule-job-${job.id}`}><span>{formatTime(job.startTime)}</span><strong>{job.clientName}</strong><small>{job.serviceType}</small><div className="mini-crew">{job.team?.slice(0, 2).map((member) => <Avatar key={member.id} member={member} size="sm" />)}</div></button>) : <span className="day-empty">open</span>}</div>; })}</div></section>
    {selected && <JobQuickView job={selected} onClose={() => setSelected(null)} />}
  </div>;
}

function JobQuickView({ job, onClose }: { job: Job; onClose: () => void }) {
  return <div className="drawer-scrim" onClick={onClose}><aside className="job-drawer" onClick={(e) => e.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">Job #{String(job.id).padStart(4, '0')}</span><h3>{job.clientName}</h3></div><button className="icon-button" onClick={onClose} data-testid="button-close-job-drawer"><X size={17} /></button></div><Badge tone={statusTone(job.status)}>{statusLabel(job.status)}</Badge><div className="drawer-facts"><span><Clock3 size={15} />{formatTime(job.startTime)} – {formatTime(job.endTime)}</span><span><MapPin size={15} />{job.address}</span><span><UserRound size={15} />{job.team?.map((m) => m.name).join(', ') || 'Unassigned'}</span></div><Link href={`/jobs?job=${job.id}`} onClick={onClose} className="button button-primary drawer-action" data-testid="link-open-job-detail">Open full job <ArrowRight size={15} /></Link></aside></div>;
}

function Jobs() {
  const [location, setLocation] = useLocation();
  const jobs = useListJobs();
  const create = useCreateJob();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState('all');
  const params = new URLSearchParams(location.split('?')[1] || '');
  const selectedId = Number(params.get('job')) || null;
  const filtered = (jobs.data || []).filter((job) => (filter === 'all' || job.status === filter) && `${job.clientName} ${job.address} ${job.serviceType}`.toLowerCase().includes(search.toLowerCase()));
  const selectedJob = selectedId ? (jobs.data || []).find((j) => j.id === selectedId) : null;
  if (jobs.isLoading) return <LoadingState label="Loading jobs" />;
  if (jobs.isError) return <ErrorState onRetry={() => void jobs.refetch()} />;
  const submitCreate = (data: { clientName: string; address: string; scheduledDate: string; startTime: string; endTime: string; serviceType: string; notes: string; clientPhone: string }) => create.mutate({ data }, { onSuccess: () => { setShowCreate(false); void queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() }); } });
  return <div className="content-stack">
    <PageIntro eyebrow="Work orders" title="Jobs" body="Every visit, one clear owner, no lost context." action={<button className="button button-primary" onClick={() => setShowCreate(true)} data-testid="button-create-job"><Plus size={16} />Create job</button>} />
    <section className="panel jobs-toolbar"><div className="search-wrap"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search client, address, or service" data-testid="input-search-jobs" /></div><div className="filter-tabs">{['all', 'scheduled', 'in_progress', 'attention', 'completed'].map((value) => <button key={value} className={filter === value ? 'filter-active' : ''} onClick={() => setFilter(value)} data-testid={`button-filter-${value}`}>{value === 'all' ? 'All jobs' : statusLabel(value)}</button>)}</div><span className="job-total mono">{filtered.length} shown</span></section>
    {filtered.length ? <div className="jobs-layout"><section className="job-list" data-testid="job-list">{filtered.map((job) => <button className={`job-list-row ${selectedId === job.id ? 'job-selected' : ''}`} key={job.id} onClick={() => setLocation(`/jobs?job=${job.id}`)} data-testid={`button-job-row-${job.id}`}><span className={`job-status-bar bar-${job.status}`} /><div className="job-list-main"><div className="job-title-line"><strong>{job.clientName}</strong><Badge tone={statusTone(job.status)}>{statusLabel(job.status)}</Badge></div><span><MapPin size={13} />{job.address}</span><small>{job.serviceType} · {formatDate(job.scheduledDate)} · {formatTime(job.startTime)}</small></div><div className="job-list-team">{job.team?.slice(0, 3).map((member) => <Avatar key={member.id} member={member} size="sm" />)}</div><ChevronRight size={16} className="row-chevron" /></button>)}</section>{selectedJob ? <JobDetail job={selectedJob} /> : <div className="panel detail-placeholder dot-grid"><ClipboardCheck size={28} /><strong>Select a job</strong><span>Open a work order to review its team, checklist, and proof trail.</span></div>}</div> : <EmptyState title="No jobs match that view" body="Try clearing the search or changing the status filter." action={<button className="button button-secondary" onClick={() => { setSearch(''); setFilter('all'); }} data-testid="button-clear-job-filters">Clear filters</button>} />}
    {showCreate && <CreateJobDialog pending={create.isPending} onClose={() => setShowCreate(false)} onSubmit={submitCreate} />}
  </div>;
}

function CreateJobDialog({ onClose, onSubmit, pending }: { onClose: () => void; onSubmit: (data: { clientName: string; address: string; scheduledDate: string; startTime: string; endTime: string; serviceType: string; notes: string; clientPhone: string }) => void; pending: boolean }) {
  const [form, setForm] = useState({ clientName: '', address: '', scheduledDate: todayISO(), startTime: '09:00', endTime: '12:00', serviceType: 'Standard clean', notes: '', clientPhone: '' });
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return <div className="modal-scrim"><form className="modal panel" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(form); }}><div className="modal-head"><div><span className="eyebrow">New work order</span><h3>Add a job</h3></div><button type="button" className="icon-button" onClick={onClose} data-testid="button-close-create-job"><X size={17} /></button></div><div className="form-grid"><label>Client name<input required value={form.clientName} onChange={(e) => update('clientName', e.target.value)} data-testid="input-job-client" /></label><label>Client phone<input value={form.clientPhone} onChange={(e) => update('clientPhone', e.target.value)} data-testid="input-job-phone" /></label><label className="span-2">Address<input required value={form.address} onChange={(e) => update('address', e.target.value)} data-testid="input-job-address" /></label><label>Date<input type="date" required value={form.scheduledDate} onChange={(e) => update('scheduledDate', e.target.value)} data-testid="input-job-date" /></label><label>Service type<input required value={form.serviceType} onChange={(e) => update('serviceType', e.target.value)} data-testid="input-job-service" /></label><label>Start<input type="time" required value={form.startTime} onChange={(e) => update('startTime', e.target.value)} data-testid="input-job-start" /></label><label>End<input type="time" required value={form.endTime} onChange={(e) => update('endTime', e.target.value)} data-testid="input-job-end" /></label><label className="span-2">Notes<textarea rows={3} value={form.notes} onChange={(e) => update('notes', e.target.value)} placeholder="Parking, access, or client notes" data-testid="input-job-notes" /></label></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose} data-testid="button-cancel-create-job">Cancel</button><button className="button button-primary" disabled={pending} data-testid="button-submit-create-job">{pending ? 'Creating…' : 'Create job'}<ArrowRight size={15} /></button></div></form></div>;
}

function JobDetail({ job }: { job: Job }) {
  const qc = useQueryClient();
  const detail = useGetJob(job.id, { query: { queryKey: getGetJobQueryKey(job.id) } });
  const update = useUpdateJob();
  const checklist = useUpdateJobChecklist();
  const sendMessage = useSendJobMessage();
  const [message, setMessage] = useState('');
  const current = detail.data || job;
  const patch = (data: Parameters<typeof update.mutate>[0]['data']) => update.mutate({ id: job.id, data }, { onSuccess: (result) => { qc.setQueryData(getGetJobQueryKey(job.id), result); void qc.invalidateQueries({ queryKey: getListJobsQueryKey() }); void qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); } });
  const toggleChecklist = (itemId: number, completed: boolean) => checklist.mutate({ id: job.id, data: { itemId, completed } }, { onSuccess: (result) => { qc.setQueryData(getGetJobQueryKey(job.id), result); void qc.invalidateQueries({ queryKey: getListJobsQueryKey() }); } });
  return <section className="panel job-detail" data-testid={`job-detail-${job.id}`}><div className="detail-top"><div><span className="eyebrow">Job #{String(current.id).padStart(4, '0')} · {formatDate(current.scheduledDate, { weekday: 'long', month: 'short', day: 'numeric' })}</span><h2>{current.clientName}</h2><p><MapPin size={14} />{current.address}</p></div><select value={current.status} onChange={(e) => patch({ status: e.target.value as 'scheduled' | 'in_progress' | 'completed' | 'attention' })} data-testid="select-job-status"><option value="scheduled">Scheduled</option><option value="in_progress">In progress</option><option value="attention">Attention</option><option value="completed">Completed</option></select></div><div className="detail-stat-row"><div><span>Window</span><strong>{formatTime(current.startTime)} – {formatTime(current.endTime)}</strong></div><div><span>Service</span><strong>{current.serviceType}</strong></div><div><span>Contact</span><strong>{current.clientPhone || 'Not provided'}</strong></div></div><div className="detail-section"><div className="detail-section-head"><div><span className="eyebrow">Closeout</span><h3>Checklist</h3></div><span className="mono">{current.checklist?.filter((i) => i.completed).length || 0}/{current.checklist?.length || 0}</span></div>{current.checklist?.length ? <div className="checklist">{current.checklist.map((item) => <label className={`check-row ${item.completed ? 'check-complete' : ''}`} key={item.id}><input type="checkbox" checked={item.completed} onChange={(e) => toggleChecklist(item.id, e.target.checked)} data-testid={`checkbox-checklist-${item.id}`} /><span>{item.label}</span>{item.completed && <Check size={15} />}</label>)}</div> : <p className="muted-copy">No checklist items have been added to this job.</p>}</div><div className="detail-section"><div className="detail-section-head"><div><span className="eyebrow">Crew</span><h3>Assigned team</h3></div><button className="text-button" onClick={() => patch({ teamMemberIds: [] })} data-testid="button-clear-team">Clear team</button></div><div className="assigned-team">{current.team?.length ? current.team.map((member) => <div className="assigned-member" key={member.id}><Avatar member={member} /><div><strong>{member.name}</strong><span>{member.role}</span></div><a href={whatsappUrl(member.phone, `Hi ${member.name}, quick update for ${current.clientName}'s job.`)} target="_blank" rel="noreferrer" className="icon-button" data-testid={`link-whatsapp-team-${member.id}`} aria-label={`Message ${member.name} on WhatsApp`}><MessageSquare size={14} /></a><a href={`tel:${member.phone}`} className="icon-button" data-testid={`link-call-team-${member.id}`} aria-label={`Call ${member.name}`}><Phone size={14} /></a></div>) : <span className="muted-copy">No team assigned.</span>}</div></div><div className="detail-section proof-section"><div className="detail-section-head"><div><span className="eyebrow">Proof trail</span><h3>Photos</h3></div><Badge tone={current.photos?.length ? 'green' : 'neutral'}>{current.photos?.length || 0} uploaded</Badge></div>{current.photos?.length ? <div className="photo-grid">{current.photos.map((photo) => <img key={photo.id} src={photo.url} alt={photo.label} data-testid={`img-proof-${photo.id}`} />)}</div> : <div className="proof-empty"><CheckCircle2 size={17} /><span>Photos from the crew will land here when the job is closed.</span></div>}</div><div className="message-box"><div><span className="eyebrow">Client nudge</span><h3>Send a message</h3></div><div className="message-input"><input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. We’ll see you between 9 and 10." data-testid="input-job-message" /><button disabled={!message.trim() || sendMessage.isPending} onClick={() => sendMessage.mutate({ id: job.id, data: { recipient: 'client', body: message.trim() } }, { onSuccess: () => setMessage('') })} data-testid="button-send-job-message"><Send size={15} /></button></div><span className="message-note"><MessageSquare size={13} /> Goes to {current.clientName} · {sendMessage.isSuccess ? 'Sent just now' : 'Messages are logged to this job'}</span></div></section>;
}

function Team() {
  const team = useListTeam();
  const create = useCreateTeamMember();
  const [showAdd, setShowAdd] = useState(false);
  const available = (team.data || []).filter((m) => m.status === 'available').length;
  if (team.isLoading) return <LoadingState label="Loading the crew" />;
  if (team.isError) return <ErrorState onRetry={() => void team.refetch()} />;
  const submit = (data: { name: string; role: string; phone: string }) => create.mutate({ data }, { onSuccess: () => { setShowAdd(false); void queryClient.invalidateQueries({ queryKey: getListTeamQueryKey() }); } });
  return <div className="content-stack"><PageIntro eyebrow="People on the ground" title="Team" body="Know who is ready, assigned, and taking a well-earned day off." action={<button className="button button-primary" onClick={() => setShowAdd(true)} data-testid="button-add-team-member"><Plus size={16} />Add teammate</button>} /><section className="team-summary"><div className="team-summary-copy"><span className="eyebrow">Crew pulse</span><strong>{available} ready to work</strong><span>{(team.data || []).length} people in your roster</span></div><div className="availability-bars">{(team.data || []).map((member) => <span key={member.id} className={`availability-bar ${member.status}`} title={`${member.name}: ${member.status}`} />)}</div></section>{team.data?.length ? <div className="team-grid">{team.data.map((member) => <article className="panel team-card" key={member.id} data-testid={`team-card-${member.id}`}><div className="team-card-head"><Avatar member={member} size="lg" /><Badge tone={statusTone(member.status)}>{statusLabel(member.status)}</Badge></div><h3>{member.name}</h3><span className="team-role">{member.role}</span><div className="team-contact"><span><Phone size={14} />{member.phone}</span><div className="team-actions"><a href={whatsappUrl(member.phone)} target="_blank" rel="noreferrer" className="button button-secondary" data-testid={`button-whatsapp-member-${member.id}`}><MessageSquare size={14} />WhatsApp</a><a href={`tel:${member.phone}`} className="button button-secondary" data-testid={`button-call-member-${member.id}`}><Phone size={14} />Call</a></div></div></article>)}</div> : <EmptyState title="Your roster is empty" body="Add your first teammate to start assigning work." action={<button className="button button-primary" onClick={() => setShowAdd(true)} data-testid="button-add-first-team-member"><Plus size={15} />Add teammate</button>} />}{showAdd && <AddTeamDialog pending={create.isPending} onClose={() => setShowAdd(false)} onSubmit={submit} />}</div>;
}

function AddTeamDialog({ onClose, onSubmit, pending }: { onClose: () => void; onSubmit: (data: { name: string; role: string; phone: string }) => void; pending: boolean }) {
  const [form, setForm] = useState({ name: '', role: '', phone: '' });
  return <div className="modal-scrim"><form className="modal panel small-modal" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(form); }}><div className="modal-head"><div><span className="eyebrow">Crew roster</span><h3>Add teammate</h3></div><button type="button" className="icon-button" onClick={onClose} data-testid="button-close-add-team"><X size={17} /></button></div><div className="form-stack"><label>Full name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-team-name" /></label><label>Role<input required placeholder="Lead cleaner" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} data-testid="input-team-role" /></label><label>Phone<input required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-team-phone" /></label></div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose} data-testid="button-cancel-add-team">Cancel</button><button className="button button-primary" disabled={pending} data-testid="button-submit-add-team">{pending ? 'Adding…' : 'Add to roster'}</button></div></form></div>;
}

function Settings() {
  const [saved, setSaved] = useState(false);
  const [prefs, setPrefs] = useState({ morning: true, attention: true, proof: true, weekly: false });
  const toggle = (key: keyof typeof prefs) => { setPrefs((v) => ({ ...v, [key]: !v[key] })); setSaved(false); };
  return <div className="content-stack"><PageIntro eyebrow="Control room" title="Settings" body="Set the defaults that keep a small team in sync." /><div className="settings-layout"><section className="panel settings-card"><div className="section-heading"><div><span className="eyebrow">Notifications</span><h3>Keep the right people posted</h3></div><Bell size={18} className="muted-icon" /></div><div className="setting-list">{[{ key: 'morning', title: 'Morning dispatch', body: 'A 7:00 AM recap of today’s jobs and assignments.' }, { key: 'attention', title: 'Attention alerts', body: 'Tell owners when a job needs a decision or is running late.' }, { key: 'proof', title: 'Proof trail updates', body: 'Notify the desk when photos or checklists are added.' }, { key: 'weekly', title: 'Weekly wrap', body: 'A Friday summary of completed jobs and open follow-ups.' }].map((item) => <div className="setting-row" key={item.key}><div><strong>{item.title}</strong><span>{item.body}</span></div><button className={`toggle ${prefs[item.key as keyof typeof prefs] ? 'toggle-on' : ''}`} onClick={() => toggle(item.key as keyof typeof prefs)} aria-pressed={prefs[item.key as keyof typeof prefs]} data-testid={`button-toggle-${item.key}`}><i /></button></div>)}</div></section><section className="panel settings-card"><div className="section-heading"><div><span className="eyebrow">Company profile</span><h3>How your team shows up</h3></div><Home size={18} className="muted-icon" /></div><div className="form-stack"><label>Company name<input defaultValue="Juniper Housekeeping" data-testid="input-company-name" /></label><label>Dispatch phone<input defaultValue="(415) 555-0186" data-testid="input-company-phone" /></label><label>Service area<input defaultValue="San Francisco · East Bay" data-testid="input-company-area" /></label></div><button className="button button-primary save-button" onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 2600); }} data-testid="button-save-settings">{saved ? <><Check size={15} />Saved</> : 'Save company settings'}</button></section></div></div>;
}

function Router() {
  return <ErrorBoundary><Shell><Switch><Route path="/" component={Dashboard} /><Route path="/schedule" component={Schedule} /><Route path="/jobs" component={Jobs} /><Route path="/team" component={Team} /><Route path="/settings" component={Settings} /><Route component={NotFound} /></Switch></Shell></ErrorBoundary>;
}
export default function App() { return <QueryClientProvider client={queryClient}><Router /></QueryClientProvider>; }