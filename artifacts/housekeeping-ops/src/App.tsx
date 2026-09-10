import { useState, type ReactNode, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, useLocation, Link, Redirect } from 'wouter';
import { SignedIn, SignedOut, useUser, useClerk } from '@clerk/clerk-react';
import {
  LayoutDashboard, CalendarDays, ClipboardCheck, UsersRound, Settings2,
  Menu, Bell, Plus, X, ChevronRight, Users, Repeat, ShieldCheck, MapPin,
  DollarSign, Activity as ActivityIcon, LogOut
} from 'lucide-react';
import { useHealthCheck, useListJobs, useGetEmployeeMe } from '@workspace/api-client-react';

import { ErrorBoundary } from '@/components/error-boundary';
import NotFound from '@/pages/not-found';
import { Avatar, LoadingState } from '@/lib/shared';

import { Dashboard } from '@/pages/dashboard';
import { Schedule } from '@/pages/schedule';
import { Jobs } from '@/pages/jobs';
import { Team } from '@/pages/team';
import { Settings } from '@/pages/settings';
import { Customers } from '@/pages/customers';
import { Recurring } from '@/pages/recurring';
import { Field } from '@/pages/field';
import { Quality, Payouts, ActivityPage } from '@/pages/misc';
import { SignInPage, SignUpPage } from '@/pages/auth';

const queryClient = new QueryClient();

const navItemsDispatcher = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/schedule', label: 'Schedule', icon: CalendarDays },
  { href: '/jobs', label: 'Jobs', icon: ClipboardCheck },
  { href: '/customers', label: 'Customers', icon: Users },
  { href: '/recurring', label: 'Recurring', icon: Repeat },
  { href: '/team', label: 'Team', icon: UsersRound },
  { href: '/quality', label: 'Quality', icon: ShieldCheck },
  { href: '/payouts', label: 'Payouts', icon: DollarSign },
  { href: '/activity', label: 'Activity', icon: ActivityIcon },
  { href: '/settings', label: 'Settings', icon: Settings2 },
];

const navItemsCleaner = [
  { href: '/field', label: 'My Jobs', icon: MapPin },
];

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const health = useHealthCheck();
  const jobs = useListJobs();
  const { user } = useUser();
  const { signOut } = useClerk();
  const employeeQuery = useGetEmployeeMe();

  const activeLocation = location.split('?')[0];
  const dateLabel = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());

  if (employeeQuery.isLoading) return <div style={{height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center'}}><LoadingState label="Loading profile" /></div>;

  const role = employeeQuery.data?.role || 'cleaner';
  const isCleaner = role === 'cleaner';

  const navItems = isCleaner ? navItemsCleaner : navItemsDispatcher;

  if (isCleaner && activeLocation === '/') {
    return <Redirect to="/field" />;
  }

  const jobsCount = jobs.data ? jobs.data.filter(j => j.status !== 'completed').length : 0;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <span className="brand-mark"><img src="/mawii-logo.jpeg" alt="" /></span>
          <span><b>Mawii Property Care</b><small>{isCleaner ? 'field app' : 'operations desk'}</small></span>
          <button className="close-sidebar" onClick={() => setOpen(false)} data-testid="button-close-menu"><X size={17} /></button>
        </div>
        <div className="workspace-label eyebrow">{isCleaner ? 'Field Operations' : 'Operations desk'}</div>
        <nav className="main-nav" aria-label="Primary navigation">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => setOpen(false)} className={`nav-link ${activeLocation === href ? 'nav-active' : ''}`} data-testid={`link-nav-${label.toLowerCase()}`}>
              <Icon size={17} />
              <span>{label}</span>
              {label === 'Jobs' && jobsCount > 0 && <span className="nav-count">{jobsCount}</span>}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sync-line">
            <span className={`status-dot ${health.isError ? 'status-dot-warn' : ''}`} />
            {health.isLoading ? 'Checking connection' : health.isError ? 'Connection delayed' : 'Mawii operations online'}
          </div>
          <div className="user-card">
            <Avatar member={{ name: user?.fullName || 'User' }} />
            <div>
              <strong>{user?.fullName || 'Current User'}</strong>
              <small>{role} · {isCleaner ? 'Field' : 'Desk'}</small>
            </div>
            <button className="icon-button" onClick={() => signOut()} aria-label="Sign out" data-testid="button-sign-out">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {open && <button className="sidebar-scrim" onClick={() => setOpen(false)} aria-label="Close navigation" data-testid="button-dismiss-menu" />}

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setOpen(true)} data-testid="button-open-menu"><Menu size={21} /></button>
          <div>
            <span className="eyebrow">Today · {dateLabel}</span>
            <h2>{activeLocation === '/' ? `Good morning, ${user?.firstName || 'Danna'}` : navItems.find((item) => item.href === activeLocation)?.label || 'Operations'}</h2>
          </div>
          <div className="topbar-actions">
            {!isCleaner && (
              <>
                <button className="icon-button notification-button" data-testid="button-notifications"><Bell size={18} /><i /></button>
                <Link href="/jobs" className="button button-primary top-add" data-testid="link-new-job"><Plus size={16} />New job</Link>
              </>
            )}
          </div>
        </header>
        <div className="page-wrap">{children}</div>
      </main>
    </div>
  );
}

function Router() {
  return (
    <ErrorBoundary>
      <Switch>
        <Route path="/sign-in" component={SignInPage} />
        <Route path="/sign-up" component={SignUpPage} />
        <Route>
          <SignedOut>
            <Redirect to="/sign-in" />
          </SignedOut>
          <SignedIn>
            <Shell>
              <Switch>
                <Route path="/" component={Dashboard} />
                <Route path="/schedule" component={Schedule} />
                <Route path="/jobs" component={Jobs} />
                <Route path="/customers" component={Customers} />
                <Route path="/recurring" component={Recurring} />
                <Route path="/team" component={Team} />
                <Route path="/field" component={Field} />
                <Route path="/quality" component={Quality} />
                <Route path="/payouts" component={Payouts} />
                <Route path="/activity" component={ActivityPage} />
                <Route path="/settings" component={Settings} />
                <Route component={NotFound} />
              </Switch>
            </Shell>
          </SignedIn>
        </Route>
      </Switch>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router />
    </QueryClientProvider>
  );
}
