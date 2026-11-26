import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, CheckCircle2 } from 'lucide-react';
import { get, post, qs } from '@/lib/api';
import { Button, Empty, Menu, Modal, PageLoader, SearchInput, StatusPill, Spinner, useToast } from '@/components/ui';
import { fmt, timeAgo } from '@/lib/format';

const FIELD_OPTIONS = [
  { value: 'email', label: 'Email (required)' },
  { value: 'firstName', label: 'First name' },
  { value: 'lastName', label: 'Last name' },
  { value: 'company', label: 'Company' },
  { value: 'custom', label: 'Custom variable' },
  { value: 'skip', label: "Don't import" },
];

function ImportModal({ listId, open, onClose }: { listId: string; open: boolean; onClose: () => void }) {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [sample, setSample] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [skipActive, setSkipActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState('');
  const qc = useQueryClient();
  const reset = () => {
    setCsv(null);
    setFileName('');
    setHeaders([]);
    setReport(null);
    setError('');
  };
  const close = () => {
    reset();
    onClose();
  };
  const pick = async (file: File) => {
    setError('');
    setFileName(file.name);
    const text = await file.text();
    try {
      const res = await post('/api/lists/preview-csv', { csv: text.slice(0, 200_000) });
      if (!res.headers.length) throw new Error('No header row found');
      setCsv(text);
      setHeaders(res.headers);
      setSample(res.sample);
      setMapping(res.mapping);
    } catch (err: any) {
      setError(err.message);
    }
  };
  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await post(`/api/lists/${listId}/import`, { csv, mapping, skipInActiveCampaigns: skipActive });
      setReport(res);
      qc.invalidateQueries({ queryKey: ['campaign-leads'] });
      qc.invalidateQueries({ queryKey: ['campaign'] });
      qc.invalidateQueries({ queryKey: ['list-vars'] });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const fieldOf = (h: string) => (['email', 'firstName', 'lastName', 'company', 'skip'].includes(mapping[h]) ? mapping[h] : 'custom');
  const hasEmail = Object.values(mapping).includes('email');
  return (
    <Modal
      open={open}
      onClose={close}
      title="Import leads from CSV"
      description={!csv ? 'Every column becomes a variable you can use in emails, e.g. First Name → {{firstName}}.' : undefined}
      width={720}
      footer={
        report ? (
          <Button variant="primary" onClick={close}>Done</Button>
        ) : (
          <>
            {csv && <Button variant="ghost" className="mr-auto" onClick={reset}>Choose another file</Button>}
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" disabled={!csv || !hasEmail} loading={busy} onClick={run}>Import</Button>
          </>
        )
      }
    >
      {report ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-base font-semibold">
            <CheckCircle2 className="h-5 w-5 text-[#15803D]" aria-hidden />
            {fmt(report.imported)} leads imported
          </div>
          <ul className="m-0 list-none space-y-1 p-0 text-sm text-muted">
            <li>{fmt(report.total)} rows in the file</li>
            {report.duplicates > 0 && <li>{fmt(report.duplicates)} duplicates skipped (already in this list or repeated in the file)</li>}
            {report.skippedActive > 0 && <li>{fmt(report.skippedActive)} skipped because they are already in an active campaign</li>}
            {report.invalidCount > 0 && <li className="text-[#991B1B]">{fmt(report.invalidCount)} rejected for an invalid email</li>}
          </ul>
          {report.invalid.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-lg border border-soft text-sm">
              {report.invalid.map((r: any) => (
                <div key={r.row} className="flex gap-3 border-b border-soft px-3 py-1.5 last:border-0">
                  <span className="w-16 text-muted">Row {r.row}</span>
                  <span className="flex-1 truncate">{r.email || '(empty)'}</span>
                  <span className="text-[#991B1B]">{r.reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : !csv ? (
        <div className="flex flex-col gap-3">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-[10px] border border-dashed border-[#C7C7CF] bg-white px-4 py-10 text-center text-sm hover:bg-[#FAFAFF]">
            <FileUp className="h-6 w-6 text-accent" aria-hidden />
            <span className="font-medium text-accent">{fileName || 'Choose a CSV file'}</span>
            <span className="text-xs text-muted">Up to 100,000 rows. Needs an email column.</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
          </label>
          {error && <p role="alert" className="m-0 text-sm text-[#B91C1C]">{error}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="max-h-[340px] overflow-auto rounded-lg border border-soft">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Sample</th>
                  <th>Import as</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((h) => (
                  <tr key={h}>
                    <td className="font-medium">{h}</td>
                    <td className="max-w-[180px] truncate text-muted">{sample.map((r) => r[h]).filter(Boolean).slice(0, 2).join(', ') || '—'}</td>
                    <td>
                      <div className="flex gap-2">
                        <select
                          aria-label={`Import ${h} as`}
                          className="inp h-9 w-40"
                          value={fieldOf(h)}
                          onChange={(e) => {
                            const v = e.target.value;
                            const next = { ...mapping };
                            if (v === 'email') for (const key of Object.keys(next)) if (next[key] === 'email') next[key] = 'skip';
                            next[h] = v === 'custom' ? h.replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string) => (c ? c.toUpperCase() : '')).replace(/^./, (c) => c.toLowerCase()) || 'field' : v;
                            setMapping(next);
                          }}
                        >
                          {FIELD_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        {fieldOf(h) === 'custom' && (
                          <input aria-label={`Variable name for ${h}`} className="inp h-9 w-36 font-mono text-xs" value={mapping[h]} onChange={(e) => setMapping({ ...mapping, [h]: e.target.value.replace(/[^A-Za-z0-9_]/g, '') })} />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-accent" checked={skipActive} onChange={(e) => setSkipActive(e.target.checked)} />
            Skip leads that are already in another active campaign
          </label>
          <p className="m-0 text-xs text-muted">Leads already in this list are always skipped. Invalid emails are rejected and listed in the report.</p>
          {!hasEmail && <p role="alert" className="m-0 text-sm text-[#B91C1C]">Choose which column holds the email address.</p>}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Spinner className="h-4 w-4" /> Importing…
            </div>
          )}
          {error && <p role="alert" className="m-0 text-sm text-[#B91C1C]">{error}</p>}
        </div>
      )}
    </Modal>
  );
}

export function LeadsTab({ campaign }: { campaign: any }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['campaign-leads', campaign.id, q, page], queryFn: () => get(`/api/campaigns/${campaign.id}/leads${qs({ q, page })}`) });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  if (!campaign.listId) return <Empty title="No lead list" />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex-1 text-sm text-muted">{fmt(campaign.listLeads)} leads in “{campaign.listName}”</span>
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search leads" label="Search leads" />
        <Button onClick={() => setOpen(true)}>
          <FileUp className="h-4 w-4" aria-hidden />
          Import CSV
        </Button>
        {campaign.status === 'draft' && campaign.listLeads > 0 && (
          <Menu
            label="Lead actions"
            items={[
              {
                label: 'Remove all leads',
                danger: true,
                onClick: async () => {
                  if (!confirm('Remove all leads from this campaign?')) return;
                  const r = await post(`/api/lists/${campaign.listId}/leads/delete`, { all: true });
                  toast(`Removed ${r.deleted} leads`);
                  qc.invalidateQueries({ queryKey: ['campaign-leads'] });
                  qc.invalidateQueries({ queryKey: ['campaign'] });
                },
              },
            ]}
          />
        )}
      </div>
      <div className="card overflow-hidden">
        {isLoading ? (
          <PageLoader />
        ) : !rows.length ? (
          <Empty title={q ? 'No leads match' : 'No leads yet'} action={!q && <Button variant="primary" onClick={() => setOpen(true)}>Import CSV</Button>}>
            {!q && 'Upload a CSV with at least an email column. Other columns become variables.'}
          </Empty>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Lead</th>
                    <th>Company</th>
                    <th>Status</th>
                    <th>Step</th>
                    <th>Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id}>
                      <td>
                        <span className="block font-medium">{`${r.firstName} ${r.lastName}`.trim() || r.email}</span>
                        <span className="text-xs text-muted">{r.email}</span>
                      </td>
                      <td className="text-muted">{r.company || '—'}</td>
                      <td><StatusPill status={r.status} /></td>
                      <td className="text-muted">{r.step ? `Step ${r.step}` : '—'}</td>
                      <td className="text-muted">{r.lastActivity ? `${r.lastActivity} · ${timeAgo(r.lastActivityAt)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {total > 50 && (
              <div className="flex items-center justify-end gap-2 border-t border-soft px-4 py-2.5 text-sm text-muted">
                {(page - 1) * 50 + 1}–{Math.min(page * 50, total)} of {fmt(total)}
                <Button size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button size="sm" disabled={page * 50 >= total} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            )}
          </>
        )}
      </div>
      <ImportModal listId={campaign.listId} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
