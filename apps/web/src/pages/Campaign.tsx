import { useEffect, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play } from 'lucide-react';
import { get, post, del, patch } from '@/lib/api';
import { Page } from '@/components/Layout';
import { Button, Menu, Modal, PageLoader, useToast, Field } from '@/components/ui';
import { CampaignHeader } from '@/components/campaign/CampaignHeader';
import { SequenceTab } from '@/components/campaign/SequenceTab';
import { LeadsTab } from '@/components/campaign/LeadsTab';
import { SettingsTab } from '@/components/campaign/SettingsTab';
import { AnalyticsTab } from '@/components/campaign/AnalyticsTab';
import { fmt, timeAgo, daysLabel } from '@/lib/format';
import { cn } from '@/lib/cn';

export default function CampaignPage() {
  const { id, tab: tabParam } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: c, isLoading } = useQuery({ queryKey: ['campaign', id], queryFn: () => get(`/api/campaigns/${id}`) });
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [, force] = useState(0);
  const [launching, setLaunching] = useState(false);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (isLoading || !c) return <PageLoader />;
  // Launched campaigns open on Analytics; drafts open on Leads (or Sequence once leads exist).
  const tab = tabParam ?? (c.status === 'draft' ? (c.listLeads ? 'sequence' : 'leads') : 'analytics');

  const launch = async () => {
    setLaunching(true);
    // let pending autosaves land first
    await new Promise((r) => setTimeout(r, 900));
    try {
      await post(`/api/campaigns/${id}/launch`);
      toast('Campaign launched');
      qc.invalidateQueries({ queryKey: ['campaigns'] });
      qc.invalidateQueries({ queryKey: ['campaign', id] });
      nav(`/campaigns/${id}/analytics`);
    } catch (err: any) {
      setProblems(err.message.split('. ').filter(Boolean));
    } finally {
      setLaunching(false);
    }
  };
  const tabs = [
    { key: 'analytics', label: 'Analytics' },
    { key: 'leads', label: 'Leads', extra: fmt(c.listLeads) },
    { key: 'sequence', label: 'Sequence' },
    { key: 'settings', label: 'Settings' },
  ];
  const onSaved = (d: Date) => setSavedAt(d);
  const savedText = savedAt ? `Saved ${timeAgo(savedAt) === 'just now' ? 'just now' : timeAgo(savedAt)}` : `Saved ${timeAgo(c.updatedAt)}`;
  const meta = tab === 'analytics' || tab === 'leads' ? `${c.steps.length} step${c.steps.length === 1 ? '' : 's'} · ${c.accountIds.length} account${c.accountIds.length === 1 ? '' : 's'} · ${daysLabel(c.days)} ${c.windowStart}–${c.windowEnd}` : savedText;
  const togglePause = async () => {
    try {
      await post(`/api/campaigns/${id}/${c.status === 'active' ? 'pause' : 'resume'}`);
      toast(c.status === 'active' ? 'Campaign paused' : 'Campaign resumed');
      qc.invalidateQueries({ queryKey: ['campaign', id] });
      qc.invalidateQueries({ queryKey: ['campaigns'] });
    } catch (e: any) {
      toast(e.message, 'error');
    }
  };

  return (
    <Page className="gap-4">
      <CampaignHeader name={c.name} status={c.status} meta={meta}>
        <Menu
          label="More campaign actions"
          items={[
            { label: 'Rename', onClick: () => setRenaming(c.name) },
            { label: 'Duplicate', onClick: async () => { const r = await post(`/api/campaigns/${id}/duplicate`); nav(`/campaigns/${r.id}/sequence`); } },
            { divider: true, label: '' },
            { label: 'Delete campaign', danger: true, onClick: async () => { if (confirm('Delete this campaign? This cannot be undone.')) { await del(`/api/campaigns/${id}`); qc.invalidateQueries({ queryKey: ['campaigns'] }); nav('/campaigns'); } } },
          ]}
        />
        {c.status === 'draft' && (
          <Button variant="primary" loading={launching} onClick={launch}>
            {!launching && <Play className="h-4 w-4" fill="currentColor" aria-hidden />}
            Launch
          </Button>
        )}
        {c.status === 'active' && (
          <Button onClick={togglePause}>
            <Pause className="h-4 w-4" fill="currentColor" aria-hidden />
            Pause
          </Button>
        )}
        {c.status === 'paused' && (
          <Button variant="primary" onClick={togglePause}>
            <Play className="h-4 w-4" fill="currentColor" aria-hidden />
            Resume
          </Button>
        )}
      </CampaignHeader>
      <nav aria-label="Campaign editor" className="flex flex-wrap gap-6 border-b border-line">
        {tabs.map((t) => (
          <NavLink
            key={t.key}
            to={`/campaigns/${id}/${t.key}`}
            className={() => cn('inline-flex h-11 items-center gap-1.5 border-b-2 px-1 text-sm font-medium', tab === t.key ? 'border-accent text-ink hover:text-ink' : 'border-transparent text-muted hover:text-ink')}
          >
            {t.label}
            {t.extra && <span className="font-normal text-muted">{t.extra}</span>}
          </NavLink>
        ))}
      </nav>
      {tab === 'analytics' && <AnalyticsTab campaign={c} />}
      {tab === 'leads' && <LeadsTab campaign={c} />}
      {tab === 'sequence' && <SequenceTab key={c.id} campaign={c} onSaved={onSaved} />}
      {tab === 'settings' && <SettingsTab key={c.id} campaign={c} onSaved={onSaved} />}

      <Modal open={!!problems} onClose={() => setProblems(null)} title="Almost ready to launch" width={480} footer={<Button variant="primary" onClick={() => setProblems(null)}>OK</Button>}>
        <ul className="m-0 list-disc space-y-1 pl-5 text-sm">
          {problems?.map((p) => <li key={p}>{p.replace(/\.$/, '')}</li>)}
        </ul>
      </Modal>
      <Modal
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title="Rename campaign"
        width={460}
        footer={<><Button onClick={() => setRenaming(null)}>Cancel</Button><Button variant="primary" type="submit" form="rename">Save</Button></>}
      >
        <form id="rename" onSubmit={async (e) => { e.preventDefault(); if (!renaming?.trim()) return; await patch(`/api/campaigns/${id}`, { name: renaming }); qc.invalidateQueries({ queryKey: ['campaign', id] }); setRenaming(null); }}>
          <Field label="Name"><input className="inp" value={renaming ?? ''} onChange={(e) => setRenaming(e.target.value)} /></Field>
        </form>
      </Modal>
    </Page>
  );
}
