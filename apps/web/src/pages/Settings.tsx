import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, XCircle, ChevronDown, Trash2 } from 'lucide-react';
import { get, patch, post, del, qs } from '@/lib/api';
import { Page, PageHeader } from '@/components/Layout';
import { Button, Field, Menu, Modal, PageLoader, Pill, Spinner, Switch, useToast } from '@/components/ui';
import { TIMEZONES } from '@/components/campaign/SettingsTab';
import { fmt } from '@/lib/format';
import { cn } from '@/lib/cn';

function Check({ ok, label, detail }: { ok: boolean; label: string; detail?: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm" title={detail ?? undefined}>
      {ok ? <CheckCircle2 className="h-4 w-4 text-[#15803D]" aria-hidden /> : <XCircle className="h-4 w-4 text-[#B91C1C]" aria-hidden />}
      <span className={ok ? 'text-ink' : 'text-[#991B1B]'}>{label}</span>
    </span>
  );
}

function Deliverability() {
  const [run, setRun] = useState(false);
  const { data, isFetching, refetch } = useQuery({ queryKey: ['deliverability'], queryFn: () => get('/api/deliverability'), enabled: run });
  return (
    <section className="card flex flex-col gap-3 p-5">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <h2 className="h2">Deliverability</h2>
          <p className="mb-0 mt-1 text-[13px] text-muted">SPF, DKIM and DMARC for every sending domain, checked by DNS lookup.</p>
        </div>
        <Button size="sm" loading={isFetching} onClick={() => (run ? refetch() : setRun(true))}>Check DNS</Button>
      </div>
      {data?.domains?.length > 0 && (
        <div className="overflow-x-auto rounded-[10px] border border-soft">
          <table className="tbl">
            <thead><tr><th>Domain</th><th>SPF</th><th>DKIM</th><th>DMARC</th></tr></thead>
            <tbody>
              {data.domains.map((d: any) => (
                <tr key={d.domain}>
                  <td className="font-medium">{d.domain}</td>
                  <td><Check ok={d.spf.ok} label={d.spf.ok ? 'Found' : 'Missing'} detail={d.spf.record} /></td>
                  <td><Check ok={d.dkim.ok} label={d.dkim.ok ? `selector “${d.dkim.selector}”` : 'Not found'} /></td>
                  <td><Check ok={d.dmarc.ok} label={d.dmarc.ok ? 'Found' : 'Missing'} detail={d.dmarc.record} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && !data.domains.length && <p className="m-0 text-sm text-muted">Connect an account to check its domain.</p>}
      <ul className="m-0 list-disc space-y-1 pl-5 text-[13px] text-muted">
        <li>Send campaigns from secondary domains, not your main company domain.</li>
        <li>30–50 campaign emails per mailbox per day; scale by adding mailboxes.</li>
        <li>Warm up new mailboxes for 2–3 weeks and keep warmup running.</li>
        <li>Few links, no attachments, plain text for Step 1. Keep the bounce rate under 2%.</li>
        <li>DKIM is only found for common selectors; if yours is custom, check it at your provider.</li>
      </ul>
    </section>
  );
}

function Suppression() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['suppression', q, page], queryFn: () => get(`/api/suppression${qs({ q, page })}`) });
  const add = async () => {
    try {
      const r = await post('/api/suppression', { text });
      toast(`Added ${r.added}${r.invalid ? ` · ${r.invalid} not valid` : ''}`);
      setText('');
      setAdding(false);
      qc.invalidateQueries({ queryKey: ['suppression'] });
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };
  return (
    <section className="card flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h2 className="h2">Suppression list</h2>
          <p className="mb-0 mt-1 text-[13px] text-muted">Unsubscribed, bounced and blocked emails or domains. They are never emailed again. {data ? `${fmt(data.total)} entries.` : ''}</p>
        </div>
        <input type="search" className="inp w-48" placeholder="Search" aria-label="Search suppression list" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        <Menu label="Suppression actions" items={[{ label: 'Add emails or domains', onClick: () => setAdding(true) }, { label: 'Export CSV', onClick: () => (window.location.href = '/api/suppression?format=csv') }]} />
      </div>
      {isLoading ? (
        <Spinner />
      ) : data?.rows?.length ? (
        <div className="max-h-80 overflow-y-auto rounded-[10px] border border-soft">
          {data.rows.map((r: any) => (
            <div key={r.id} className="flex items-center gap-3 border-b border-soft px-3.5 py-2 text-sm last:border-0">
              <span className="flex-1 truncate">{r.value}</span>
              <Pill bg={r.reason === 'bounced' ? '#FEE2E2' : r.reason === 'unsubscribed' ? '#FEF3C7' : '#F4F4F5'} fg={r.reason === 'bounced' ? '#991B1B' : r.reason === 'unsubscribed' ? '#92400E' : '#3F3F46'}>{r.reason}</Pill>
              <span className="hidden w-24 text-xs text-muted sm:inline">{new Date(r.createdAt).toLocaleDateString()}</span>
              <Button size="sm" icon variant="ghost" aria-label={`Remove ${r.value}`} onClick={async () => { await del(`/api/suppression/${r.id}`); qc.invalidateQueries({ queryKey: ['suppression'] }); }}>
                <Trash2 className="h-4 w-4 text-muted" aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="m-0 text-sm text-muted">{q ? 'No matches.' : 'Empty. Unsubscribes and bounces are added automatically.'}</p>
      )}
      {data?.total > 50 && (
        <div className="flex justify-end gap-2">
          <Button size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button size="sm" disabled={page * 50 >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title="Block emails or domains" width={480} footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" disabled={!text.trim()} onClick={add}>Add</Button></>}>
        <Field label="One per line (emails or whole domains)" hint="Active sequences for these addresses stop immediately.">
          <textarea className="inp h-36 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={'jane@competitor.com\ncompetitor.com'} />
        </Field>
      </Modal>
    </section>
  );
}

function Labels() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['labels'], queryFn: () => get('/api/labels') });
  const [name, setName] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['labels'] });
  return (
    <section className="card flex flex-col gap-3 p-5">
      <h2 className="h2">Lead labels</h2>
      <div className="flex flex-wrap gap-2">
        {(data?.labels ?? []).map((l: any) => (
          <span key={l.id} className="inline-flex items-center gap-1 rounded-full py-1 pl-2.5 pr-1 text-xs font-medium" style={{ background: l.bg, color: l.color }}>
            {l.name}
            <button aria-label={`Delete label ${l.name}`} className="rounded-full p-0.5 hover:bg-black/5" onClick={async () => { if (confirm(`Delete the label "${l.name}"?`)) { await del(`/api/labels/${l.id}`); refresh(); } }}>
              <XCircle className="h-3.5 w-3.5" aria-hidden />
            </button>
          </span>
        ))}
      </div>
      <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; await post('/api/labels', { name }); setName(''); refresh(); }}>
        <input className="inp max-w-xs" placeholder="New label" aria-label="New label name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" disabled={!name.trim()}>Add label</Button>
      </form>
    </section>
  );
}

function Templates() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['templates'], queryFn: () => get('/api/reply-templates') });
  const [edit, setEdit] = useState<any>(null);
  const toast = useToast();
  const save = async () => {
    try {
      if (edit.id) await patch(`/api/reply-templates/${edit.id}`, { name: edit.name, bodyHtml: edit.bodyHtml });
      else await post('/api/reply-templates', { name: edit.name, bodyHtml: edit.bodyHtml });
      qc.invalidateQueries({ queryKey: ['templates'] });
      setEdit(null);
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };
  return (
    <section className="card flex flex-col gap-3 p-5">
      <div className="flex items-center gap-3">
        <h2 className="h2 flex-1">Saved replies</h2>
        <Button size="sm" onClick={() => setEdit({ name: '', bodyHtml: '' })}>New template</Button>
      </div>
      {data?.templates?.length ? (
        <div className="rounded-[10px] border border-soft">
          {data.templates.map((t: any) => (
            <div key={t.id} className="flex items-center gap-3 border-b border-soft px-3.5 py-2 text-sm last:border-0">
              <button className="flex-1 truncate text-left font-medium hover:text-accent" onClick={() => setEdit(t)}>{t.name}</button>
              <Button size="sm" icon variant="ghost" aria-label={`Delete ${t.name}`} onClick={async () => { await del(`/api/reply-templates/${t.id}`); qc.invalidateQueries({ queryKey: ['templates'] }); }}>
                <Trash2 className="h-4 w-4 text-muted" aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="m-0 text-sm text-muted">Reusable answers for the Unibox. Variables like {'{{firstName}}'} and {'{{signature}}'} work.</p>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit template' : 'New template'} width={520} footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" disabled={!edit?.name || !edit?.bodyHtml} onClick={save}>Save</Button></>}>
        {edit && (
          <div className="flex flex-col gap-3">
            <Field label="Name"><input className="inp" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Reply"><textarea className="inp h-40" value={edit.bodyHtml} onChange={(e) => setEdit({ ...edit, bodyHtml: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </section>
  );
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: () => get('/api/settings') });
  const [f, setF] = useState<any>(null);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [saving, setSaving] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    if (data) setF({ trackingDomain: data.trackingDomain, defaultTimezone: data.defaultTimezone, notifyEmail: data.notifyEmail, delayUnit: data.delayUnit });
  }, [data]);
  if (isLoading || !f) return <PageLoader />;
  const save = async () => {
    setSaving(true);
    try {
      const body: any = { ...f };
      if (data.delayUnitLockedByEnv) delete body.delayUnit;
      if (pw.newPassword) Object.assign(body, pw);
      const r = await patch('/api/settings', body);
      toast(r.passwordChanged ? 'Saved. Password changed — sign in again.' : 'Settings saved');
      setPw({ currentPassword: '', newPassword: '' });
      qc.invalidateQueries({ queryKey: ['settings'] });
      if (r.passwordChanged) setTimeout(() => (window.location.href = '/login'), 1200);
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  const tz = TIMEZONES.includes(f.defaultTimezone) ? TIMEZONES : [f.defaultTimezone, ...TIMEZONES];
  return (
    <Page>
      <PageHeader title="Settings" subtitle={`Signed in as ${data.adminEmail}`}>
        <Button variant="primary" loading={saving} onClick={save}>Save changes</Button>
      </PageHeader>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[1_1_440px] flex-col gap-4">
          <section className="card flex flex-col gap-3.5 p-5">
            <h2 className="h2">General</h2>
            <Field label="Tracking domain" hint={<>A CNAME such as track.yourdomain.com pointing at this server. Used for open pixels, click links and unsubscribe links. Empty = {data.trackingUrl}</>}>
              <input className="inp" value={f.trackingDomain} onChange={(e) => setF({ ...f, trackingDomain: e.target.value })} placeholder="track.yourdomain.com" />
            </Field>
            <Field label="Timezone for analytics and daily limits">
              <select className="inp" value={f.defaultTimezone} onChange={(e) => setF({ ...f, defaultTimezone: e.target.value })}>
                {tz.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Send test emails to" hint="Defaults to your admin email.">
              <input className="inp" type="email" value={f.notifyEmail} onChange={(e) => setF({ ...f, notifyEmail: e.target.value })} placeholder={data.adminEmail} />
            </Field>
          </section>
          <section className="card flex flex-col gap-3.5 p-5">
            <h2 className="h2">Password</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Current password"><input className="inp" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
              <Field label="New password"><input className="inp" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
            </div>
            <p className="m-0 text-xs text-muted">If ADMIN_PASSWORD is set in .env, it is applied again on the next restart. Clear it after the first start to manage the password here.</p>
          </section>
          <section className="card flex flex-col p-5">
            <button type="button" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)} className="flex items-center gap-3 text-left text-sm font-medium text-accent">
              Advanced
              <span className="flex-1 text-xs font-normal text-muted">Testing helpers</span>
              <ChevronDown className={cn('h-4 w-4 transition-transform', advanced && 'rotate-180')} aria-hidden />
            </button>
            {advanced && (
              <div className="mt-3 flex items-center gap-3 border-t border-soft pt-3">
                <span className="flex-1">
                  <span className="block text-sm font-medium">Count step delays in minutes</span>
                  <span className="text-xs text-muted">{data.delayUnitLockedByEnv ? 'Turned on by DELAY_UNIT=minutes in .env.' : 'For testing only: “wait 2 days” becomes 2 minutes. Turn off before real campaigns.'}</span>
                </span>
                <Switch label="Count step delays in minutes" checked={f.delayUnit === 'minutes'} disabled={data.delayUnitLockedByEnv} onChange={(v) => setF({ ...f, delayUnit: v ? 'minutes' : 'days' })} />
              </div>
            )}
          </section>
        </div>
        <div className="flex min-w-0 flex-[1_1_440px] flex-col gap-4">
          <Deliverability />
          <Suppression />
          <Labels />
          <Templates />
        </div>
      </div>
    </Page>
  );
}
