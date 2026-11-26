import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, ChevronLeft, Mail, Server, FileUp, LayoutGrid, CheckCircle2, XCircle } from 'lucide-react';
import { Modal, Button, Field, Checkbox, Spinner, useToast } from '@/components/ui';
import { get, post } from '@/lib/api';
import { cn } from '@/lib/cn';

type View = 'home' | 'outlook' | 'custom' | 'workspace' | 'csv';
const SESSION_KEY = 'mf_connected_session';
const KEEP_KEY = 'mf_keep_adding';

export function sessionConnected(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || '[]');
  } catch {
    return [];
  }
}
export function addSessionConnected(email: string) {
  const list = sessionConnected();
  if (!list.includes(email)) list.push(email);
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(list));
}
export const keepAdding = () => sessionStorage.getItem(KEEP_KEY) !== '0';
export const setKeepAdding = (v: boolean) => sessionStorage.setItem(KEEP_KEY, v ? '1' : '0');
export const clearSession = () => sessionStorage.removeItem(SESSION_KEY);

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" />
      <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" />
      <path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2z" />
      <path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.8 9.4 6 12 6z" />
    </svg>
  );
}

function Option({ icon, title, desc, onClick }: { icon: React.ReactNode; title: string; desc: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3.5 rounded-[10px] border border-line bg-white px-4 py-3.5 text-left text-ink hover:border-[#A5B4FC] hover:bg-[#FAFAFF]">
      <span className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-[10px] bg-[#F4F4F5] text-[#3F3F46]">{icon}</span>
      <span className="flex-1">
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className="text-[13px] text-muted">{desc}</span>
      </span>
      <ChevronRight className="h-4 w-4 text-subtle" aria-hidden />
    </button>
  );
}

export function TestResultLine({ label, r }: { label: string; r?: { ok: boolean; error?: string } | null }) {
  if (!r) return null;
  return (
    <div className="flex items-start gap-2 text-sm">
      {r.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-[#15803D]" aria-hidden /> : <XCircle className="mt-0.5 h-4 w-4 flex-none text-[#B91C1C]" aria-hidden />}
      <span>
        <span className="font-medium">{label}:</span> {r.ok ? 'OK' : <span className="text-[#991B1B]">{r.error}</span>}
      </span>
    </div>
  );
}

function PasswordForm({ provider, onDone }: { provider: 'outlook' | 'custom'; onDone: (email: string) => void }) {
  const [f, setF] = useState({ fromName: '', email: '', password: '', username: '', smtpHost: '', smtpPort: '587', imapHost: '', imapPort: '993', smtpSecure: false, imapSecure: true });
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setResult(null);
    const body: any = { provider, fromName: f.fromName, email: f.email, password: f.password };
    if (f.username) body.username = f.username;
    if (provider === 'custom') Object.assign(body, { smtpHost: f.smtpHost, smtpPort: Number(f.smtpPort), smtpSecure: f.smtpSecure || f.smtpPort === '465', imapHost: f.imapHost, imapPort: Number(f.imapPort), imapSecure: f.imapSecure });
    try {
      const res = await post('/api/accounts', body);
      setResult(res.test);
      onDone(f.email.toLowerCase());
    } catch (err: any) {
      if (err.data?.test) setResult(err.data.test);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3.5">
      {provider === 'outlook' && <p className="m-0 rounded-lg bg-ground p-3 text-[13px] text-muted">Server settings are filled in for you: smtp.office365.com:587 (STARTTLS) and outlook.office365.com:993. Your Microsoft 365 tenant must allow SMTP AUTH for this mailbox. Use an app password if MFA is on.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From name">
          <input className="inp" required value={f.fromName} onChange={set('fromName')} placeholder="Jane Doe" />
        </Field>
        <Field label="Email">
          <input className="inp" type="email" required value={f.email} onChange={set('email')} placeholder="jane@yourdomain.com" />
        </Field>
      </div>
      <Field label={provider === 'outlook' ? 'App password' : 'Password'}>
        <input className="inp" type="password" required autoComplete="new-password" value={f.password} onChange={set('password')} />
      </Field>
      {provider === 'custom' && (
        <>
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <Field label="SMTP host">
              <input className="inp" required value={f.smtpHost} onChange={set('smtpHost')} placeholder="smtp.zoho.com" />
            </Field>
            <Field label="SMTP port">
              <input className="inp" required inputMode="numeric" value={f.smtpPort} onChange={set('smtpPort')} />
            </Field>
            <Field label="IMAP host">
              <input className="inp" required value={f.imapHost} onChange={set('imapHost')} placeholder="imap.zoho.com" />
            </Field>
            <Field label="IMAP port">
              <input className="inp" required inputMode="numeric" value={f.imapPort} onChange={set('imapPort')} />
            </Field>
          </div>
        </>
      )}
      <button type="button" className="self-start text-sm font-medium text-accent" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
        {advanced ? 'Hide advanced' : 'Advanced'}
      </button>
      {advanced && (
        <div className="flex flex-col gap-3 rounded-lg border border-soft p-3">
          <Field label="Username (if different from email)">
            <input className="inp" value={f.username} onChange={set('username')} />
          </Field>
          {provider === 'custom' && (
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-accent" checked={f.smtpSecure} onChange={set('smtpSecure')} /> SMTP uses SSL/TLS (port 465)
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-accent" checked={f.imapSecure} onChange={set('imapSecure')} /> IMAP uses SSL/TLS
              </label>
            </div>
          )}
        </div>
      )}
      {result && (
        <div className="flex flex-col gap-1.5 rounded-lg bg-ground p-3">
          <TestResultLine label="Sending (SMTP)" r={result.smtp} />
          <TestResultLine label="Inbox (IMAP)" r={result.imap} />
          {result.ok && <div className="text-sm font-medium text-[#166534]">Saved. Add another or click Done.</div>}
        </div>
      )}
      {error && <p role="alert" className="m-0 text-sm text-[#B91C1C]">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={busy}>
          Test &amp; save
        </Button>
      </div>
    </form>
  );
}

function WorkspaceFlow({ onDone }: { onDone: (emails: string[], ids: string[]) => void }) {
  const { data: list } = useQuery({ queryKey: ['workspaces'], queryFn: () => get('/api/google-workspaces') });
  const [wsId, setWsId] = useState<string | null>(null);
  const [f, setF] = useState({ domain: '', adminEmail: '', json: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [users, setUsers] = useState<any[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [report, setReport] = useState<any>(null);
  const loadUsers = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await get(`/api/google-workspaces/${id}/users`);
      setUsers(res.users);
      setSel(new Set(res.users.filter((u: any) => !u.connected && !u.suspended).map((u: any) => u.email)));
      setWsId(id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const ws = await post('/api/google-workspaces', { domain: f.domain, adminEmail: f.adminEmail, serviceAccountJson: f.json });
      setBusy(false);
      await loadUsers(ws.id);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };
  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await post(`/api/google-workspaces/${wsId}/connect`, { emails: [...sel] });
      setReport(res);
      const ok = res.rows.filter((r: any) => r.ok);
      onDone(ok.map((r: any) => r.email), ok.map((r: any) => r.account?.id).filter(Boolean));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  if (report)
    return (
      <div className="flex flex-col gap-2">
        <div className="text-sm font-medium">
          {report.succeeded} connected · {report.failed} failed
        </div>
        <div className="max-h-64 overflow-y-auto rounded-lg border border-soft">
          {report.rows.map((r: any) => (
            <div key={r.email} className="flex items-start gap-2 border-b border-soft px-3 py-2 text-sm last:border-0">
              {r.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-[#15803D]" aria-hidden /> : <XCircle className="mt-0.5 h-4 w-4 text-[#B91C1C]" aria-hidden />}
              <span className="flex-1">
                {r.email}
                {!r.ok && <span className="block text-xs text-[#991B1B]">{r.error ?? [r.smtp?.error, r.imap?.error].filter(Boolean).join(' · ')}</span>}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  if (users)
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Checkbox label="Select all" checked={sel.size > 0 && sel.size === users.filter((u) => !u.suspended).length} onChange={(v) => setSel(new Set(v ? users.filter((u) => !u.suspended).map((u) => u.email) : []))} />
          <span className="flex-1 font-medium">{users.length} mailboxes</span>
          <span className="text-muted">{sel.size} selected</span>
        </div>
        <div className="max-h-72 overflow-y-auto rounded-lg border border-soft">
          {users.map((u) => (
            <label key={u.email} className={cn('flex cursor-pointer items-center gap-3 border-b border-soft px-3 py-2 text-sm last:border-0', u.suspended && 'opacity-50')}>
              <Checkbox
                label={`Select ${u.email}`}
                checked={sel.has(u.email)}
                onChange={(v) => {
                  const s = new Set(sel);
                  if (v) s.add(u.email); else s.delete(u.email);
                  setSel(s);
                }}
              />
              <span className="flex-1 truncate">
                {u.email} <span className="text-muted">{u.name}</span>
              </span>
              {u.connected && <span className="text-xs text-muted">already connected</span>}
              {u.suspended && <span className="text-xs text-muted">suspended</span>}
            </label>
          ))}
        </div>
        {error && <p role="alert" className="m-0 text-sm text-[#B91C1C]">{error}</p>}
        <div className="flex justify-end">
          <Button variant="primary" loading={busy} disabled={!sel.size} onClick={connect}>
            Connect {sel.size} mailboxes
          </Button>
        </div>
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      {list?.workspaces?.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="lbl">Saved domains</span>
          {list.workspaces.map((w: any) => (
            <button key={w.id} onClick={() => loadUsers(w.id)} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-left text-sm hover:bg-[#FAFAFF]">
              <span className="flex-1 font-medium">{w.domain}</span>
              <span className="text-muted">{w.accounts} connected</span>
              <ChevronRight className="h-4 w-4 text-subtle" aria-hidden />
            </button>
          ))}
        </div>
      )}
      <form onSubmit={save} className="flex flex-col gap-3">
        <p className="m-0 rounded-lg bg-ground p-3 text-[13px] text-muted">
          In Google Cloud create a service account, enable domain-wide delegation, and in the Workspace Admin console authorise its client ID for the scopes <code>https://mail.google.com/</code> and <code>https://www.googleapis.com/auth/admin.directory.user.readonly</code>. See DEPLOY.md.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Domain">
            <input className="inp" required value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} placeholder="yourdomain.com" />
          </Field>
          <Field label="Workspace admin email">
            <input className="inp" type="email" required value={f.adminEmail} onChange={(e) => setF({ ...f, adminEmail: e.target.value })} placeholder="admin@yourdomain.com" />
          </Field>
        </div>
        <Field label="Service account key (JSON)">
          <textarea className="inp h-28 font-mono text-xs" required value={f.json} onChange={(e) => setF({ ...f, json: e.target.value })} placeholder='{"type": "service_account", ...}' />
        </Field>
        <input
          type="file"
          accept=".json,application/json"
          aria-label="Upload service account JSON file"
          className="text-sm"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) setF({ ...f, json: await file.text() });
          }}
        />
        {error && <p role="alert" className="m-0 text-sm text-[#B91C1C]">{error}</p>}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={busy}>
            List mailboxes
          </Button>
        </div>
      </form>
    </div>
  );
}

function CsvFlow({ onDone }: { onDone: (emails: string[], ids: string[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<any>(null);
  const [fileName, setFileName] = useState('');
  const upload = async (file: File) => {
    setFileName(file.name);
    setBusy(true);
    setError('');
    setReport(null);
    try {
      const res = await post('/api/accounts/import-csv', { csv: await file.text() });
      setReport(res);
      const ok = res.rows.filter((r: any) => r.ok);
      onDone(ok.map((r: any) => r.email), ok.map((r: any) => r.id));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm text-muted">
        Columns: email, from_name, password, smtp_host, smtp_port, imap_host, imap_port, daily_limit, warmup (yes / no). Every row is tested before it is saved.{' '}
        <a href="/api/accounts/csv-template" download>
          Download template
        </a>
      </p>
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-[10px] border border-dashed border-[#C7C7CF] bg-white px-4 py-8 text-center text-sm hover:bg-[#FAFAFF]">
        <FileUp className="h-6 w-6 text-accent" aria-hidden />
        <span className="font-medium text-accent">{fileName || 'Choose a CSV file'}</span>
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </label>
      {busy && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner className="h-4 w-4" /> Testing every account — this can take a minute…
        </div>
      )}
      {error && <p role="alert" className="m-0 text-sm text-[#B91C1C]">{error}</p>}
      {report && (
        <>
          <div className="text-sm font-medium">
            {report.succeeded} of {report.total} connected · {report.failed} failed
          </div>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-soft">
            {report.rows.map((r: any) => (
              <div key={r.row} className="flex items-start gap-2 border-b border-soft px-3 py-2 text-sm last:border-0">
                {r.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-[#15803D]" aria-hidden /> : <XCircle className="mt-0.5 h-4 w-4 flex-none text-[#B91C1C]" aria-hidden />}
                <span className="flex-1">
                  <span className="text-muted">Row {r.row} · </span>
                  {r.email || '(no email)'}
                  {!r.ok && <span className="block text-xs text-[#991B1B]">{r.error}</span>}
                  {!r.ok && r.smtp && (
                    <span className="block text-xs text-muted">
                      SMTP {r.smtp.ok ? 'OK' : 'failed'} · IMAP {r.imap?.ok ? 'OK' : 'failed'}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function AddAccountsModal({ open, onClose, onApplySettings, initialView = 'home', autoContinue = false, notice }: { open: boolean; onClose: () => void; onApplySettings: (ids: string[]) => void; initialView?: View; autoContinue?: boolean; notice?: React.ReactNode }) {
  const [continuing, setContinuing] = useState(autoContinue);
  useEffect(() => setContinuing(autoContinue), [autoContinue]);
  const [view, setView] = useState<View>(initialView);
  const [connected, setConnected] = useState<string[]>(sessionConnected());
  const [newIds, setNewIds] = useState<string[]>([]);
  const [keep, setKeep] = useState(keepAdding());
  const qc = useQueryClient();
  const toast = useToast();
  const { data: gStatus } = useQuery({ queryKey: ['google-status'], queryFn: () => get('/api/oauth/google/status'), enabled: open });
  useEffect(() => {
    if (open) {
      setView(initialView);
      setConnected(sessionConnected());
    }
  }, [open, initialView]);
  const added = (emails: string[], ids: string[] = []) => {
    emails.forEach(addSessionConnected);
    setConnected(sessionConnected());
    setNewIds((x) => [...new Set([...x, ...ids])]);
    qc.invalidateQueries({ queryKey: ['accounts'] });
  };
  const connectGoogle = () => {
    if (gStatus && !gStatus.configured) {
      toast('Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (see DEPLOY.md).', 'error');
      return;
    }
    setKeepAdding(keep);
    window.location.href = `/api/oauth/google/start${keep ? '?again=1' : ''}`;
  };
  const close = () => {
    clearSession();
    setConnected([]);
    setNewIds([]);
    onClose();
  };
  const titles: Record<View, string> = { home: 'Add email accounts', outlook: 'Outlook / Microsoft 365', custom: 'Any provider (SMTP / IMAP)', workspace: 'Whole Google Workspace domain', csv: 'Bulk import from CSV' };
  return (
    <Modal
      open={open}
      onClose={close}
      title={titles[view]}
      description={view === 'home' ? 'Connect one or many mailboxes. You can change limits and warmup for all of them after.' : undefined}
      footer={
        <>
          {view !== 'home' && (
            <Button variant="ghost" onClick={() => setView('home')} className="mr-auto">
              <ChevronLeft className="h-4 w-4" aria-hidden />
              Back
            </Button>
          )}
          {newIds.length > 0 && <Button onClick={() => onApplySettings(newIds)}>Apply settings to {newIds.length} new</Button>}
          <Button onClick={close}>Done</Button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        {notice}
        {view === 'home' && continuing && <KeepAddingCountdown onStop={() => setContinuing(false)} />}
        {view === 'home' && (
          <>
            <div className="flex flex-wrap items-center gap-3.5 rounded-[10px] border border-accent px-4 py-3.5 shadow-[0_0_0_3px_#EEF2FF]">
              <span className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-[10px] border border-line bg-white">
                <GoogleIcon />
              </span>
              <span className="min-w-[220px] flex-1">
                <span className="block text-[15px] font-semibold">Gmail / Google Workspace</span>
                <span className="text-[13px] text-muted">One click, no password. Add 10–20 accounts in a row.</span>
              </span>
              <Button variant="primary" onClick={connectGoogle}>
                Connect with Google
              </Button>
              <label className="flex basis-full items-center gap-2 pl-[54px] text-[13px] text-[#3F3F46]">
                <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="h-4 w-4 accent-accent" />
                Keep adding — reopen Google after each account
              </label>
            </div>
            <Option icon={<LayoutGrid className="h-5 w-5" strokeWidth={1.8} />} title="Whole Google Workspace domain" desc="Admin access: connect every mailbox on a domain you own at once" onClick={() => setView('workspace')} />
            <Option icon={<Mail className="h-5 w-5" strokeWidth={1.8} />} title="Outlook / Microsoft 365" desc="Email + app password (SMTP / IMAP filled in for you)" onClick={() => setView('outlook')} />
            <Option icon={<Server className="h-5 w-5" strokeWidth={1.8} />} title="Any provider (SMTP / IMAP)" desc="Zoho, cPanel, Yandex, custom servers" onClick={() => setView('custom')} />
            <Option
              icon={<FileUp className="h-5 w-5" strokeWidth={1.8} />}
              title="Bulk import from CSV"
              desc={
                <>
                  Many SMTP / IMAP accounts at once · <span className="font-medium text-accent">Download template</span>
                </>
              }
              onClick={() => setView('csv')}
            />
          </>
        )}
        {(view === 'outlook' || view === 'custom') && <PasswordForm key={view} provider={view} onDone={(e) => added([e])} />}
        {view === 'workspace' && <WorkspaceFlow onDone={added} />}
        {view === 'csv' && <CsvFlow onDone={added} />}
        {connected.length > 0 && (
          <div className="mt-1 rounded-[10px] bg-ground px-4 py-3.5">
            <div className="mb-2 text-[13px] font-semibold">Connected in this session ({connected.length})</div>
            <div className="max-h-40 overflow-y-auto">
              {connected.map((e) => (
                <div key={e} className="flex items-center gap-2 py-0.5 text-[13px]">
                  <CheckCircle2 className="h-4 w-4 text-[#15803D]" aria-hidden />
                  {e}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Shown after returning from Google with ?again=1: reopen the chooser for the next mailbox. */
export function KeepAddingCountdown({ onStop }: { onStop: () => void }) {
  const [n, setN] = useState(3);
  const stopped = useRef(false);
  useEffect(() => {
    const t = setInterval(() => setN((x) => x - 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (n <= 0 && !stopped.current) window.location.href = '/api/oauth/google/start?again=1';
  }, [n]);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[10px] bg-accent-soft px-4 py-3 text-sm text-accent-dark">
      <span className="flex-1">Opening Google for the next mailbox in {Math.max(n, 0)}s…</span>
      <Button
        size="sm"
        onClick={() => {
          stopped.current = true;
          setKeepAdding(false);
          onStop();
        }}
      >
        Stop adding
      </Button>
    </div>
  );
}
