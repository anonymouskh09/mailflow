import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play } from 'lucide-react';
import { get, post, del, qs } from '@/lib/api';
import { Page } from '@/components/Layout';
import { Button, Empty, Menu, PageLoader, SearchInput, Segmented, StatusPill, useToast } from '@/components/ui';
import { CampaignHeader } from '@/components/campaign/CampaignHeader';
import { fmt, pctStr, timeAgo, daysLabel } from '@/lib/format';

const pctOf = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

export default function CampaignDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [state, setState] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data: c, isLoading } = useQuery({ queryKey: ['campaign', id], queryFn: () => get(`/api/campaigns/${id}`), refetchInterval: 30_000 });
  const { data: stats } = useQuery({ queryKey: ['campaign-stats', id], queryFn: () => get(`/api/campaigns/${id}/stats`), refetchInterval: 30_000 });
  const { data: leads } = useQuery({ queryKey: ['campaign-leads', id, state, q, page], queryFn: () => get(`/api/campaigns/${id}/leads${qs({ state, q, page })}`), refetchInterval: 30_000 });
  if (isLoading || !c) return <PageLoader />;
  const k = stats?.kpis;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['campaign', id] });
    qc.invalidateQueries({ queryKey: ['campaigns'] });
  };
  const toggle = async () => {
    try {
      await post(`/api/campaigns/${id}/${c.status === 'active' ? 'pause' : 'resume'}`);
      toast(c.status === 'active' ? 'Campaign paused' : 'Campaign resumed');
      refresh();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };
  const kpis = k
    ? [
        { l: 'Leads contacted', v: fmt(k.contacted), s: `of ${fmt(k.total)} · ${Math.round(pctOf(k.contacted, k.total))}%` },
        { l: 'Opened', v: stats.trackOpens ? pctStr(pctOf(k.opened, k.contacted)) : '—', s: stats.trackOpens ? `${fmt(k.opened)} leads` : 'tracking off' },
        { l: 'Clicked', v: stats.trackClicks ? pctStr(pctOf(k.clicked, k.contacted)) : '—', s: stats.trackClicks ? `${fmt(k.clicked)} leads` : 'tracking off' },
        { l: 'Replied', v: pctStr(pctOf(k.replied, k.contacted)), s: `${fmt(k.replied)} leads` },
        { l: 'Bounced', v: pctStr(pctOf(k.bounced, k.contacted)), s: `${fmt(k.bounced)} leads` },
      ]
    : [];
  const rows = leads?.rows ?? [];
  const total = leads?.total ?? 0;
  return (
    <Page>
      <CampaignHeader name={c.name} status={c.status} meta={`${c.steps.length} step${c.steps.length === 1 ? '' : 's'} · ${c.accountIds.length} account${c.accountIds.length === 1 ? '' : 's'} · ${daysLabel(c.days)} ${c.windowStart}–${c.windowEnd}`}>
        {(c.status === 'active' || c.status === 'paused') && (
          <Button onClick={toggle}>
            {c.status === 'active' ? <Pause className="h-4 w-4" fill="currentColor" aria-hidden /> : <Play className="h-4 w-4" fill="currentColor" aria-hidden />}
            {c.status === 'active' ? 'Pause' : 'Resume'}
          </Button>
        )}
        <Menu
          label="More campaign actions"
          items={[
            { label: 'Edit sequence', onClick: () => nav(`/campaigns/${id}/edit/sequence`) },
            { label: 'Edit settings', onClick: () => nav(`/campaigns/${id}/edit/settings`) },
            { label: 'Add leads', onClick: () => nav(`/campaigns/${id}/edit/leads`) },
            { label: 'Duplicate', onClick: async () => { const r = await post(`/api/campaigns/${id}/duplicate`); nav(`/campaigns/${r.id}/edit/sequence`); } },
            { divider: true, label: '' },
            { label: 'Delete campaign', danger: true, onClick: async () => { if (confirm('Delete this campaign and its stats?')) { await del(`/api/campaigns/${id}`); refresh(); nav('/campaigns'); } } },
          ]}
        />
      </CampaignHeader>

      {c.status === 'draft' && (
        <div className="rounded-[10px] bg-accent-soft px-4 py-3 text-sm text-accent-dark">
          This campaign is a draft. <Link to={`/campaigns/${id}/edit/sequence`}>Finish it and launch</Link>.
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
        {kpis.map((x) => (
          <div key={x.l} className="card px-[18px] py-4">
            <div className="text-[13px] font-medium text-muted">{x.l}</div>
            <div className="mt-1.5 text-[26px] font-bold tracking-tight">{x.v}</div>
            <div className="mt-1 text-xs text-muted">{x.s}</div>
          </div>
        ))}
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
                { label: 'Add leads', onClick: () => nav(`/campaigns/${id}/edit/leads`) },
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
    </Page>
  );
}
