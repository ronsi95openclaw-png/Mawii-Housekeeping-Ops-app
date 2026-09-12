import { ReactNode, useEffect, useState } from 'react';
import { LoaderCircle, AlertTriangle, Sparkles, X, MapPin, Navigation } from 'lucide-react';

export function formatDate(value?: string | Date, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) {
  if (!value) return '—';
  const date = value instanceof Date
    ? value
    : /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00`)
      : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', options).format(date);
}

export function formatTime(value?: string) {
  if (!value) return '—';
  const [h, m] = value.split(':').map(Number);
  const hour = h > 12 ? h - 12 : h || 12;
  return `${hour}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/**
 * Today where the crew is, not in UTC. toISOString() rolls over at 7pm Central, which put
 * tomorrow's date on new jobs and pushed report ranges a day into the future.
 */
export function todayISO() { return localISO(new Date()); }

export function localISO(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function startOfWeek() {
  const d = new Date(); const day = d.getDay(); d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)); return d;
}

export function statusLabel(status: string) { return status.replace('_', ' '); }

export function initials(member: { initials?: string; name: string }) { 
  return member.initials || member.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase(); 
}

export function Avatar({ member, size = 'md' }: { member?: { id?: number; name: string; initials?: string }; size?: 'sm' | 'md' | 'lg' }) {
  return <span data-testid={`avatar-${member?.id ?? 'fallback'}`} className={`avatar avatar-${size}`}>{member ? initials(member) : '—'}</span>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'orange' | 'red' | 'blue' }) {
  return <span className={`badge badge-${tone}`} data-testid="status-badge">{children}</span>;
}

export function statusTone(status?: string): 'neutral' | 'green' | 'orange' | 'red' | 'blue' {
  if (status === 'completed' || status === 'available' || status === 'approved') return 'green';
  if (status === 'attention' || status === 'off' || status === 'failed' || status === 'rejected') return 'red';
  if (status === 'in_progress' || status === 'assigned' || status === 'queued' || status === 'pending') return 'orange';
  return 'blue';
}

export function LoadingState({ label = 'Loading operations' }: { label?: string }) {
  return <div className="loading-state panel" data-testid="loading-state"><LoaderCircle size={18} className="spin" /><span>{label}</span></div>;
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  return <div className="empty-state panel" data-testid="error-state"><AlertTriangle size={22} /><strong>Couldn’t load this view</strong><p>Try again in a moment. Your saved work is safe.</p>{onRetry && <button className="button button-secondary" onClick={onRetry} data-testid="button-retry">Try again</button>}</div>;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <div className="empty-state panel" data-testid="empty-state"><Sparkles size={22} /><strong>{title}</strong><p>{body}</p>{action}</div>;
}

export function PageIntro({ eyebrow, title, body, action }: { eyebrow: string; title: string; body?: string; action?: ReactNode }) {
  return <div className="page-intro animate-rise"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{body && <p>{body}</p>}</div>{action}</div>;
}

/** True while the viewport is too narrow for the master/detail layout to sit side by side. */
export function useNarrowLayout(query = '(max-width: 1050px)') {
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const sync = (event: MediaQueryListEvent) => setNarrow(event.matches);
    mediaQuery.addEventListener('change', sync);
    return () => mediaQuery.removeEventListener('change', sync);
  }, [query]);

  return narrow;
}

/**
 * Side by side on a wide screen, a dismissible dialog on a narrow one. Without this the
 * detail renders under a full-height list on a phone, and selecting a row looks like a
 * dead tap — which it did on Jobs, Customers and Recurring alike.
 */
export function DetailPane({ onClose, label, testId, children }: { onClose: () => void; label: string; testId?: string; children: ReactNode }) {
  const narrow = useNarrowLayout();
  if (!narrow) return <>{children}</>;

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="detail-overlay" onClick={(event) => event.stopPropagation()}>
        <button className="icon-button detail-overlay-close" onClick={onClose} aria-label={label} data-testid={testId}><X size={17} /></button>
        {children}
      </div>
    </div>
  );
}

/**
 * Tapping an address should offer a choice of map app rather than guessing which one the
 * crew has. There is no web-standard way to open the OS app picker, so both links are
 * shown; each deep-links into its own app on a phone that has it installed.
 */
export function AddressLink({ address }: { address: string }) {
  const [open, setOpen] = useState(false);
  if (!address) return null;
  const query = encodeURIComponent(address);

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', border: 0, background: 'transparent', padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer' }}
        data-testid="button-open-address-menu"
      >
        <MapPin size={14} />{address}
      </button>
      {open && (
        <div className="address-menu panel" onMouseLeave={() => setOpen(false)}>
          <a href={`https://maps.apple.com/?q=${query}`} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} data-testid="link-apple-maps">
            <Navigation size={13} /> Apple Maps
          </a>
          <a href={`https://www.google.com/maps/search/?api=1&query=${query}`} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} data-testid="link-google-maps">
            <Navigation size={13} /> Google Maps
          </a>
        </div>
      )}
    </div>
  );
}

/**
 * Who is actually on a job. `assignedEmployees` is the real assignment record; `team` is
 * the legacy team-member list that only older seeded jobs carry, so both are consulted.
 */
export function jobCrew(job: { assignedEmployees?: Array<{ id: number; name: string }>; team?: Array<{ id: number; name: string }> }) {
  return job.assignedEmployees?.length ? job.assignedEmployees : job.team ?? [];
}

/**
 * Where an activity entry leads. Most name a job; a daily summary describes the whole day,
 * so it opens the schedule rather than being a row that ignores the tap.
 */
export function activityHref(item: { type?: string }): string | null {
  const jobId = (item as { jobId?: number | null }).jobId ?? null;
  if (jobId) return `/jobs?job=${jobId}`;
  if (item.type === 'summary') return '/schedule';
  return null;
}
