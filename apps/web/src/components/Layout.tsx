import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Mail, Send, Inbox, Settings, LogOut, Menu as MenuIcon, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { get, post } from '@/lib/api';
import { cn } from '@/lib/cn';

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5 text-[17px] font-bold', compact ? 'justify-center' : 'px-3')}>
      <span className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-accent">
        <Send className="h-4 w-4 text-white" strokeWidth={2} aria-hidden />
      </span>
      {!compact && 'MailFlow'}
    </div>
  );
}

const SIDEBAR_KEY = 'mf_sidebar_collapsed';

function NavItem({ to, icon: Icon, children, badge, end, collapsed }: { to: string; icon: typeof Mail; children: string; badge?: number; end?: boolean; collapsed?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? children : undefined}
      className={({ isActive }) =>
        cn(
          'relative flex min-h-10 items-center gap-2.5 rounded-lg text-sm font-medium',
          collapsed ? 'justify-center px-0' : 'px-3',
          isActive ? 'bg-accent-soft text-accent-dark hover:text-accent-dark' : 'text-[#3F3F46] hover:bg-[#F4F4F5] hover:text-ink',
        )
      }
    >
      <Icon className="h-[18px] w-[18px] flex-none" strokeWidth={1.8} aria-hidden />
      <span className={collapsed ? 'sr-only' : undefined}>{children}</span>
      {!!badge &&
        (collapsed ? (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent" aria-label={`${badge} unread`} />
        ) : (
          <span className="ml-auto rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-white" aria-label={`${badge} unread`}>
            {badge > 99 ? '99+' : badge}
          </span>
        ))}
    </NavLink>
  );
}

export function Layout() {
  const { data } = useQuery({ queryKey: ['unread'], queryFn: () => get<{ count: number }>('/api/unibox/unread-count'), refetchInterval: 30_000 });
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  // Desktop sidebar can be collapsed to icons; remembered per browser. Ctrl/Cmd + B toggles it.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleSidebar = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, c ? '0' : '1');
      } catch {}
      return !c;
    });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && !(e.target as HTMLElement)?.closest?.('input,textarea,[contenteditable="true"]')) {
        e.preventDefault();
        toggleSidebar();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  // Optional browser notification when new replies arrive (enabled in Settings).
  const prev = useRef<number | null>(null);
  useEffect(() => {
    const n = data?.count;
    if (n === undefined) return;
    let enabled = false;
    try {
      enabled = localStorage.getItem('mf_notify') === '1';
    } catch {}
    if (enabled && prev.current !== null && n > prev.current && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('MailFlow', { body: `${n - prev.current} new repl${n - prev.current === 1 ? 'y' : 'ies'} in the Unibox` });
    }
    prev.current = n;
  }, [data?.count]);
  const logout = async () => {
    await post('/api/auth/logout');
    qc.clear();
    nav('/login');
  };
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <div className="flex items-center justify-between border-b border-line bg-white px-4 py-3 md:hidden">
        <Logo />
        <button className="rounded-lg p-2 hover:bg-[#F4F4F5]" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(!open)}>
          <MenuIcon className="h-5 w-5" aria-hidden />
        </button>
      </div>
      <aside
        className={cn('flex-col gap-1 border-r border-line bg-white py-5 transition-[width] duration-150 md:sticky md:top-0 md:flex md:h-screen md:flex-none', collapsed ? 'px-3 md:w-16 md:px-2' : 'px-3 md:w-[220px]', open ? 'flex' : 'hidden')}
        onClick={() => setOpen(false)}
      >
        <div className={cn('mb-5 hidden items-center md:flex', collapsed ? 'flex-col gap-3' : 'justify-between')}>
          <Logo compact={collapsed} />
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleSidebar();
            }}
            className="rounded-lg p-1.5 text-muted hover:bg-[#F4F4F5] hover:text-ink"
            aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
            aria-expanded={!collapsed}
            title={`${collapsed ? 'Show' : 'Hide'} sidebar (Ctrl+B)`}
          >
            {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden /> : <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden />}
          </button>
        </div>
        <nav aria-label="Main" className="flex flex-col gap-1">
          <NavItem collapsed={collapsed && !open} to="/accounts" icon={Mail}>
            Email accounts
          </NavItem>
          <NavItem collapsed={collapsed && !open} to="/campaigns" icon={Send}>
            Campaigns
          </NavItem>
          <NavItem collapsed={collapsed && !open} to="/unibox" icon={Inbox} badge={data?.count}>
            Unibox
          </NavItem>
        </nav>
        <div className="flex-1" />
        <NavItem collapsed={collapsed && !open} to="/" end icon={BarChart3}>
          Dashboard
        </NavItem>
        <NavItem collapsed={collapsed && !open} to="/settings" icon={Settings}>
          Settings
        </NavItem>
        <button onClick={logout} title={collapsed ? 'Sign out' : undefined} className={cn('flex min-h-10 items-center gap-2.5 rounded-lg text-sm font-medium text-[#3F3F46] hover:bg-[#F4F4F5]', collapsed && !open ? 'justify-center' : 'px-3')}>
          <LogOut className="h-[18px] w-[18px] flex-none" strokeWidth={1.8} aria-hidden />
          <span className={collapsed && !open ? 'sr-only' : undefined}>Sign out</span>
        </button>
      </aside>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-4 py-6 sm:px-8 sm:py-7', className)}>{children}</div>;
}

export function PageHeader({ title, subtitle, children }: { title: React.ReactNode; subtitle?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-[200px] flex-1">
        <h1 className="m-0 text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
