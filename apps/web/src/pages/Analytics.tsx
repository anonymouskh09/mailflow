import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Calendar, ChevronDown, Filter as FilterIcon } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { get, qs } from '@/lib/api';
import { Page, PageHeader } from '@/components/Layout';
import { Button, Empty, PageLoader, Popover, ProgressBar, StatusPill } from '@/components/ui';
import { fmt, pctStr, scoreColor } from '@/lib/format';

const UP = '#15803D';
const DOWN = '#B91C1C';

function delta(cur: number, prev: number, kind: 'count' | 'pts', goodWhenUp: boolean, label: string) {
  if (kind === 'count') {
    if (!prev && !cur) return { text: 'No change', color: '#52525B' };
    if (!prev) return { text: `New vs ${label}`, color: goodWhenUp ? UP : DOWN };
    const p = Math.round(((cur - prev) / prev) * 100);
    const up = p >= 0;
    return { text: `${up ? '+' : '−'}${Math.abs(p)}% vs ${label}`, color: up === goodWhenUp ? UP : DOWN };
  }
  const d = Math.round((cur - prev) * 10) / 10;
  if (d === 0) return { text: 'No change', color: '#52525B' };
  return { text: `${d > 0 ? '+' : '−'}${Math.abs(d)} pts`, color: d > 0 === goodWhenUp ? UP : DOWN };
}

const RANGES = [
  { days: 1, label: 'Today' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
];

export default function Analytics() {
  const [days, setDays] = useState(7);
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [campaign, setCampaign] = useState('');
  const [account, setAccount] = useState('');
  const params = custom ? { from: custom.from, to: custom.to, campaign, account } : { days, campaign, account };
  const { data, isLoading } = useQuery({ queryKey: ['analytics', params], queryFn: () => get(`/api/analytics/overview${qs(params)}`), refetchInterval: 60_000 });
  const { data: camps } = useQuery({ queryKey: ['analytics-campaigns'], queryFn: () => get('/api/analytics/campaigns'), refetchInterval: 60_000 });
  const { data: accts } = useQuery({ queryKey: ['analytics-accounts'], queryFn: () => get('/api/analytics/accounts'), refetchInterval: 60_000 });
  const { data: allCampaigns } = useQuery({ queryKey: ['campaigns', 'all'], queryFn: () => get('/api/campaigns') });
  const { data: allAccounts } = useQuery({ queryKey: ['accounts', 'totals'], queryFn: () => get('/api/accounts') });

  const rangeLabel = custom ? `${custom.from} – ${custom.to}` : RANGES.find((r) => r.days === days)?.label ?? `${days} days`;
  const prevLabel = custom ? 'previous period' : days === 1 ? 'yesterday' : `previous ${days} days`;
  const campaignName = allCampaigns?.campaigns?.find((c: any) => c.id === campaign)?.name;
  const accountEmail = allAccounts?.accounts?.find((a: any) => a.id === account)?.email;
  const subtitle = `${campaignName ?? 'All campaigns'} · ${accountEmail ?? 'all accounts'}`;

  const c = data?.current;
  const p = data?.previous;
  const off = data?.trackingOff ?? {};
  const kpis = c
    ? [
        { label: 'Emails sent', value: fmt(c.sent), d: delta(c.sent, p.sent, 'count', true, prevLabel) },
        { label: 'Open rate', value: off.opens ? '—' : pctStr(c.openRate), d: off.opens ? { text: 'tracking off', color: '#52525B' } : delta(c.openRate, p.openRate, 'pts', true, prevLabel) },
        { label: 'Click rate', value: off.clicks ? '—' : pctStr(c.clickRate), d: off.clicks ? { text: 'tracking off', color: '#52525B' } : delta(c.clickRate, p.clickRate, 'pts', true, prevLabel) },
        { label: 'Reply rate', value: pctStr(c.replyRate), d: delta(c.replyRate, p.replyRate, 'pts', true, prevLabel) },
        { label: 'Bounce rate', value: pctStr(c.bounceRate), d: delta(c.bounceRate, p.bounceRate, 'pts', false, prevLabel) },
        {
          label: 'Unsubscribes',
          value: fmt(c.unsubscribes),
          d: c.unsubscribes === p.unsubscribes ? { text: 'No change', color: '#52525B' } : { text: `${Math.abs(c.unsubscribes - p.unsubscribes)} ${c.unsubscribes < p.unsubscribes ? 'fewer' : 'more'}`, color: c.unsubscribes < p.unsubscribes ? UP : DOWN },
        },
      ]
    : [];
  const series = (data?.series ?? []).map((s: any) => ({ ...s, label: new Date(`${s.date}T12:00:00Z`).toLocaleDateString(undefined, data?.days <= 7 ? { weekday: 'short' } : { day: 'numeric', month: 'short' }) }));
  const filterCount = (campaign ? 1 : 0) + (account ? 1 : 0);

  return (
    <Page>
      <PageHeader title="Analytics" subtitle={subtitle}>
        <Popover
          width={260}
          trigger={({ toggle, ref, open }) => (
            <Button ref={ref} onClick={toggle} aria-expanded={open}>
              <Calendar className="h-4 w-4" strokeWidth={1.8} aria-hidden />
              {rangeLabel}
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
          )}
        >
          {(close) => (
            <div className="flex flex-col">
              {RANGES.map((r) => (
                <button key={r.days} className="rounded-md px-3 py-2 text-left text-sm hover:bg-[#F4F4F5]" onClick={() => { setCustom(null); setDays(r.days); close(); }}>
                  {r.label}
                </button>
              ))}
              <div className="mt-1 border-t border-soft p-2">
                <span className="lbl">Custom range</span>
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    const from = String(f.get('from'));
                    const to = String(f.get('to'));
                    if (from && to && from <= to) {
                      setCustom({ from, to });
                      close();
                    }
                  }}
                >
                  <input name="from" type="date" className="inp h-9" aria-label="From date" defaultValue={custom?.from} required />
                  <input name="to" type="date" className="inp h-9" aria-label="To date" defaultValue={custom?.to} required />
                  <Button size="sm" type="submit">Apply</Button>
                </form>
              </div>
            </div>
          )}
        </Popover>
        <Popover
          width={280}
          trigger={({ toggle, ref, open }) => (
            <Button ref={ref} onClick={toggle} aria-expanded={open}>
              <FilterIcon className="h-4 w-4" strokeWidth={1.8} aria-hidden />
              Filter{filterCount ? ` · ${filterCount}` : ''}
            </Button>
          )}
        >
          <div className="flex flex-col gap-3 p-2">
            <label className="block">
              <span className="lbl">Campaign</span>
              <select className="inp" value={campaign} onChange={(e) => setCampaign(e.target.value)}>
                <option value="">All campaigns</option>
                {(allCampaigns?.campaigns ?? []).map((x: any) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="lbl">Account</span>
              <select className="inp" value={account} onChange={(e) => setAccount(e.target.value)}>
                <option value="">All accounts</option>
                {(allAccounts?.accounts ?? []).map((x: any) => (
                  <option key={x.id} value={x.id}>{x.email}</option>
                ))}
              </select>
            </label>
            {filterCount > 0 && <Button size="sm" variant="ghost" onClick={() => { setCampaign(''); setAccount(''); }}>Clear filters</Button>}
          </div>
        </Popover>
      </PageHeader>

      {isLoading ? (
        <PageLoader />
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
            {kpis.map((k) => (
              <div key={k.label} className="card px-[18px] py-4">
                <div className="text-[13px] font-medium text-muted">{k.label}</div>
                <div className="mt-1.5 text-[26px] font-bold tracking-tight">{k.value}</div>
                <div className="mt-1 text-xs" style={{ color: k.d.color }}>{k.d.text}</div>
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
            </div>
            <div className="h-[240px]" role="img" aria-label={`Daily sent, opened and replied emails, ${rangeLabel}`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke="#F0F0F2" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#71717A' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11, fill: '#71717A' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #E4E4E7', fontSize: 13 }} />
                  <Line type="linear" dataKey="sent" name="Sent" stroke="#4F46E5" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                  {!off.opens && <Line type="linear" dataKey="opened" name="Opened" stroke="#0EA5E9" strokeWidth={2.5} dot={false} isAnimationActive={false} />}
                  <Line type="linear" dataKey="replied" name="Replied" stroke="#EA580C" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="flex flex-wrap items-start gap-4">
            <div className="card min-w-0 flex-[2_1_560px] overflow-hidden">
              <div className="flex items-center px-4 pb-2 pt-4">
                <h2 className="m-0 flex-1 text-base font-semibold">Campaigns</h2>
                <Link to="/campaigns" className="text-[13px] font-medium">View all</Link>
              </div>
              {!camps?.campaigns?.length ? (
                <Empty title="No campaigns launched yet"><Link to="/campaigns">Create your first campaign</Link></Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="tbl">
                    <thead>
                      <tr><th>Campaign</th><th>Status</th><th>Progress</th><th>Sent</th><th>Open</th><th>Reply</th></tr>
                    </thead>
                    <tbody>
                      {camps.campaigns.map((x: any) => (
                        <tr key={x.id}>
                          <td className="font-medium"><Link to={`/campaigns/${x.id}`} className="text-ink hover:text-accent">{x.name}</Link></td>
                          <td><StatusPill status={x.status} /></td>
                          <td><ProgressBar value={x.progress} /></td>
                          <td>{fmt(x.sent)}</td>
                          <td>{x.openRate === null ? '—' : pctStr(x.openRate)}</td>
                          <td>{pctStr(x.replyRate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="card min-w-0 flex-[1_1_340px] overflow-hidden">
              <div className="flex items-center px-4 pb-2 pt-4">
                <h2 className="m-0 flex-1 text-base font-semibold">Account health</h2>
                <Link to="/accounts" className="text-[13px] font-medium">View all</Link>
              </div>
              {!accts?.accounts?.length ? (
                <Empty title="No accounts yet"><Link to="/accounts">Connect a mailbox</Link></Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="tbl">
                    <thead><tr><th>Account</th><th>Warmup</th><th>Today</th></tr></thead>
                    <tbody>
                      {accts.accounts.slice(0, 8).map((a: any) => (
                        <tr key={a.id}>
                          <td><Link to={`/accounts/${a.id}`} className="text-ink hover:text-accent">{a.email}</Link></td>
                          <td><span className="font-semibold" style={{ color: scoreColor(a.warmupScore) }}>{a.warmupScore ?? '—'}</span></td>
                          <td className="text-muted">{a.sentToday} / {a.dailyLimit}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </Page>
  );
}
