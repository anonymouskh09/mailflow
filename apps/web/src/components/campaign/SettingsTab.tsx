import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { get, patch, put } from '@/lib/api';
import { Button, Field, Switch, useToast } from '@/components/ui';
import { scoreColor, DAYS, fmt } from '@/lib/format';
import { cn } from '@/lib/cn';

export const TIMEZONES: string[] = (() => {
  try {
    const list: string[] = (Intl as any).supportedValuesOf('timeZone');
    return list.includes('UTC') ? list : ['UTC', ...list];
  } catch {
    return ['UTC', 'Europe/London', 'America/New_York', 'Asia/Tashkent', 'Asia/Dubai', 'Asia/Karachi'];
  }
})();

function toLocalInput(d: string | null) {
  if (!d) return '';
  const dt = new Date(d);
  const off = dt.getTimezoneOffset();
  return new Date(dt.getTime() - off * 60000).toISOString().slice(0, 16);
}

export function SettingsTab({ campaign, onSaved }: { campaign: any; onSaved: (at: Date) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [c, setC] = useState(() => ({ ...campaign }));
  const [selected, setSelected] = useState<Set<string>>(new Set(campaign.accountIds));
  const [search, setSearch] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const { data } = useQuery({ queryKey: ['campaign-accounts', campaign.id], queryFn: () => get(`/api/campaigns/${campaign.id}/account-options`) });
  const accounts: any[] = data?.accounts ?? [];

  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pending = useRef<Record<string, unknown>>({});
  const flush = async () => {
    const body = pending.current;
    pending.current = {};
    if (!Object.keys(body).length) return;
    try {
      const res = await patch(`/api/campaigns/${campaign.id}`, body);
      qc.setQueryData(['campaign', campaign.id], res);
      onSaved(new Date());
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };
  const set = (p: Record<string, unknown>, immediate = false) => {
    setC((cur: any) => ({ ...cur, ...p }));
    Object.assign(pending.current, p);
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, immediate ? 0 : 600);
  };
  useEffect(() => () => void flush(), []);

  const accTimer = useRef<ReturnType<typeof setTimeout>>();
  const saveAccounts = (s: Set<string>) => {
    setSelected(s);
    clearTimeout(accTimer.current);
    accTimer.current = setTimeout(async () => {
      try {
        const res = await put(`/api/campaigns/${campaign.id}/accounts`, { accountIds: [...s] });
        qc.setQueryData(['campaign', campaign.id], res);
        onSaved(new Date());
      } catch (err: any) {
        toast(err.message, 'error');
      }
    }, 400);
  };

  const filtered = accounts.filter((a) => !search || a.email.toLowerCase().includes(search.toLowerCase()) || a.tags.some((t: string) => t.toLowerCase().includes(search.toLowerCase())));
  const allFilteredSelected = filtered.length > 0 && filtered.every((a) => selected.has(a.id));

  // Pacing estimate
  const est = useMemo(() => {
    const chosen = accounts.filter((a) => selected.has(a.id) && a.status !== 'paused');
    const [sh, sm] = String(c.windowStart).split(':').map(Number);
    const [eh, em] = String(c.windowEnd).split(':').map(Number);
    const windowMin = Math.max(0, eh * 60 + em - (sh * 60 + sm));
    const avgGap = Math.max(1, (Number(c.gapMin) + Number(c.gapMax)) / 2);
    const perAccountByGap = Math.floor(windowMin / avgGap);
    const perDay = Math.min(Number(c.dailyLimit) || 0, chosen.reduce((s, a) => s + Math.min(a.dailyLimit, perAccountByGap), 0));
    const newPerDay = c.newLeadsPerDay ? Math.min(perDay, Number(c.newLeadsPerDay)) : perDay;
    const leads = campaign.listLeads ?? 0;
    const days = newPerDay > 0 ? Math.ceil(leads / newPerDay) : null;
    const cap = chosen.length ? Math.min(...chosen.map((a) => a.dailyLimit)) : 0;
    return { perDay, count: chosen.length, days, leads, cap, sameCap: chosen.every((a) => a.dailyLimit === cap) };
  }, [accounts, selected, c.windowStart, c.windowEnd, c.gapMin, c.gapMax, c.dailyLimit, c.newLeadsPerDay, campaign.listLeads]);

  const toggles: [string, string, string][] = [
    ['trackOpens', 'Open tracking', 'Adds an invisible pixel to each email'],
    ['trackClicks', 'Click tracking', 'Routes links through your tracking domain'],
    ['stopOnReply', 'Stop on reply', 'Cancel remaining steps when a lead replies'],
    ['unsubscribeFooter', 'Unsubscribe link', 'Adds a footer and one-click unsubscribe header'],
  ];

  return (
    <div className="flex flex-wrap items-start gap-4">
      <div className="flex min-w-0 flex-[1_1_440px] flex-col gap-4">
        <section className="card flex flex-col gap-3.5 p-5">
          <div className="flex items-center gap-3">
            <h2 className="h2 flex-1">Sending accounts</h2>
            <span className="text-[13px] text-muted">
              {selected.size} of {accounts.length} selected
            </span>
          </div>
          <div className="flex gap-2">
            <input className="inp flex-1" type="search" placeholder="Search accounts or tags" aria-label="Search accounts" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Button
              onClick={() => {
                const s = new Set(selected);
                filtered.forEach((a) => (allFilteredSelected ? s.delete(a.id) : s.add(a.id)));
                saveAccounts(s);
              }}
            >
              {allFilteredSelected ? 'Clear' : 'Select all'}
            </Button>
          </div>
          <div className="max-h-[360px] overflow-y-auto rounded-[10px] border border-soft">
            {!accounts.length && <div className="px-4 py-6 text-center text-sm text-muted">No accounts connected yet.</div>}
            {filtered.map((a) => {
              const on = selected.has(a.id);
              return (
                <label key={a.id} className={cn('flex cursor-pointer items-center gap-3 border-b border-soft px-3.5 py-2.5 text-sm last:border-0', on && 'bg-[#FAFAFF]')}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent"
                    checked={on}
                    onChange={(e) => {
                      const s = new Set(selected);
                      if (e.target.checked) s.add(a.id);
                      else s.delete(a.id);
                      saveAccounts(s);
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {a.email}
                    {a.status !== 'active' && <span className="ml-2 text-xs text-[#991B1B]">{a.status === 'paused' ? 'paused' : 'error'}</span>}
                  </span>
                  <span className="hidden text-xs text-muted sm:inline">
                    {a.sentToday}/{a.dailyLimit} today
                  </span>
                  <span className="text-xs text-muted">
                    Warmup <b style={{ color: scoreColor(a.warmupScore) }}>{a.warmupScore ?? '—'}</b>
                  </span>
                </label>
              );
            })}
          </div>
          <p className="m-0 text-[13px] text-muted">Step 1 rotates across these accounts. Follow-ups always go from the account that sent Step 1.</p>
        </section>

        <section className="card flex flex-col gap-3.5 p-5">
          <h2 className="h2">Schedule</h2>
          <div>
            <span className="lbl">Days</span>
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                const on = c.days.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ days: on ? c.days.filter((x: number) => x !== d) : [...c.days, d].sort() }, true)}
                    className={cn('h-10 w-11 rounded-lg border text-[13px] font-medium', on ? 'border-accent bg-accent text-white' : 'border-line bg-white text-muted')}
                  >
                    {DAYS[d]}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="From">
              <input className="inp" type="time" value={c.windowStart} onChange={(e) => set({ windowStart: e.target.value })} />
            </Field>
            <Field label="To">
              <input className="inp" type="time" value={c.windowEnd} onChange={(e) => set({ windowEnd: e.target.value })} />
            </Field>
            <Field label="Timezone">
              <select className="inp" value={c.timezone} onChange={(e) => set({ timezone: e.target.value }, true)}>
                {(TIMEZONES.includes(c.timezone) ? TIMEZONES : [c.timezone, ...TIMEZONES]).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div>
            <span className="lbl">Start</span>
            <div className="flex flex-wrap items-center gap-3">
              <select className="inp w-56" aria-label="Start" value={c.startAt ? 'later' : 'now'} onChange={(e) => set({ startAt: e.target.value === 'now' ? null : new Date(Date.now() + 86400000).toISOString() }, true)}>
                <option value="now">As soon as launched</option>
                <option value="later">At a date and time</option>
              </select>
              {c.startAt && <input className="inp w-56" type="datetime-local" aria-label="Start date and time" value={toLocalInput(c.startAt)} onChange={(e) => e.target.value && set({ startAt: new Date(e.target.value).toISOString() })} />}
            </div>
          </div>
        </section>
      </div>

      <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-4">
        <section className="card flex flex-col gap-3.5 p-5">
          <h2 className="h2">Pacing</h2>
          <div>
            <span className="lbl">Time between emails (per account)</span>
            <div className="flex items-center gap-2">
              <input className="inp w-[72px] text-center" inputMode="numeric" aria-label="Minimum minutes" value={c.gapMin} onChange={(e) => set({ gapMin: Number(e.target.value.replace(/\D/g, '') || 0) })} />
              <span className="text-muted">to</span>
              <input className="inp w-[72px] text-center" inputMode="numeric" aria-label="Maximum minutes" value={c.gapMax} onChange={(e) => set({ gapMax: Number(e.target.value.replace(/\D/g, '') || 0) })} />
              <span className="text-sm text-muted">minutes, random</span>
            </div>
            {Number(c.gapMax) < Number(c.gapMin) && <p className="mb-0 mt-1 text-xs text-[#B91C1C]">Maximum must be at least the minimum.</p>}
          </div>
          <Field label="Daily limit for this campaign">
            <div className="relative">
              <input className="inp pr-16" inputMode="numeric" value={c.dailyLimit} onChange={(e) => set({ dailyLimit: Number(e.target.value.replace(/\D/g, '') || 1) })} />
              <span className="pointer-events-none absolute right-3 top-2.5 text-sm text-muted">emails</span>
            </div>
          </Field>
          <div className="rounded-[10px] bg-ground px-3.5 py-3 text-[13px] leading-normal text-[#3F3F46]">
            {est.count === 0
              ? 'Select sending accounts to see an estimate.'
              : `About ${fmt(est.perDay)} emails a day with ${est.count} account${est.count === 1 ? '' : 's'}${est.sameCap ? ` (each capped at ${est.cap})` : ''}.${est.days !== null && est.leads ? ` All ${fmt(est.leads)} leads get Step 1 in about ${est.days} working day${est.days === 1 ? '' : 's'}.` : ''}`}
          </div>
        </section>

        <section className="card flex flex-col p-5">
          <h2 className="h2 mb-1.5">Tracking &amp; rules</h2>
          {toggles.map(([key, l, d]) => (
            <div key={key} className="flex items-center gap-3 border-t border-soft py-2.5">
              <span className="flex-1">
                <span className="block text-sm font-medium">{l}</span>
                <span className="text-xs text-muted">{key === 'trackOpens' && c.plainText ? 'Off while plain-text only is on' : d}</span>
              </span>
              <Switch label={l} checked={!!c[key]} disabled={(key === 'trackOpens' || key === 'trackClicks') && c.plainText} onChange={(v) => set({ [key]: v }, true)} />
            </div>
          ))}
          <button type="button" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)} className="flex w-full items-center gap-3 border-t border-soft py-2.5 text-left text-sm font-medium text-accent">
            Advanced
            <span className="flex-1 text-xs font-normal text-muted">New leads per day, priority, plain text, auto-reply rules</span>
            <ChevronDown className={cn('h-4 w-4 transition-transform', advanced && 'rotate-180')} aria-hidden />
          </button>
          {advanced && (
            <div className="flex flex-col gap-3 pt-2">
              <Field label="New leads per day" hint="Caps Step 1 sends so follow-ups get room. Empty = no cap.">
                <input className="inp" inputMode="numeric" value={c.newLeadsPerDay ?? ''} onChange={(e) => set({ newLeadsPerDay: e.target.value ? Number(e.target.value.replace(/\D/g, '')) || null : null })} />
              </Field>
              <Field label="Priority">
                <select className="inp" value={c.priority} onChange={(e) => set({ priority: e.target.value }, true)}>
                  <option value="followups_first">Follow-ups first</option>
                  <option value="new_first">New leads first</option>
                </select>
              </Field>
              {[
                ['plainText', 'Plain-text only', 'Better deliverability; disables open and click tracking'],
                ['stopOnAutoReply', 'Stop on auto-reply', 'Out-of-office replies also stop the sequence'],
                ['stopOnDomainReply', 'Stop for the whole company', 'When anyone at a domain replies, stop the others at it'],
              ].map(([key, l, d]) => (
                <div key={key} className="flex items-center gap-3">
                  <span className="flex-1">
                    <span className="block text-sm font-medium">{l}</span>
                    <span className="text-xs text-muted">{d}</span>
                  </span>
                  <Switch label={l} checked={!!c[key]} onChange={(v) => set({ [key]: v }, true)} />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
