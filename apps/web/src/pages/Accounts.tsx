import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Filter as FilterIcon } from 'lucide-react';
import { get, patch, post, del, qs } from '@/lib/api';
import { Page, PageHeader } from '@/components/Layout';
import { Button, Checkbox, Empty, Menu, PageLoader, Popover, SearchInput, StatusPill, Switch, useToast, Modal, Dropdown } from '@/components/ui';
import { AddAccountsModal, addSessionConnected, keepAdding } from '@/components/accounts/AddAccountsModal';
import { BulkEditModal } from '@/components/accounts/BulkEditModal';
import { scoreColor, initials } from '@/lib/format';

export interface AccountRow {
  id: string;
  email: string;
  fromName: string;
  provider: 'google' | 'outlook' | 'custom';
  authType: string;
  status: string;
  displayStatus: string;
  lastError: string | null;
  dailyLimit: number;
  sentToday: number;
  warmupSentToday: number;
  warmupScore: number | null;
  tags: string[];
  warmup: { enabled: boolean } | null;
}

export const PROVIDER_LABEL: Record<string, string> = { google: 'Google', outlook: 'Outlook', custom: 'SMTP' };

function AddToCampaignModal({ ids, open, onClose }: { ids: string[]; open: boolean; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ['campaigns', 'all'], queryFn: () => get('/api/campaigns'), enabled: open });
  const [cid, setCid] = useState('');
  const toast = useToast();
  const campaigns = (data?.campaigns ?? []).filter((c: any) => c.status !== 'completed');
  const save = async () => {
    try {
      await post(`/api/campaigns/${cid}/accounts/add`, { accountIds: ids });
      toast('Added to campaign');
      onClose();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add to campaign" width={460} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!cid} onClick={save}>Add</Button></>}>
      {campaigns.length ? (
        <Dropdown label="Choose a campaign" value={cid} onChange={setCid} options={campaigns.map((c: any) => ({ value: c.id, label: c.name }))} className="w-full justify-between" />
      ) : (
        <p className="m-0 text-sm text-muted">No open campaigns yet.</p>
      )}
    </Modal>
  );
}

export default function Accounts() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [tag, setTag] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [autoContinue, setAutoContinue] = useState(false);
  const [notice, setNotice] = useState<React.ReactNode>(null);
  const [bulkIds, setBulkIds] = useState<string[] | null>(null);
  const [campaignIds, setCampaignIds] = useState<string[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['accounts', q, status, tag], queryFn: () => get<{ accounts: AccountRow[]; tags: string[] }>(`/api/accounts${qs({ q, status, tag })}`), refetchInterval: 30_000 });
  const { data: totals } = useQuery({ queryKey: ['accounts', 'totals'], queryFn: () => get<{ accounts: AccountRow[] }>('/api/accounts') });

  // Returning from Google OAuth
  useEffect(() => {
    const g = params.get('google');
    if (!g) return;
    const email = params.get('email');
    if (g === 'ok' && email) {
      addSessionConnected(email);
      setNotice(null);
      setAutoContinue(params.get('again') === '1' && keepAdding());
    } else {
      setNotice(<div role="alert" className="rounded-[10px] bg-[#FEE2E2] px-4 py-3 text-sm text-[#991B1B]">{email ? `${email}: ` : ''}{params.get('message') ?? 'Google sign-in failed'}</div>);
      setAutoContinue(false);
    }
    setAddOpen(true);
    setParams({}, { replace: true });
  }, []);

  const rows = data?.accounts ?? [];
  const all = totals?.accounts ?? rows;
  const activeCount = all.filter((a) => a.displayStatus === 'active' || a.displayStatus === 'limit').length;
  const attention = all.filter((a) => a.displayStatus === 'error').length;
  const selected = rows.filter((r) => sel.has(r.id));
  const allSel = rows.length > 0 && selected.length === rows.length;
  const refresh = () => qc.invalidateQueries({ queryKey: ['accounts'] });

  const bulk = async (body: object, msg: string) => {
    try {
      await patch('/api/accounts/bulk', { ids: [...sel], ...body });
      toast(msg);
      refresh();
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };
  const toggleWarmup = async (a: AccountRow, v: boolean) => {
    qc.setQueryData(['accounts', q, status, tag], (old: any) => old && { ...old, accounts: old.accounts.map((x: AccountRow) => (x.id === a.id ? { ...x, warmup: { ...(x.warmup ?? {}), enabled: v } } : x)) });
    try {
      await patch(`/api/accounts/${a.id}/warmup`, { enabled: v });
    } catch (err: any) {
      toast(err.message, 'error');
    }
    refresh();
  };
  const reconnect = async (a: AccountRow) => {
    if (a.authType === 'google_oauth') {
      window.location.href = `/api/oauth/google/start?hint=${encodeURIComponent(a.email)}`;
      return;
    }
    toast(`Checking ${a.email}…`);
    try {
      const res = await post(`/api/accounts/${a.id}/check`);
      toast(res.test.ok ? `${a.email} is connected` : `${a.email}: ${[res.test.smtp.error, res.test.imap.error].filter(Boolean).join(' · ')}`, res.test.ok ? 'ok' : 'error');
    } catch (err: any) {
      toast(err.message, 'error');
    }
    refresh();
  };
  const testEmail = async (a: AccountRow) => {
    try {
      const res = await post(`/api/accounts/${a.id}/test-email`);
      toast(`Test email sent to ${res.to}`);
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };
  const remove = async (ids: string[]) => {
    try {
      if (ids.length === 1) await del(`/api/accounts/${ids[0]}`);
      else await patch('/api/accounts/bulk', { ids, delete: true });
      toast(`Removed ${ids.length} account${ids.length === 1 ? '' : 's'}`);
      setSel(new Set());
      refresh();
    } catch (err: any) {
      toast(err.message, 'error');
    }
    setConfirmDelete(null);
  };

  const allWarm = selected.length > 0 && selected.every((s) => s.warmup?.enabled);
  const allPaused = selected.length > 0 && selected.every((s) => s.status === 'paused');
  const filterCount = (status ? 1 : 0) + (tag ? 1 : 0);

  const subtitle = useMemo(() => `${all.length} account${all.length === 1 ? '' : 's'} · ${activeCount} active${attention ? ` · ${attention} need${attention === 1 ? 's' : ''} attention` : ''}`, [all.length, activeCount, attention]);

  return (
    <Page>
      <PageHeader title="Email accounts" subtitle={subtitle}>
        <SearchInput value={q} onChange={setQ} placeholder="Search accounts" label="Search accounts" />
        <Popover
          width={260}
          trigger={({ toggle, ref, open }) => (
            <Button ref={ref} onClick={toggle} aria-expanded={open}>
              <FilterIcon className="h-4 w-4" strokeWidth={1.8} aria-hidden />
              Filter{filterCount ? ` · ${filterCount}` : ''}
            </Button>
          )}
        >
          <div className="flex flex-col gap-3 p-2">
            <label className="block">
              <span className="lbl">Status</span>
              <select className="inp" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Any status</option>
                <option value="active">Active</option>
                <option value="limit">Limit reached</option>
                <option value="error">Error</option>
                <option value="paused">Paused</option>
              </select>
            </label>
            <label className="block">
              <span className="lbl">Tag</span>
              <select className="inp" value={tag} onChange={(e) => setTag(e.target.value)}>
                <option value="">Any tag</option>
                {(data?.tags ?? []).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            {filterCount > 0 && (
              <Button size="sm" variant="ghost" onClick={() => { setStatus(''); setTag(''); }}>
                Clear filters
              </Button>
            )}
          </div>
        </Popover>
        <Button variant="primary" onClick={() => { setNotice(null); setAutoContinue(false); setAddOpen(true); }}>
          <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
          Add accounts
        </Button>
      </PageHeader>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-[10px] bg-accent-soft px-4 py-2.5 text-sm text-accent-dark">
          <span className="flex-auto font-semibold">{selected.length} selected</span>
          <Button size="sm" onClick={() => bulk({ warmup: !allWarm }, allWarm ? 'Warmup turned off' : 'Warmup turned on')}>
            {allWarm ? 'Turn warmup off' : 'Turn warmup on'}
          </Button>
          <Button size="sm" onClick={() => bulk({ status: allPaused ? 'active' : 'paused' }, allPaused ? 'Resumed' : 'Paused')}>
            {allPaused ? 'Resume' : 'Pause'}
          </Button>
          <Menu
            size="sm"
            label="More bulk actions"
            items={[
              { label: 'Edit settings (limit, gap, signature, tags)', onClick: () => setBulkIds([...sel]) },
              { label: allPaused ? 'Pause' : 'Resume', onClick: () => bulk({ status: allPaused ? 'paused' : 'active' }, 'Updated') },
              { label: 'Add to campaign', onClick: () => setCampaignIds([...sel]) },
              { label: 'Clear selection', onClick: () => setSel(new Set()) },
              { divider: true, label: '' },
              { label: 'Remove accounts', danger: true, onClick: () => setConfirmDelete([...sel]) },
            ]}
          />
        </div>
      )}

      <div className="card">
        {isLoading ? (
          <PageLoader />
        ) : !rows.length ? (
          <Empty
            title={q || filterCount ? 'No accounts match' : 'No email accounts yet'}
            action={!q && !filterCount && <Button variant="primary" onClick={() => setAddOpen(true)}>Add accounts</Button>}
          >
            {!q && !filterCount && 'Connect Gmail, Outlook or any SMTP/IMAP mailbox. Warmup starts automatically once 3 or more accounts are connected.'}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="w-5">
                    <Checkbox label="Select all" checked={allSel} indeterminate={!allSel && selected.length > 0} onChange={(v) => setSel(new Set(v ? rows.map((r) => r.id) : []))} />
                  </th>
                  <th>Account</th>
                  <th>Provider</th>
                  <th>Status</th>
                  <th>Warmup score</th>
                  <th>Sent today</th>
                  <th>Warmup</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={sel.has(r.id) ? 'bg-[#FAFAFF]' : undefined}>
                    <td>
                      <Checkbox
                        label={`Select ${r.email}`}
                        checked={sel.has(r.id)}
                        onChange={(v) => {
                          const s = new Set(sel);
                          if (v) s.add(r.id); else s.delete(r.id);
                          setSel(s);
                        }}
                      />
                    </td>
                    <td>
                      <Link to={`/accounts/${r.id}`} className="flex items-center gap-2.5 text-ink hover:text-ink">
                        <span className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[#F4F4F5] text-[13px] font-semibold text-[#3F3F46]" aria-hidden>
                          {initials(r.fromName || r.email)[0]}
                        </span>
                        <span>
                          <span className="block font-medium">{r.email}</span>
                          <span className="text-xs text-muted">{r.fromName}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="text-muted">{PROVIDER_LABEL[r.provider]}</td>
                    <td>
                      <span title={r.lastError ?? undefined}>
                        <StatusPill status={r.displayStatus} label={r.displayStatus === 'paused' ? 'Paused' : undefined} className={r.displayStatus === 'paused' ? '!bg-[#F4F4F5] !text-[#3F3F46]' : undefined} />
                      </span>
                      {r.displayStatus === 'error' && r.lastError && <span className="mt-1 block max-w-[220px] truncate text-xs text-[#991B1B]">{r.lastError}</span>}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 rounded-sm bg-soft">
                          <div className="h-1.5 rounded-sm" style={{ width: `${r.warmupScore ?? 0}%`, background: scoreColor(r.warmupScore) }} />
                        </div>
                        <span className="font-semibold">{r.warmupScore ?? '—'}</span>
                      </div>
                    </td>
                    <td className="text-muted">
                      {r.sentToday} / {r.dailyLimit}
                      {r.warmupSentToday > 0 && <span className="block text-xs">+{r.warmupSentToday} warmup</span>}
                    </td>
                    <td>
                      <Switch label={`Warmup for ${r.email}`} checked={!!r.warmup?.enabled} onChange={(v) => toggleWarmup(r, v)} />
                    </td>
                    <td className="text-right">
                      <Menu
                        ghost
                        label={`Actions for ${r.email}`}
                        items={[
                          { label: 'Edit settings', onClick: () => nav(`/accounts/${r.id}`) },
                          { label: 'Reconnect', onClick: () => reconnect(r) },
                          { label: r.status === 'paused' ? 'Resume sending' : 'Pause sending', onClick: async () => { await patch(`/api/accounts/${r.id}`, { status: r.status === 'paused' ? 'active' : 'paused' }); refresh(); } },
                          { label: 'Send test email', onClick: () => testEmail(r) },
                          { label: 'Add to campaign', onClick: () => setCampaignIds([r.id]) },
                          { divider: true, label: '' },
                          { label: 'Remove account', danger: true, onClick: () => setConfirmDelete([r.id]) },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AddAccountsModal
        open={addOpen}
        autoContinue={autoContinue}
        notice={notice}
        onClose={() => { setAddOpen(false); setAutoContinue(false); refresh(); }}
        onApplySettings={(ids) => { setAddOpen(false); setBulkIds(ids); }}
      />
      <BulkEditModal ids={bulkIds ?? []} open={!!bulkIds} onClose={() => setBulkIds(null)} />
      <AddToCampaignModal ids={campaignIds ?? []} open={!!campaignIds} onClose={() => setCampaignIds(null)} />
      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title={`Remove ${confirmDelete?.length === 1 ? 'this account' : `${confirmDelete?.length} accounts`}?`}
        description="The mailbox itself is not touched. Its campaign history stays, but it stops sending and warming up."
        width={460}
        footer={<><Button onClick={() => setConfirmDelete(null)}>Cancel</Button><Button variant="danger" onClick={() => confirmDelete && remove(confirmDelete)}>Remove</Button></>}
      >
        <span />
      </Modal>
    </Page>
  );
}
