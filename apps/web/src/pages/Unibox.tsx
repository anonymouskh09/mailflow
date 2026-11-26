import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronLeft, Filter as FilterIcon, Send } from 'lucide-react';
import { get, patch, post, del, qs } from '@/lib/api';
import { Button, Dropdown, Empty, Field, Menu, Modal, PageLoader, Pill, Popover, Segmented, Spinner, useToast } from '@/components/ui';
import { fullTime, initials, shortTime } from '@/lib/format';
import { cn } from '@/lib/cn';

function sanitize(html: string) {
  // Lead emails are untrusted: strip scripts, event handlers, remote styles and iframes before rendering.
  return html
    .replace(/<(script|style|iframe|object|embed|link|meta)[\s\S]*?(<\/\1>|\/?>)/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"')
    .replace(/<img[^>]+src=("|')https?:[^>]*>/gi, ''); // no remote images (tracking pixels in replies)
}

function ThreadList({ selected, onSelect }: { selected?: string; onSelect: (id: string) => void }) {
  const [tab, setTab] = useState<'all' | 'unread' | 'interested'>('all');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [f, setF] = useState({ label: '', campaign: '', account: '', from: '', notLeads: '' });
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  const params = { tab, q: debounced, ...f };
  const { data, isLoading } = useQuery({ queryKey: ['threads', params], queryFn: () => get(`/api/unibox/threads${qs(params)}`), refetchInterval: 20_000 });
  const { data: labels } = useQuery({ queryKey: ['labels'], queryFn: () => get('/api/labels') });
  const { data: camps } = useQuery({ queryKey: ['campaigns', 'all'], queryFn: () => get('/api/campaigns') });
  const { data: accts } = useQuery({ queryKey: ['accounts', 'totals'], queryFn: () => get('/api/accounts') });
  const count = Object.values(f).filter(Boolean).length;
  return (
    <section className="flex min-h-0 flex-col border-line bg-white md:w-[340px] md:flex-none md:border-r">
      <div className="flex flex-col gap-2.5 border-b border-soft px-4 pb-3 pt-5">
        <div className="flex items-center gap-2">
          <h1 className="m-0 flex-1 text-xl font-bold">Unibox</h1>
          <Popover
            width={280}
            trigger={({ toggle, ref, open }) => (
              <Button ref={ref} icon aria-label="Filter by label, campaign or account" aria-expanded={open} onClick={toggle} className={count ? 'border-accent text-accent' : undefined}>
                <FilterIcon className="h-4 w-4" strokeWidth={1.8} aria-hidden />
              </Button>
            )}
          >
            <div className="flex flex-col gap-3 p-2">
              <Field label="Label">
                <select className="inp" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })}>
                  <option value="">Any label</option>
                  {(labels?.labels ?? []).map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </Field>
              <Field label="Campaign">
                <select className="inp" value={f.campaign} onChange={(e) => setF({ ...f, campaign: e.target.value })}>
                  <option value="">Any campaign</option>
                  {(camps?.campaigns ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Account">
                <select className="inp" value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })}>
                  <option value="">Any account</option>
                  {(accts?.accounts ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.email}</option>)}
                </select>
              </Field>
              <Field label="Since">
                <input type="date" className="inp" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-accent" checked={f.notLeads === '1'} onChange={(e) => setF({ ...f, notLeads: e.target.checked ? '1' : '' })} />
                Show conversations marked “not a lead”
              </label>
              {count > 0 && <Button size="sm" variant="ghost" onClick={() => setF({ label: '', campaign: '', account: '', from: '', notLeads: '' })}>Clear filters</Button>}
            </div>
          </Popover>
        </div>
        <input type="search" aria-label="Search conversations" placeholder="Search name, company, text" className="inp" value={q} onChange={(e) => setQ(e.target.value)} />
        <Segmented
          label="Show"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'all', label: 'All' },
            { value: 'unread', label: `Unread${data?.unread ? ` ${data.unread}` : ''}` },
            { value: 'interested', label: 'Interested' },
          ]}
          className="[&_button]:h-8"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <PageLoader />
        ) : !data?.threads?.length ? (
          <Empty title={debounced || count || tab !== 'all' ? 'Nothing here' : 'No replies yet'}>{!debounced && !count && tab === 'all' && 'Lead replies from every connected mailbox show up here.'}</Empty>
        ) : (
          data.threads.map((t: any) => (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              aria-current={t.id === selected ? 'true' : undefined}
              className={cn('block w-full border-b border-soft px-4 py-3.5 text-left', t.id === selected ? 'bg-[#F5F5FF] shadow-[inset_3px_0_0_#4F46E5]' : 'bg-white hover:bg-[#FAFAFA]')}
            >
              <span className="flex items-center gap-2">
                {t.unread && <span className="h-2 w-2 flex-none rounded-full bg-accent" aria-label="Unread" />}
                <span className={cn('flex-1 truncate text-sm text-ink', t.unread ? 'font-semibold' : 'font-medium')}>{t.leadName}</span>
                <span className="text-xs text-muted">{shortTime(t.lastMessageAt)}</span>
              </span>
              <span className="mt-1 block truncate text-[13px] text-muted">{t.snippet || '(no text)'}</span>
              {t.label && <Pill bg={t.label.bg} fg={t.label.color} className="mt-2">{t.label.name}</Pill>}
            </button>
          ))
        )}
      </div>
    </section>
  );
}

function ReplyBox({ thread, onSent }: { thread: any; onSent: () => void }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [schedule, setSchedule] = useState<string | null>(null);
  const [forward, setForward] = useState<string | null>(null);
  const [saveTpl, setSaveTpl] = useState<string | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const ta = useRef<HTMLTextAreaElement>(null);
  const { data: tpls } = useQuery({ queryKey: ['templates'], queryFn: () => get('/api/reply-templates') });
  useEffect(() => {
    setBody('');
  }, [thread.id]);
  const send = async (extra: { scheduledAt?: string; forwardTo?: string } = {}) => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      const r = await post(`/api/unibox/threads/${thread.id}/reply`, { bodyHtml: body, ...extra });
      toast(extra.forwardTo ? `Forwarded to ${extra.forwardTo}` : r.scheduled ? 'Reply scheduled' : 'Reply sent');
      setBody('');
      setSchedule(null);
      setForward(null);
      onSent();
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-4 mb-4 rounded-card border border-line bg-white sm:mx-6 sm:mb-6">
      <div className="px-3.5 pt-2.5 text-xs text-muted">Reply from {thread.account.email} · same thread</div>
      <textarea
        ref={ta}
        aria-label="Reply"
        placeholder="Write a reply…  ({{firstName}} and {{signature}} work here)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
        }}
        className="block h-24 w-full resize-none border-0 px-3.5 py-2.5 text-sm outline-none"
      />
      <div className="flex items-center gap-2 border-t border-soft px-3 py-2.5">
        <Popover
          align="left"
          width={260}
          trigger={({ toggle, ref, open }) => (
            <Button ref={ref} size="sm" aria-expanded={open} onClick={toggle}>
              Templates
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
          )}
        >
          {(close) => (
            <div className="max-h-72 overflow-y-auto">
              {!tpls?.templates?.length && <div className="px-3 py-2 text-sm text-muted">No saved replies yet. Write one and choose “Save as template”.</div>}
              {(tpls?.templates ?? []).map((t: any) => (
                <button key={t.id} className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[#F4F4F5]" onClick={() => { setBody((b) => (b ? `${b}\n\n` : '') + t.bodyHtml.replace(/<br\s*\/?>/g, '\n').replace(/<\/p>/g, '\n\n').replace(/<[^>]+>/g, '').trim()); close(); ta.current?.focus(); }}>
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </Popover>
        <span className="flex-1" />
        <Menu
          size="sm"
          label="More send options"
          items={[
            { label: 'Schedule send…', disabled: !body.trim(), onClick: () => setSchedule(new Date(Date.now() + 3600_000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)) },
            { label: 'Forward to…', disabled: !body.trim(), onClick: () => setForward('') },
            { label: 'Save as template', disabled: !body.trim(), onClick: () => setSaveTpl('') },
          ]}
        />
        <Button size="sm" variant="primary" loading={busy} disabled={!body.trim()} onClick={() => send()}>
          Send
          <Send className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
      <Modal open={schedule !== null} onClose={() => setSchedule(null)} title="Schedule send" width={420} footer={<><Button onClick={() => setSchedule(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => schedule && send({ scheduledAt: new Date(schedule).toISOString() })}>Schedule</Button></>}>
        <Field label="Send at"><input type="datetime-local" className="inp" value={schedule ?? ''} onChange={(e) => setSchedule(e.target.value)} /></Field>
      </Modal>
      <Modal open={forward !== null} onClose={() => setForward(null)} title="Forward conversation" description="Sends your note plus the lead's last message to another address. The lead does not see it." width={460} footer={<><Button onClick={() => setForward(null)}>Cancel</Button><Button variant="primary" loading={busy} disabled={!forward} onClick={() => forward && send({ forwardTo: forward })}>Forward</Button></>}>
        <Field label="To"><input type="email" className="inp" value={forward ?? ''} onChange={(e) => setForward(e.target.value)} placeholder="colleague@yourdomain.com" /></Field>
      </Modal>
      <Modal open={saveTpl !== null} onClose={() => setSaveTpl(null)} title="Save as template" width={420} footer={<><Button onClick={() => setSaveTpl(null)}>Cancel</Button><Button variant="primary" disabled={!saveTpl} onClick={async () => { await post('/api/reply-templates', { name: saveTpl, bodyHtml: body }); qc.invalidateQueries({ queryKey: ['templates'] }); toast('Template saved'); setSaveTpl(null); }}>Save</Button></>}>
        <Field label="Name"><input className="inp" value={saveTpl ?? ''} onChange={(e) => setSaveTpl(e.target.value)} placeholder="Send pricing" /></Field>
      </Modal>
    </div>
  );
}

function MoveModal({ threadId, open, onClose }: { threadId: string; open: boolean; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ['campaigns', 'all'], queryFn: () => get('/api/campaigns'), enabled: open });
  const [cid, setCid] = useState('');
  const toast = useToast();
  return (
    <Modal open={open} onClose={onClose} title="Move lead to another campaign" description="The lead stops in its current campaign and is added to the one you choose." width={460} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!cid} onClick={async () => { try { await post(`/api/unibox/threads/${threadId}/move`, { campaignId: cid }); toast('Lead moved'); onClose(); } catch (e: any) { toast(e.message, 'error'); } }}>Move</Button></>}>
      <Dropdown label="Choose a campaign" value={cid} onChange={setCid} options={(data?.campaigns ?? []).filter((c: any) => c.status !== 'completed').map((c: any) => ({ value: c.id, label: c.name }))} className="w-full justify-between" />
    </Modal>
  );
}

function ThreadView({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: t, isLoading } = useQuery({ queryKey: ['thread', id], queryFn: () => get(`/api/unibox/threads/${id}`), refetchInterval: 20_000 });
  const { data: labels } = useQuery({ queryKey: ['labels'], queryFn: () => get('/api/labels') });
  const [notes, setNotes] = useState('');
  const [moving, setMoving] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (t) setNotes(t.notes);
  }, [t?.id]);
  useEffect(() => {
    if (t?.unread) {
      patch(`/api/unibox/threads/${id}`, { unread: false }).then(() => {
        qc.invalidateQueries({ queryKey: ['threads'] });
        qc.invalidateQueries({ queryKey: ['unread'] });
      });
    }
  }, [t?.id, t?.unread]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [t?.items?.length]);
  if (isLoading || !t) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['thread', id] });
    qc.invalidateQueries({ queryKey: ['threads'] });
    qc.invalidateQueries({ queryKey: ['unread'] });
  };
  const update = async (body: object, msg?: string) => {
    try {
      await patch(`/api/unibox/threads/${id}`, body);
      if (msg) toast(msg);
      refresh();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };
  const lastSubject = [...t.items].reverse().find((i: any) => i.subject)?.subject ?? t.subject;
  const info: [string, string][] = [
    ['Company', t.lead?.company || '—'],
    ['Campaign', t.campaign?.name ?? '—'],
    ['Reached', t.progress && t.campaign ? `Step ${t.progress.step} of ${t.campaign.steps}` : '—'],
    ['Status', t.lead ? t.lead.status.replace(/_/g, ' ').replace(/^./, (c: string) => c.toUpperCase()) : '—'],
    ...Object.entries(t.lead?.custom ?? {}).filter(([, v]) => v).slice(0, 8).map(([k, v]) => [k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), String(v)] as [string, string]),
    ['Sending account', t.account.email],
  ];
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-ground">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line bg-white px-4 py-4 sm:px-6">
          <Button icon variant="ghost" aria-label="Back to conversations" className="md:hidden" onClick={onBack}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <div className="min-w-0 flex-[1_1_220px]">
            <div className="text-base font-semibold">{t.leadName}</div>
            <div className="truncate text-[13px] text-muted">{lastSubject} · via {t.account.email}</div>
          </div>
          <Dropdown
            label="Label"
            value={t.label?.id ?? ''}
            onChange={(v) => update({ labelId: v || null })}
            options={[{ value: '', label: 'No label' }, ...(labels?.labels ?? []).map((l: any) => ({ value: l.id, label: l.name }))]}
            renderValue={() =>
              t.label ? (
                <span className="inline-flex items-center gap-2" style={{ color: t.label.color }}>
                  <span className="h-2 w-2 rounded-full" style={{ background: t.label.color }} />
                  {t.label.name}
                </span>
              ) : (
                'Label'
              )
            }
          />
          <Menu
            label="Conversation actions"
            items={[
              { label: 'Mark as unread', onClick: () => update({ unread: true }, 'Marked as unread') },
              { label: t.isLead ? 'Mark as not a lead' : 'Mark as lead', onClick: () => update({ isLead: !t.isLead }, t.isLead ? 'Hidden from the Unibox' : 'Marked as lead') },
              { label: 'Move lead to another campaign', onClick: () => setMoving(true) },
              { divider: true, label: '' },
              { label: 'Add to suppression list', danger: true, onClick: async () => { await post(`/api/unibox/threads/${id}/suppress`); toast(`${t.leadEmail} will never be emailed again`); refresh(); } },
            ]}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-5 sm:px-6">
          {t.items.map((m: any) => {
            const mine = m.direction === 'out';
            return (
              <article key={m.id} className={cn('max-w-[640px] rounded-card border px-[18px] py-4', mine ? 'border-line bg-white' : 'self-end border-accent-ring bg-accent-soft')}>
                <div className="mb-2 flex flex-wrap gap-2 text-[13px]">
                  <span className="font-semibold">{m.fromName || m.fromEmail}</span>
                  <span className="flex-1 text-muted">{mine ? `to ${m.toEmail}` : ''}</span>
                  <span className="text-muted">
                    {m.at ? fullTime(m.at) : ''}
                    {m.step ? ` · Step ${m.step}` : ''}
                    {m.status === 'scheduled' ? ' · scheduled' : ''}
                    {m.status === 'failed' ? ' · failed' : ''}
                    {m.isAutoReply ? ' · auto-reply' : ''}
                  </span>
                </div>
                {m.html ? (
                  <div className={cn('mail-body break-words text-sm leading-relaxed', mine ? 'text-[#3F3F46]' : 'text-ink')} dangerouslySetInnerHTML={{ __html: sanitize(m.html) }} />
                ) : (
                  <p className="m-0 whitespace-pre-wrap break-words text-sm leading-relaxed">{m.text}</p>
                )}
                {m.status === 'scheduled' && (
                  <Button size="sm" className="mt-2" onClick={async () => { await del(`/api/unibox/messages/${m.id}`); refresh(); }}>Cancel scheduled reply</Button>
                )}
                {m.error && <p className="mb-0 mt-2 text-xs text-[#B91C1C]">{m.error}</p>}
              </article>
            );
          })}
          <div ref={bottom} />
        </div>
        <ReplyBox thread={t} onSent={refresh} />
      </section>
      <aside className="border-t border-line bg-white p-5 lg:w-[280px] lg:flex-none lg:overflow-y-auto lg:border-l lg:border-t-0">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#F4F4F5] font-semibold text-[#3F3F46]" aria-hidden>{initials(t.leadName)}</div>
        <div className="mt-2.5 text-base font-semibold">{t.leadName}</div>
        <div className="break-all text-[13px] text-muted">{t.leadEmail}</div>
        <div className="mt-4 border-t border-soft pt-2.5">
          {info.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 py-1.5 text-[13px]">
              <span className="text-muted">{k}</span>
              <span className="break-all text-right font-medium">{v}</span>
            </div>
          ))}
        </div>
        <label className="mt-3.5 block">
          <span className="lbl">Notes</span>
          <textarea className="inp h-20 resize-y text-[13px]" placeholder="Add a note" value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== t.notes && update({ notes }, 'Note saved')} />
        </label>
      </aside>
      <MoveModal threadId={id} open={moving} onClose={() => setMoving(false)} />
    </div>
  );
}

export default function Unibox() {
  const { threadId } = useParams();
  const nav = useNavigate();
  const { data } = useQuery({ queryKey: ['threads', { tab: 'all', q: '', label: '', campaign: '', account: '', from: '', notLeads: '' }], queryFn: () => get('/api/unibox/threads?tab=all'), enabled: !threadId });
  // open the newest conversation on wide screens
  useEffect(() => {
    if (!threadId && data?.threads?.[0] && window.innerWidth >= 768) nav(`/unibox/${data.threads[0].id}`, { replace: true });
  }, [threadId, data]);
  return (
    <div className="flex h-[calc(100vh-57px)] flex-col md:h-screen md:flex-row">
      <div className={cn('min-h-0 md:flex', threadId ? 'hidden' : 'flex flex-1 flex-col')}>
        <ThreadList selected={threadId} onSelect={(id) => nav(`/unibox/${id}`)} />
      </div>
      {threadId ? (
        <ThreadView key={threadId} id={threadId} onBack={() => nav('/unibox')} />
      ) : (
        <div className="hidden flex-1 items-center justify-center bg-ground md:flex">
          <Empty title="Select a conversation">Replies from leads across all your mailboxes appear on the left.</Empty>
        </div>
      )}
    </div>
  );
}
