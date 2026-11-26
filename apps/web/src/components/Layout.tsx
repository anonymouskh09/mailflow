import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Mail, Send, Inbox, Settings, LogOut, Menu as MenuIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { get, post } from '@/lib/api';
import { cn } from '@/lib/cn';

export function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-3 pb-5 text-[17px] font-bold">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent">
        <Send className="h-4 w-4 text-white" strokeWidth={2} aria-hidden />
      </span>
      MailFlow
    </div>
  );
}

function NavItem({ to, icon: Icon, children, badge, end }: { to: string; icon: typeof Mail; children: string; badge?: number; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => cn('flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-medium', isActive ? 'bg-accent-soft text-accent-dark hover:text-accent-dark' : 'text-[#3F3F46] hover:bg-[#F4F4F5] hover:text-ink')}
    >
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden />
      {children}
      {!!badge && (
        <span className="ml-auto rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-white" aria-label={`${badge} unread`}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  );
}

export function Layout() {
  const { data } = useQuery({ queryKey: ['unread'], queryFn: () => get<{ count: number }>('/api/unibox/unread-count'), refetchInterval: 30_000 });
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
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
        <div className="-mb-5">
          <Logo />
        </div>
        <button className="rounded-lg p-2 hover:bg-[#F4F4F5]" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(!open)}>
          <MenuIcon className="h-5 w-5" aria-hidden />
        </button>
      </div>
      <aside className={cn('flex-col gap-1 border-r border-line bg-white px-3 py-5 md:sticky md:top-0 md:flex md:h-screen md:w-[220px] md:flex-none', open ? 'flex' : 'hidden')} onClick={() => setOpen(false)}>
        <div className="hidden md:block">
          <Logo />
        </div>
        <nav aria-label="Main" className="flex flex-col gap-1">
          <NavItem to="/accounts" icon={Mail}>
            Email accounts
          </NavItem>
          <NavItem to="/campaigns" icon={Send}>
            Campaigns
          </NavItem>
          <NavItem to="/unibox" icon={Inbox} badge={data?.count}>
            Unibox
          </NavItem>
        </nav>
        <div className="flex-1" />
        <NavItem to="/" end icon={BarChart3}>
          Dashboard
        </NavItem>
        <NavItem to="/settings" icon={Settings}>
          Settings
        </NavItem>
        <button onClick={logout} className="flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-[#3F3F46] hover:bg-[#F4F4F5]">
          <LogOut className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden />
          Sign out
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
