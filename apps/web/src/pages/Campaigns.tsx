import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { get, post, del, qs } from '@/lib/api';
import { Page, PageHeader } from '@/components/Layout';
import { Button, Empty, Field, Menu, Modal, PageLoader, ProgressBar, SearchInput, Segmented, StatusPill, useToast } from '@/components/ui';
import { fmt, pctStr } from '@/lib/format';

export function campaignHref(c: { id: string; status: string }) {
  return c.status === 'draft' ? `/campaigns/${c.id}/edit/sequence` : `/campaigns/${c.id}`;
}

export function NewCampaignModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const toast = useToast();
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await post('/api/campaigns', { name, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      onClose();
      setName('');
      nav(`/campaigns/${res.id}/edit/leads`);
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="New campaign" width={460} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="new-campaign" loading={busy} disabled={!name.trim()}>Create</Button></>}>
      <form id="new-campaign" onSubmit={create}>
        <Field label="Campaign name">
          <input className="inp" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Law firms – UK" />
        </Field>
      </form>
    </Modal>
  );
}

export default function Campaigns() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['campaigns', q, status], queryFn: () => get(`/api/campaigns${qs({ q, status })}`), refetchInterval: 30_000 });
  const counts = data?.counts ?? {};
  const total = Object.values(counts).reduce((a: number, b: any) => a + Number(b), 0) as number;
  const rows = data?.campaigns ?? [];
  const action = async (fn: () => Promise<any>, msg: string) => {
    try {
      await fn();
      toast(msg);
      qc.invalidateQueries({ queryKey: ['campaigns'] });
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };
  return (
    <Page>
      <PageHeader title="Campaigns" subtitle={`${total} campaign${total === 1 ? '' : 's'} · ${counts.active ?? 0} active`}>
        <SearchInput value={q} onChange={setQ} placeholder="Search campaigns" label="Search campaigns" />
        <Button variant="primary" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
          New campaign
        </Button>
      </PageHeader>
      <Segmented
        label="Status"
        value={status}
        onChange={setStatus}
        options={[
          { value: '', label: `All ${total}` },
          { value: 'active', label: `Active ${counts.active ?? 0}` },
          { value: 'paused', label: `Paused ${counts.paused ?? 0}` },
          { value: 'draft', label: `Draft ${counts.draft ?? 0}` },
          { value: 'completed', label: `Completed ${counts.completed ?? 0}` },
        ]}
      />
      <div className="card overflow-hidden">
        {isLoading ? (
          <PageLoader />
        ) : !rows.length ? (
          <Empty title={q || status ? 'No campaigns match' : 'No campaigns yet'} action={!q && !status && <Button variant="primary" onClick={() => setOpen(true)}>New campaign</Button>}>
            {!q && !status && 'A campaign is a list of leads, a sequence of emails and the accounts that send them.'}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th>Leads</th>
                  <th>Progress</th>
                  <th>Sent</th>
                  <th>Opened</th>
                  <th>Replied</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c: any) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={campaignHref(c)} className="block font-medium text-ink hover:text-accent">
                        {c.name}
                      </Link>
                      <span className="text-xs text-muted">
                        Created {new Date(c.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · {c.steps} step{c.steps === 1 ? '' : 's'}
                        {c.accounts ? ` · ${c.accounts} account${c.accounts === 1 ? '' : 's'}` : ''}
                      </span>
                    </td>
                    <td><StatusPill status={c.status} /></td>
                    <td>{c.leads ? fmt(c.leads) : '—'}</td>
                    <td><ProgressBar value={c.progress} width={100} /></td>
                    <td>{c.sent ? fmt(c.sent) : '—'}</td>
                    <td>{c.contacted ? (c.openRate === null ? <span className="text-xs text-muted">tracking off</span> : pctStr(c.openRate)) : '—'}</td>
                    <td>{c.contacted ? pctStr(c.replyRate) : '—'}</td>
                    <td className="text-right">
                      <Menu
                        ghost
                        label={`Actions for ${c.name}`}
                        items={[
                          { label: c.status === 'draft' ? 'Edit' : 'Open report', onClick: () => nav(campaignHref(c)) },
                          { label: 'Edit sequence & settings', hidden: c.status === 'draft', onClick: () => nav(`/campaigns/${c.id}/edit/sequence`) },
                          { label: 'Pause', hidden: c.status !== 'active', onClick: () => action(() => post(`/api/campaigns/${c.id}/pause`), 'Campaign paused') },
                          { label: 'Resume', hidden: c.status !== 'paused', onClick: () => action(() => post(`/api/campaigns/${c.id}/resume`), 'Campaign resumed') },
                          { label: 'Duplicate', onClick: () => action(() => post(`/api/campaigns/${c.id}/duplicate`), 'Campaign duplicated') },
                          { divider: true, label: '' },
                          { label: 'Delete', danger: true, onClick: () => confirm(`Delete "${c.name}" and its stats? This cannot be undone.`) && action(() => del(`/api/campaigns/${c.id}`), 'Campaign deleted') },
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
      <NewCampaignModal open={open} onClose={() => setOpen(false)} />
    </Page>
  );
}
