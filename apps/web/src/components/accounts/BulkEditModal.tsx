import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Field, useToast } from '@/components/ui';
import { patch } from '@/lib/api';

export function BulkEditModal({ ids, open, onClose }: { ids: string[]; open: boolean; onClose: () => void }) {
  const [f, setF] = useState({ dailyLimit: '', gapMinMinutes: '', signatureHtml: '', addTags: '', warmup: '' as '' | 'on' | 'off' });
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body: any = { ids };
    if (f.dailyLimit) body.dailyLimit = Number(f.dailyLimit);
    if (f.gapMinMinutes) body.gapMinMinutes = Number(f.gapMinMinutes);
    if (f.signatureHtml) body.signatureHtml = f.signatureHtml;
    if (f.addTags.trim()) body.addTags = f.addTags.split(',').map((t) => t.trim()).filter(Boolean);
    if (f.warmup) body.warmup = f.warmup === 'on';
    if (Object.keys(body).length === 1) return onClose();
    setBusy(true);
    try {
      await patch('/api/accounts/bulk', body);
      toast(`Updated ${ids.length} account${ids.length === 1 ? '' : 's'}`);
      qc.invalidateQueries({ queryKey: ['accounts'] });
      setF({ dailyLimit: '', gapMinMinutes: '', signatureHtml: '', addTags: '', warmup: '' });
      onClose();
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit ${ids.length} account${ids.length === 1 ? '' : 's'}`}
      description="Only the fields you fill in are changed."
      width={520}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="bulk-edit" loading={busy}>
            Apply
          </Button>
        </>
      }
    >
      <form id="bulk-edit" onSubmit={save} className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Daily campaign limit">
            <input className="inp" inputMode="numeric" placeholder="e.g. 30" value={f.dailyLimit} onChange={(e) => setF({ ...f, dailyLimit: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field label="Min. gap (minutes)">
            <input className="inp" inputMode="numeric" placeholder="e.g. 10" value={f.gapMinMinutes} onChange={(e) => setF({ ...f, gapMinMinutes: e.target.value.replace(/\D/g, '') })} />
          </Field>
        </div>
        <Field label="Warmup">
          <select className="inp" value={f.warmup} onChange={(e) => setF({ ...f, warmup: e.target.value as any })}>
            <option value="">Leave as is</option>
            <option value="on">Turn on</option>
            <option value="off">Turn off</option>
          </select>
        </Field>
        <Field label="Signature" hint="Use {{senderName}} to insert each account's own from-name.">
          <textarea className="inp h-24" value={f.signatureHtml} onChange={(e) => setF({ ...f, signatureHtml: e.target.value })} placeholder={'{{senderName}}\nGrowth Lead'} />
        </Field>
        <Field label="Add tags" hint="Comma separated">
          <input className="inp" value={f.addTags} onChange={(e) => setF({ ...f, addTags: e.target.value })} placeholder="UK team, Google" />
        </Field>
      </form>
    </Modal>
  );
}
