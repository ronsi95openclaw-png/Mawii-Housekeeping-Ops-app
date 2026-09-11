import { ReactNode } from 'react';
import { LoaderCircle, AlertTriangle, Sparkles } from 'lucide-react';

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

export function todayISO() { return new Date().toISOString().slice(0, 10); }

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
