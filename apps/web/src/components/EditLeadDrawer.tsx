import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { get, patch } from '@/lib/api';
import { Button, Drawer, Field, Spinner, useToast } from '@/components/ui';

const label = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const toKey = (s: string) =>
  s
    .trim()
    .replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string) => (c ? c.toUpperCase() : ''))
    .replace(/^[^A-Za-z]+/, '')
    .replace(/^./, (c) => c.toLowerCase());

/** Side panel to edit a lead's details, pre-filled with the current values. */
export function EditLeadDrawer({ leadId, open, onClose, onSaved }: { leadId: string | null; open: boolean; onClose: () => void; onSaved?: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: lead, isLoading } = useQuery({ queryKey: ['lead', leadId], queryFn: () => get(`/api/leads/${leadId}`), enabled: open && !!leadId });
  const [f, setF] = useState({ firstName: '', lastName: '', company: '' });
  const [fields, setFields] = useState<{ key: string; value: string }[]>([]);
  const [newField, setNewField] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!lead || !open) return;
    setF({ firstName: lead.firstName ?? '', lastName: lead.lastName ?? '', company: lead.company ?? '' });
    setFields(Object.entries((lead.customFields ?? {}) as Record<string, string>).map(([key, value]) => ({ key, value: String(value ?? '') })));
    setNewField('');
    setError('');
  }, [lead, open]);

  const addField = () => {
    const key = toKey(newField);
    if (!key) return;
    if (['email', 'firstName', 'lastName', 'company'].includes(key) || fields.some((x) => x.key === key)) {
      setError(`A field called "${key}" already exists`);
      return;
    }
    setFields([...fields, { key, value: '' }]);
    setNewField('');
    setError('');
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await patch(`/api/leads/${leadId}`, { ...f, customFields: Object.fromEntries(fields.map((x) => [x.key, x.value])) });
      toast('Lead saved');
      qc.invalidateQueries({ queryKey: ['lead', leadId] });
      qc.invalidateQueries({ queryKey: ['thread'] });
      qc.invalidateQueries({ queryKey: ['threads'] });
      qc.invalidateQueries({ queryKey: ['campaign-leads'] });
      onSaved?.();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Edit lead"
      description="Changes are used in future emails ({{firstName}}, {{company}}, …) and in the Unibox."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="edit-lead" loading={busy} disabled={!lead}>
            Save
          </Button>
        </>
      }
    >
      {isLoading || !lead ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <form id="edit-lead" onSubmit={save} className="flex flex-col gap-3.5">
          <Field label="Email" hint="The email can't be changed here, so replies keep matching this lead.">
            <input className="inp" value={lead.email} disabled />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name">
              <input className="inp" value={f.firstName} placeholder="First name" onChange={(e) => setF({ ...f, firstName: e.target.value })} />
            </Field>
            <Field label="Last name">
              <input className="inp" value={f.lastName} placeholder="Last name" onChange={(e) => setF({ ...f, lastName: e.target.value })} />
            </Field>
          </div>
          <Field label="Company">
            <input className="inp" value={f.company} placeholder="Company" onChange={(e) => setF({ ...f, company: e.target.value })} />
          </Field>

          <div className="mt-1 border-t border-soft pt-3.5">
            <span className="lbl">Other fields</span>
            {!fields.length && <p className="m-0 text-[13px] text-muted">No other fields. Columns from the CSV import show up here.</p>}
            <div className="flex flex-col gap-2.5">
              {fields.map((x, i) => (
                <div key={x.key} className="flex items-end gap-2">
                  <label className="block min-w-0 flex-1">
                    <span className="mb-1 block text-xs text-muted">
                      {label(x.key)} <span className="font-mono">{`{{${x.key}}}`}</span>
                    </span>
                    <input className="inp" value={x.value} placeholder={label(x.key)} onChange={(e) => setFields(fields.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))} />
                  </label>
                  <Button icon variant="ghost" aria-label={`Remove ${label(x.key)}`} onClick={() => setFields(fields.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4 text-muted" aria-hidden />
                  </Button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                className="inp"
                aria-label="New field name"
                placeholder="New field, e.g. City"
                value={newField}
                onChange={(e) => setNewField(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addField();
                  }
                }}
              />
              <Button onClick={addField} disabled={!newField.trim()}>
                <Plus className="h-4 w-4" aria-hidden />
                Add
              </Button>
            </div>
          </div>
          {error && <p role="alert" className="m-0 text-sm text-[#B91C1C]">{error}</p>}
        </form>
      )}
    </Drawer>
  );
}
