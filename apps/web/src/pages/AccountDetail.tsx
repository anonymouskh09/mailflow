import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, X } from 'lucide-react';
import { get, patch, post, del } from '@/lib/api';
import { Page } from '@/components/Layout';
import { Button, Field, Menu, PageLoader, StatusPill, Switch, useToast, Modal } from '@/components/ui';
import { scoreColor, timeAgo, DAYS } from '@/lib/format';
import { PROVIDER_LABEL } from './Accounts';

function ScoreRing({ score }: { score: number | null }) {
  const pct = score ?? 0;
  const c = 2 * Math.PI * 15.5;
  return (
    <svg width="84" height="84" viewBox="0 0 36 36" role="img" aria-label={score === null ? 'No warmup score yet' : `Warmup score ${score} out of 100`}>
      <circle cx="18" cy="18" r="15.5" fill="none" stroke="#F0F0F2" strokeWidth="3.5" />
      {score !== null && <circle cx="18" cy="18" r="15.5" fill="none" stroke={scoreColor(score)} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 18 18)" />}
      <text x="18" y="21.5" textAnchor="middle" fontSize="10" fontWeight="700" fill="#18181B" fontFamily="Inter">
        {score ?? '—'}
      </text>
    </svg>
  );
}

function Dot({ ok }: { ok: boolean | null | undefined }) {
  return <span className="h-2 w-2 flex-none rounded-full" style={{ background: ok === null || ok === undefined ? '#A1A1AA' : ok ? '#15803D' : '#B91C1C' }} aria-hidden />;
}

export default function AccountDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['accounts', id], queryFn: () => get(`/api/accounts/${id}`) });
  const [form, setForm] = useState<any>(null);
  const [w, setW] = useState<any>(null);
  const [tagDraft, setTagDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [connOpen, setConnOpen] = useState(false);
  const [conn, setConn] = useState<any>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [wAdv, setWAdv] = useState(false);

  useEffect(() => {
    if (!data) return;
    const a = data.account;
    setForm({ fromName: a.fromName, dailyLimit: String(a.dailyLimit), gapMinMinutes: String(a.gapMinMinutes), signatureHtml: a.signatureHtml, tags: a.tags });
    const ws = data.warmup.settings ?? { enabled: false, startVolume: 3, increasePerDay: 2, maxVolume: 40, replyRate: 30, workingDays: [0, 1, 2, 3, 4, 5, 6], weekendFactor: 50, keepDuringCampaigns: true };
    setW({ ...ws, startVolume: String(ws.startVolume), increasePerDay: String(ws.increasePerDay), maxVolume: String(ws.maxVolume), replyRate: String(ws.replyRate), weekendFactor: String(ws.weekendFactor) });
    setConn({ smtpHost: a.smtpHost, smtpPort: String(a.smtpPort), imapHost: a.imapHost, imapPort: String(a.imapPort), username: a.username, password: '' });
  }, [data]);

  if (isLoading || !data || !form || !w) return <PageLoader />;
  const a = data.account;
  const stats = data.warmup.stats;
  const daily: { date: string; inbox: number; spam: number }[] = data.warmup.daily;
  const maxBar = Math.max(1, ...daily.map((d) => d.inbox + d.spam));
  const refresh = () => qc.invalidateQueries({ queryKey: ['accounts'] });

  const save = async () => {
    setSaving(true);
    try {
      await patch(`/api/accounts/${id}`, {
        fromName: form.fromName,
        dailyLimit: Number(form.dailyLimit),
        gapMinMinutes: Number(form.gapMinMinutes),
        signatureHtml: form.signatureHtml,
        tags: form.tags,
        warmup: {
          enabled: w.enabled,
          startVolume: Number(w.startVolume),
          increasePerDay: Number(String(w.increasePerDay).replace('+', '')),
          maxVolume: Number(w.maxVolume),
          replyRate: Number(String(w.replyRate).replace('%', '')),
          workingDays: w.workingDays,
          weekendFactor: Number(w.weekendFactor),
          keepDuringCampaigns: w.keepDuringCampaigns,
        },
      });
      toast('Saved');
      refresh();
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };
  const check = async () => {
    try {
      const res = await post(`/api/accounts/${id}/check`);
      toast(res.test.ok ? 'Connection OK' : [res.test.smtp.error, res.test.imap.error].filter(Boolean).join(' · '), res.test.ok ? 'ok' : 'error');
    } catch (err: any) {
      toast(err.message, 'error');
    }
    refresh();
  };
  const reconnect = () => {
    if (a.authType === 'google_oauth') window.location.href = `/api/oauth/google/start?hint=${encodeURIComponent(a.email)}`;
    else if (a.authType === 'password') setConnOpen(true);
    else check();
  };
  const saveConn = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: any = { smtpHost: conn.smtpHost, smtpPort: Number(conn.smtpPort), imapHost: conn.imapHost, imapPort: Number(conn.imapPort), username: conn.username };
    if (conn.password) body.password = conn.password;
    try {
      const res = await patch(`/api/accounts/${id}`, body);
      if (res.test && !res.test.ok) toast([res.test.smtp.error, res.test.imap.error].filter(Boolean).join(' · '), 'error');
      else {
        toast('Connection updated');
        setConnOpen(false);
      }
      refresh();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };
  const ws = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setW({ ...w, [k]: e.target.value });
  const statusText = a.displayStatus === 'paused' ? 'Paused' : undefined;
  const healthy = stats.score === null ? 'No data yet' : stats.score >= 90 ? 'Healthy' : stats.score >= 80 ? 'Fair — keep warming' : 'Needs attention';

  return (
    <Page>
      <div>
        <Link to="/accounts" className="inline-flex items-center gap-1 text-[13px] font-medium">
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          Email accounts
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="m-0 break-all text-2xl font-bold">{a.email}</h1>
          <StatusPill status={a.displayStatus} label={statusText} />
          <span className="flex-auto text-[13px] text-muted">
            {PROVIDER_LABEL[a.provider]} · {a.authType === 'google_oauth' ? 'connected with OAuth' : a.authType === 'google_dwd' ? 'connected via Workspace domain' : 'SMTP / IMAP password'}
          </span>
          <Button variant="primary" loading={saving} onClick={save}>
            Save changes
          </Button>
          <Menu
            label="More account actions"
            items={[
              { label: 'Check connection', onClick: check },
              { label: 'Reconnect', onClick: reconnect },
              { label: 'Send test email', onClick: async () => { try { const r = await post(`/api/accounts/${id}/test-email`); toast(`Test email sent to ${r.to}`); } catch (e: any) { toast(e.message, 'error'); } } },
              { label: a.status === 'paused' ? 'Resume sending' : 'Pause sending', onClick: async () => { await patch(`/api/accounts/${id}`, { status: a.status === 'paused' ? 'active' : 'paused' }); refresh(); } },
              { divider: true, label: '' },
              { label: 'Remove account', danger: true, onClick: () => setConfirmDelete(true) },
            ]}
          />
        </div>
        {a.displayStatus === 'error' && a.lastError && (
          <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-[10px] bg-[#FEE2E2] px-4 py-3 text-sm text-[#991B1B]">
            <span className="flex-1">{a.lastError}</span>
            <Button size="sm" onClick={reconnect}>Reconnect</Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[3_1_560px] flex-col gap-4">
          <section className="card p-5">
            <div className="mb-4 flex items-center gap-3">
              <h2 className="h2 flex-1">Warmup</h2>
              <span className="text-[13px] text-muted">{w.enabled ? 'On' : 'Off'}</span>
              <Switch label="Warmup" checked={w.enabled} onChange={(v) => setW({ ...w, enabled: v })} />
            </div>
            <div className="flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-3.5">
                <ScoreRing score={stats.score} />
                <div>
                  <div className="font-semibold">{healthy}</div>
                  <div className="text-[13px] text-muted">{stats.score === null ? 'Score appears after the first warmup emails are checked' : `${stats.score}% landed in inbox · last 7 days`}</div>
                </div>
              </div>
              <div className="grid flex-[1_1_300px] grid-cols-4 gap-3">
                {[
                  ['Sent', stats.sent],
                  ['Received', stats.received],
                  ['Saved from spam', stats.savedFromSpam],
                  ['Replies', stats.replies],
                ].map(([l, v]) => (
                  <div key={l as string}>
                    <div className="text-xs text-muted">{l}</div>
                    <div className="mt-0.5 text-xl font-bold">{v}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-5">
              <div className="mb-2 flex items-center gap-4">
                <span className="flex-1 text-[13px] font-medium">Inbox vs spam · 14 days</span>
                <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                  <span className="h-2.5 w-2.5 rounded-sm bg-accent" />
                  Inbox
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs text-muted">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[#EA580C]" />
                  Spam
                </span>
              </div>
              <div className="flex h-[110px] items-end gap-1.5 border-b border-line" role="img" aria-label={`Warmup emails per day for 14 days, ${daily.reduce((s, d) => s + d.spam, 0)} landed in spam`}>
                {daily.map((d) => (
                  <div key={d.date} className="flex h-full flex-1 flex-col justify-end" title={`${d.date}: ${d.inbox} inbox, ${d.spam} spam`}>
                    <div className="rounded-t-[3px] bg-[#EA580C]" style={{ height: `${(d.spam / maxBar) * 100}%` }} />
                    <div className={d.spam ? 'bg-accent' : 'rounded-t-[3px] bg-accent'} style={{ height: `${(d.inbox / maxBar) * 100}%` }} />
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3.5">
              <Field label="Start volume / day">
                <input className="inp" inputMode="numeric" value={w.startVolume} onChange={ws('startVolume')} />
              </Field>
              <Field label="Increase per day">
                <input className="inp" inputMode="numeric" value={w.increasePerDay} onChange={ws('increasePerDay')} />
              </Field>
              <Field label="Max warmup / day">
                <input className="inp" inputMode="numeric" value={w.maxVolume} onChange={ws('maxVolume')} />
              </Field>
              <Field label="Reply rate (%)">
                <input className="inp" inputMode="numeric" value={w.replyRate} onChange={ws('replyRate')} />
              </Field>
            </div>
            <p className="mb-0 mt-3 text-[13px] text-muted">
              {w.enabled ? `Today's target: ${data.warmup.todayTarget} warmup emails. ` : 'Warmup is off. '}
              {w.keepDuringCampaigns ? 'Warmup keeps running alongside campaigns.' : 'Warmup pauses while this account is in an active campaign.'}
            </p>
            <button type="button" className="mt-3 text-sm font-medium text-accent" aria-expanded={wAdv} onClick={() => setWAdv(!wAdv)}>
              Advanced
            </button>
            {wAdv && (
              <div className="mt-3 flex flex-col gap-3 rounded-lg border border-soft p-3">
                <div>
                  <span className="lbl">Working days</span>
                  <div className="flex flex-wrap gap-1.5">
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                      const on = w.workingDays.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setW({ ...w, workingDays: on ? w.workingDays.filter((x: number) => x !== d) : [...w.workingDays, d] })}
                          className={on ? 'h-10 w-11 rounded-lg border border-accent bg-accent text-[13px] font-medium text-white' : 'h-10 w-11 rounded-lg border border-line bg-white text-[13px] font-medium text-muted'}
                        >
                          {DAYS[d]}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <Field label="Weekend volume (% of weekday)" className="max-w-[220px]">
                  <input className="inp" inputMode="numeric" value={w.weekendFactor} onChange={ws('weekendFactor')} />
                </Field>
                <label className="flex items-center gap-3 text-sm">
                  <Switch label="Keep running during campaigns" checked={w.keepDuringCampaigns} onChange={(v) => setW({ ...w, keepDuringCampaigns: v })} />
                  Keep running during campaigns (recommended; warmup and campaigns share the daily cap)
                </label>
              </div>
            )}
          </section>
        </div>

        <div className="flex min-w-0 flex-[2_1_340px] flex-col gap-4">
          <section className="card flex flex-col gap-3.5 p-5">
            <h2 className="h2">Sending</h2>
            <Field label="From name">
              <input className="inp" value={form.fromName} onChange={(e) => setForm({ ...form, fromName: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Daily campaign limit">
                <input className="inp" inputMode="numeric" value={form.dailyLimit} onChange={(e) => setForm({ ...form, dailyLimit: e.target.value.replace(/\D/g, '') })} />
              </Field>
              <Field label="Min. gap (minutes)">
                <input className="inp" inputMode="numeric" value={form.gapMinMinutes} onChange={(e) => setForm({ ...form, gapMinMinutes: e.target.value.replace(/\D/g, '') })} />
              </Field>
            </div>
            <p className="-mt-1 mb-0 text-xs text-muted">
              Sent today: {a.sentToday} campaign + {a.warmupSentToday} warmup.
            </p>
            <Field label="Signature" hint="Available in emails as {{signature}}.">
              <textarea className="inp h-[84px] resize-y" value={form.signatureHtml} onChange={(e) => setForm({ ...form, signatureHtml: e.target.value })} />
            </Field>
            <div>
              <span className="lbl">Tags</span>
              <div className="flex flex-wrap gap-1.5">
                {form.tags.map((t: string) => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-full bg-[#F4F4F5] px-2.5 py-1 text-xs font-medium text-[#3F3F46]">
                    {t}
                    <button aria-label={`Remove tag ${t}`} onClick={() => setForm({ ...form, tags: form.tags.filter((x: string) => x !== t) })} className="text-muted hover:text-ink">
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  </span>
                ))}
                {tagDraft === null ? (
                  <button onClick={() => setTagDraft('')} className="rounded-full border border-dashed border-[#D4D4D8] bg-white px-2.5 py-1 text-xs font-medium text-muted">
                    + Add tag
                  </button>
                ) : (
                  <input
                    autoFocus
                    aria-label="New tag"
                    className="h-7 w-32 rounded-full border border-line px-2.5 text-xs"
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onBlur={() => setTagDraft(null)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && tagDraft.trim()) {
                        e.preventDefault();
                        setForm({ ...form, tags: [...new Set([...form.tags, tagDraft.trim()])] });
                        setTagDraft(null);
                      }
                      if (e.key === 'Escape') setTagDraft(null);
                    }}
                  />
                )}
              </div>
            </div>
          </section>

          <section className="card flex flex-col gap-2.5 p-5">
            <h2 className="h2">Connection</h2>
            {a.authType !== 'password' && (
              <div className="flex items-center gap-2 text-sm">
                <Dot ok={a.smtpOk !== false || a.imapOk !== false} />
                <span className="flex-1">{a.authType === 'google_oauth' ? 'Google sign-in' : 'Workspace delegation'}</span>
                <span className="text-[13px] text-muted">{a.smtpOk === false && a.imapOk === false ? 'Failing' : 'Connected'}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm">
              <Dot ok={a.smtpOk} />
              <span className="flex-1">Sending (SMTP)</span>
              <span className="text-[13px] text-muted">{a.smtpOk === null ? '—' : a.smtpOk ? 'OK' : 'Failing'}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Dot ok={a.imapOk} />
              <span className="flex-1">Inbox (IMAP)</span>
              <span className="text-[13px] text-muted">{a.imapOk === null ? '—' : a.imapOk ? 'OK' : 'Failing'}</span>
            </div>
            <p className="mb-0 mt-1 text-xs text-muted">
              {a.smtpHost}:{a.smtpPort} · {a.imapHost}:{a.imapPort} · Last checked {timeAgo(a.lastCheckedAt)}
            </p>
            {data.campaigns.length > 0 && (
              <p className="m-0 text-xs text-muted">
                In campaigns: {data.campaigns.map((c: any) => c.name).join(', ')}
              </p>
            )}
          </section>
        </div>
      </div>

      <Modal
        open={connOpen}
        onClose={() => setConnOpen(false)}
        title="Update connection"
        description="Change the password or server settings. Both logins are tested before saving."
        width={520}
        footer={<><Button onClick={() => setConnOpen(false)}>Cancel</Button><Button variant="primary" type="submit" form="conn-form">Test &amp; save</Button></>}
      >
        <form id="conn-form" onSubmit={saveConn} className="flex flex-col gap-3">
          <Field label="Password / app password" hint="Leave empty to keep the current one">
            <input className="inp" type="password" autoComplete="new-password" value={conn.password} onChange={(e) => setConn({ ...conn, password: e.target.value })} />
          </Field>
          <Field label="Username">
            <input className="inp" value={conn.username} onChange={(e) => setConn({ ...conn, username: e.target.value })} />
          </Field>
          <div className="grid grid-cols-[1fr_100px] gap-3">
            <Field label="SMTP host"><input className="inp" value={conn.smtpHost} onChange={(e) => setConn({ ...conn, smtpHost: e.target.value })} /></Field>
            <Field label="Port"><input className="inp" value={conn.smtpPort} onChange={(e) => setConn({ ...conn, smtpPort: e.target.value })} /></Field>
            <Field label="IMAP host"><input className="inp" value={conn.imapHost} onChange={(e) => setConn({ ...conn, imapHost: e.target.value })} /></Field>
            <Field label="Port"><input className="inp" value={conn.imapPort} onChange={(e) => setConn({ ...conn, imapPort: e.target.value })} /></Field>
          </div>
        </form>
      </Modal>
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Remove this account?"
        description="It stops sending and warming up. The mailbox itself is not changed."
        width={460}
        footer={<><Button onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" onClick={async () => { await del(`/api/accounts/${id}`); refresh(); nav('/accounts'); }}>Remove</Button></>}
      >
        <span />
      </Modal>
    </Page>
  );
}
