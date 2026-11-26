import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { get, qs } from '@/lib/api';
import { Button, Empty, Menu, SearchInput, Segmented, StatusPill } from '@/components/ui';
import { fmt, pctStr, timeAgo, gapText } from '@/lib/format';

const pctOf = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

/** Per-campaign analytics: KPIs, daily chart, by-step table and the lead table. */
export function AnalyticsTab({ campaign: c }: { campaign: any }) {
  const id = c.id;
  const nav = useNavigate();
  const [state, setState] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [days, setDays] = useState('30');
  const { data: stats } = useQuery({ queryKey: ['campaign-stats', id], queryFn: () => get(`/api/campaigns/${id}/stats`), refetchInterval: 30_000 });
  const { data: daily } = useQuery({ queryKey: ['analytics', { campaign: id, days }], queryFn: () => get(`/api/analytics/overview${qs({ campaign: id, days })}`), refetchInterval: 60_000 });
  const { data: leads } = useQuery({ queryKey: ['campaign-leads', id, state, q, page], queryFn: () => get(`/api/campaigns/${id}/leads${qs({ state, q, page })}`), refetchInterval: 30_000 });
  const k = stats?.kpis;
  const kpis = k
    ? [
        { l: 'Emails sent', v: fmt(k.sent), s: `${fmt(daily?.current?.sent ?? 0)} in the last ${days} days` },
        { l: 'Leads contacted', v: fmt(k.contacted), s: `of ${fmt(k.total)} · ${Math.round(pctOf(k.contacted, k.total))}%` },
        { l: 'Opened', v: stats.trackOpens ? pctStr(pctOf(k.opened, k.contacted)) : '—', s: stats.trackOpens ? `${fmt(k.opened)} leads` : 'tracking off' },
        { l: 'Clicked', v: stats.trackClicks ? pctStr(pctOf(k.clicked, k.contacted)) : '—', s: stats.trackClicks ? `${fmt(k.clicked)} leads` : 'tracking off' },
        { l: 'Replied', v: pctStr(pctOf(k.replied, k.contacted)), s: `${fmt(k.replied)} leads` },
        { l: 'Bounced', v: pctStr(pctOf(k.bounced, k.contacted)), s: `${fmt(k.bounced)} leads` },
      ]
    : [];
  const series = (daily?.series ?? []).map((s: any) => ({ ...s, label: new Date(`${s.date}T12:00:00Z`).toLocaleDateString(undefined, Number(days) <= 7 ? { weekday: 'short' } : { day: 'numeric', month: 'short' }) }));
  const rows = leads?.rows ?? [];
  const total = leads?.total ?? 0;
  return (
    <div className="flex flex-col gap-5">
      {c.status === 'draft' && (
        <div className="rounded-[10px] bg-accent-soft px-4 py-3 text-sm text-accent-dark">
          This campaign is a draft. Numbers appear here after you launch it.
        </div>
      )}
      <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-[10px] border border-line bg-white px-4 py-3 text-sm">
        <span><span className="text-muted">Each account waits </span><b>{gapText(c.gapMin, c.gapMax)}</b><span className="text-muted"> between emails</span></span>
        <span><span className="text-muted">Up to </span><b>{fmt(c.dailyLimit)} emails / day</b><span className="text-muted"> for this campaign</span></span>
        {c.newLeadsPerDay && <span><span className="text-muted">New leads: </span><b>{fmt(c.newLeadsPerDay)} / day</b></span>}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        {kpis.map((x) => (
          <div key={x.l} className="card px-[18px] py-4">
            <div className="text-[13px] font-medium text-muted">{x.l}</div>
            <div className="mt-1.5 text-[26px] font-bold tracking-tight">{x.v}</div>
            <div className="mt-1 text-xs text-muted">{x.s}</div>
          </div>
        ))}
      </div>

      <div className="card px-5 py-[18px]">
        <div className="mb-2 flex flex-wrap items-center gap-4">
          <h2 className="m-0 flex-1 text-base font-semibold">Daily activity</h2>
          {[
            ['Sent', '#4F46E5'],
            ['Opened', '#0EA5E9'],
            ['Replied', '#EA580C'],
          ].map(([l, color]) => (
            <span key={l} className="inline-flex items-center gap-1.5 text-[13px] text-muted">
              <span className="h-[3px] w-2.5 rounded-sm" style={{ background: color }} />
              {l}
            </span>
          ))}
          <select aria-label="Chart range" className="inp h-9 w-36" value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </div>
        <div className="h-[220px]" role="img" aria-label={`Daily sent, opened and replied emails for this campaign, last ${days} days`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="#F0F0F2" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#71717A' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11, fill: '#71717A' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #E4E4E7', fontSize: 13 }} />
              <Line type="linear" dataKey="sent" name="Sent" stroke="#4F46E5" strokeWidth={2.5} dot={false} isAnimationActive={false} />
              {stats?.trackOpens && <Line type="linear" dataKey="opened" name="Opened" stroke="#0EA5E9" strokeWidth={2.5} dot={false} isAnimationActive={false} />}
              <Line type="linear" dataKey="replied" name="Replied" stroke="#EA580C" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <section className="card min-w-0 flex-[1_1_340px] overflow-hidden">
          <h2 className="m-0 px-4 pb-2 pt-4 text-base font-semibold">By step</h2>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Sent</th>
                  <th>Opened</th>
                  <th>Replied</th>
                </tr>
              </thead>
              <tbody>
                {(stats?.steps ?? []).map((s: any) => (
                  <tr key={s.position}>
                    <td className="font-medium">
                      Step {s.position}
                      {s.position > 1 ? ` · +${s.delayDays}d` : ''}
                    </td>
                    <td>{fmt(s.sent)}</td>
                    <td>{stats.trackOpens ? (s.sent ? pctStr(pctOf(s.opened, s.sent)) : '—') : '—'}</td>
                    <td>{s.sent ? pctStr(pctOf(s.replied, s.sent)) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card min-w-0 flex-[3_1_600px] overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Segmented
              label="Lead status"
              value={state}
              onChange={(v) => { setState(v); setPage(1); }}
              options={[
                { value: '', label: 'All' },
                { value: 'in_sequence', label: 'In sequence' },
                { value: 'replied', label: 'Replied' },
                { value: 'completed', label: 'Completed' },
                { value: 'bounced', label: 'Bounced' },
              ]}
            />
            <span className="flex-1" />
            <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search leads" label="Search leads" className="sm:[&_input]:w-[200px]" />
            <Menu
              label="Lead table actions"
              items={[
                { label: 'Add leads', onClick: () => nav(`/campaigns/${id}/leads`) },
                { label: 'Show not contacted yet', onClick: () => { setState('not_contacted'); setPage(1); } },
                { label: 'Show unsubscribed', onClick: () => { setState('unsubscribed'); setPage(1); } },
              ]}
            />
          </div>
          {!rows.length ? (
            <Empty title={q || state ? 'No leads match' : 'No leads yet'} />
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Lead</th>
                    <th>Status</th>
                    <th>Step</th>
                    <th>Last activity</th>
                    <th>Sending account</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id}>
                      <td>
                        <span className="block font-medium">{`${r.firstName} ${r.lastName}`.trim() || r.email}</span>
                        <span className="text-xs text-muted">{r.email}</span>
                      </td>
                      <td>
                        <StatusPill status={r.status} />
                        {r.heldReason && r.status !== 'bounced' && r.status !== 'unsubscribed' && <span className="mt-1 block max-w-[220px] truncate text-xs text-[#92400E]" title={r.heldReason}>{r.heldReason}</span>}
                      </td>
                      <td className="text-muted">{r.step ? `Step ${r.step}` : '—'}</td>
                      <td className="text-muted">{r.lastActivity ? `${r.lastActivity} · ${timeAgo(r.lastActivityAt)}` : r.nextDueAt ? `Next ${timeAgo(r.nextDueAt)}` : '—'}</td>
                      <td className="text-muted">{r.account ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {total > 50 && (
            <div className="flex items-center justify-end gap-2 border-t border-soft px-4 py-2.5 text-sm text-muted">
              {(page - 1) * 50 + 1}–{Math.min(page * 50, total)} of {fmt(total)}
              <Button size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button size="sm" disabled={page * 50 >= total} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
