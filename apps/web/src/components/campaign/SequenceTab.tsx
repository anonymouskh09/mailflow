import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Plus } from 'lucide-react';
import { get, post, put } from '@/lib/api';
import { Button, Dropdown, Menu, Modal, useToast } from '@/components/ui';
import { RichEditor, type RichEditorHandle } from './RichEditor';
import { cn } from '@/lib/cn';

interface Step {
  id?: string;
  key: string;
  delayDays: number;
  subject: string;
  bodyHtml: string;
}

let k = 0;
const toLocal = (steps: any[]): Step[] => steps.map((s) => ({ id: s.id, key: s.id ?? `n${k++}`, delayDays: s.delayDays, subject: s.subject, bodyHtml: s.bodyHtml }));

export function SequenceTab({ campaign, onSaved }: { campaign: any; onSaved: (at: Date) => void }) {
  const [steps, setSteps] = useState<Step[]>(() => toLocal(campaign.steps));
  const [sel, setSel] = useState(0);
  const [preview, setPreview] = useState<any>(null);
  const [leadId, setLeadId] = useState<string>('');
  const [error, setError] = useState('');
  const editor = useRef<RichEditorHandle>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const launched = campaign.status !== 'draft';
  const savedCount = campaign.steps.length;
  const { data: vars } = useQuery({ queryKey: ['list-vars', campaign.listId], queryFn: () => get(`/api/lists/${campaign.listId}/variables`), enabled: !!campaign.listId });
  const { data: leadsData } = useQuery({ queryKey: ['campaign-leads', campaign.id, 'preview'], queryFn: () => get(`/api/campaigns/${campaign.id}/leads?pageSize=50`) });
  const variables = useMemo(() => [...(vars?.variables ?? ['firstName', 'lastName', 'company', 'email']), 'senderName', 'signature', 'unsubscribeLink'], [vars]);
  const leads = leadsData?.rows ?? [];

  // Debounced autosave of the whole sequence.
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const dirty = useRef(false);
  const save = async (list: Step[]) => {
    try {
      const res = await put(`/api/campaigns/${campaign.id}/steps`, { steps: list.map((s) => ({ id: s.id, delayDays: s.delayDays, subject: s.subject, bodyHtml: s.bodyHtml })) });
      // map server ids onto new steps
      setSteps((cur) => cur.map((s, i) => ({ ...s, id: res.steps[i]?.id ?? s.id })));
      qc.setQueryData(['campaign', campaign.id], res);
      dirty.current = false;
      setError('');
      onSaved(new Date());
    } catch (err: any) {
      setError(err.message);
    }
  };
  const update = (next: Step[]) => {
    setSteps(next);
    dirty.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(next), 700);
  };
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (dirty.current) void save(stepsRef.current);
    },
    [],
  );
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const step = steps[sel] ?? steps[0];
  const set = (patch: Partial<Step>) => update(steps.map((s, i) => (i === sel ? { ...s, ...patch } : s)));
  const addStep = () => {
    const next = [...steps, { key: `n${k++}`, delayDays: steps.length === 1 ? 2 : 3, subject: '', bodyHtml: '' }];
    update(next);
    setSel(next.length - 1);
  };
  const move = (dir: -1 | 1) => {
    const j = sel + dir;
    if (j < 0 || j >= steps.length) return;
    const next = [...steps];
    [next[sel], next[j]] = [next[j], next[sel]];
    update(next);
    setSel(j);
  };
  const remove = () => {
    if (steps.length === 1) return;
    const next = steps.filter((_, i) => i !== sel);
    update(next);
    setSel(Math.max(0, sel - 1));
  };
  const doPreview = async () => {
    try {
      const res = await post(`/api/campaigns/${campaign.id}/preview`, { position: sel + 1, leadId: leadId || undefined, subject: step.subject, bodyHtml: step.bodyHtml });
      setPreview(res);
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };
  const sendTest = async () => {
    clearTimeout(timer.current);
    await save(steps);
    try {
      const res = await post(`/api/campaigns/${campaign.id}/test-email`, { position: sel + 1, leadId: leadId || undefined });
      toast(`Test sent from ${res.from} to ${res.to}`);
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };
  const firstSubject = steps[0]?.subject || 'Step 1 subject';
  const lockedStep = launched && sel < savedCount;
  const leadLabel = (l: any) => [`${l.firstName} ${l.lastName}`.trim() || l.email, l.company].filter(Boolean).join(' · ');

  return (
    <div className="flex flex-wrap items-start gap-5">
      <div className="flex max-w-[340px] flex-[1_1_280px] flex-col">
        {steps.map((s, i) => (
          <div key={s.key}>
            {i > 0 && (
              <div className="flex items-center gap-2 py-1.5 pl-[18px] text-xs text-muted">
                <span className="h-[22px] w-0.5 bg-[#D4D4D8]" />
                <Clock className="h-3.5 w-3.5" aria-hidden />
                Wait {s.delayDays} day{s.delayDays === 1 ? '' : 's'}
              </div>
            )}
            <button
              onClick={() => setSel(i)}
              aria-current={i === sel ? 'step' : undefined}
              className={cn('w-full rounded-[10px] border bg-white px-4 py-3.5 text-left', i === sel ? 'border-accent shadow-[0_0_0_3px_#EEF2FF]' : 'border-line hover:border-[#A5B4FC]')}
            >
              <span className="block text-xs font-semibold text-accent">Step {i + 1}</span>
              <span className="mt-1 block truncate text-sm font-medium text-ink">{s.subject || (i === 0 ? 'No subject yet' : 'Same thread (reply)')}</span>
            </button>
          </div>
        ))}
        <button onClick={addStep} className="mt-3.5 flex h-11 items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-[#C7C7CF] bg-white text-sm font-medium text-accent hover:bg-[#FAFAFF]">
          <Plus className="h-4 w-4" aria-hidden />
          Add follow-up
        </button>
        {launched && <p className="mt-3 text-xs text-muted">The campaign is running: edits apply to emails not sent yet. New steps can be added at the end.</p>}
      </div>

      <section className="card flex min-w-0 flex-[999_1_480px] flex-col">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-soft px-5 py-4">
          <h2 className="m-0 flex-auto text-base font-semibold">
            Step {sel + 1} · {sel === 0 ? 'First email' : 'Follow-up'}
          </h2>
          {sel > 0 && (
            <label className="inline-flex items-center gap-2 text-sm text-[#3F3F46]">
              Send
              <input
                className="inp w-14 text-center"
                inputMode="numeric"
                aria-label="Days to wait"
                value={step.delayDays}
                onChange={(e) => set({ delayDays: Math.min(365, Number(e.target.value.replace(/\D/g, '') || 0)) })}
              />
              days after Step {sel}
            </label>
          )}
          <Menu
            ghost
            label="Step actions"
            items={[
              { label: 'Send test email', onClick: sendTest },
              { label: 'Move up', disabled: sel === 0 || lockedStep, onClick: () => move(-1) },
              { label: 'Move down', disabled: sel === steps.length - 1 || lockedStep || (launched && sel + 1 < savedCount), onClick: () => move(1) },
              { divider: true, label: '' },
              { label: 'Delete step', danger: true, disabled: steps.length === 1 || lockedStep, onClick: remove },
            ]}
          />
        </div>
        <div className="flex flex-col gap-3 px-5 py-4">
          <label>
            <span className="lbl">Subject</span>
            <input className="inp" value={step.subject} onChange={(e) => set({ subject: e.target.value })} placeholder={sel === 0 ? 'Quick question, {{firstName}}' : `Empty = reply in the same thread (Re: ${firstSubject})`} />
          </label>
          <RichEditor key={step.key} ref={editor} value={step.bodyHtml} onChange={(html) => set({ bodyHtml: html })} variables={variables} label={`Step ${sel + 1} body`} />
          {error && <p role="alert" className="m-0 text-sm text-[#B91C1C]">{error}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2.5 rounded-b-card border-t border-soft bg-[#FAFAFA] px-5 py-3.5">
          <span className="flex-auto text-[13px] text-muted">Preview as</span>
          {leads.length > 0 ? (
            <Dropdown label="Choose lead" value={leadId || leads[0].leadId} onChange={setLeadId} options={leads.map((l: any) => ({ value: l.leadId, label: leadLabel(l) }))} className="h-9 max-w-[280px]" />
          ) : (
            <span className="text-[13px] text-muted">sample lead (no leads yet)</span>
          )}
          <Button size="sm" onClick={doPreview}>
            Preview
          </Button>
        </div>
      </section>

      <Modal open={!!preview} onClose={() => setPreview(null)} title={`Preview · Step ${sel + 1}`} width={680} footer={<><Button onClick={sendTest}>Send test email</Button><Button onClick={() => setPreview(null)}>Close</Button></>}>
        {preview && (
          <div className="flex flex-col gap-3">
            {Object.keys(preview.missingCounts).length > 0 && (
              <div role="alert" className="rounded-lg bg-[#FEF3C7] px-3 py-2.5 text-sm text-[#92400E]">
                {Object.entries(preview.missingCounts).map(([v, n]) => (
                  <div key={v}>
                    {String(n)} lead{n === 1 ? ' is' : 's are'} missing <span className="font-mono">{`{{${v}}}`}</span> and it has no fallback. Add one like <span className="font-mono">{`{{${v} | there}}`}</span>.
                  </div>
                ))}
              </div>
            )}
            <div className="text-[13px] text-muted">
              <div>From: {preview.from}</div>
              <div>To: {preview.to}</div>
            </div>
            <div className="text-base font-semibold">{preview.subject || '(no subject)'}</div>
            {preview.html ? <div className="mail-body rounded-lg border border-line p-4 text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: preview.html }} /> : <pre className="whitespace-pre-wrap rounded-lg border border-line p-4 font-sans text-sm">{preview.text}</pre>}
          </div>
        )}
      </Modal>
    </div>
  );
}
