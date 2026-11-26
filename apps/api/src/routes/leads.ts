import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import Papa from 'papaparse';
import { prisma, type Prisma } from '@mailflow/db';
import { isValidEmail, toVarName, syncCampaignLeads, addSuppression } from '@mailflow/core';
import { badRequest, notFound, sendCsv } from '../util.js';

const BASE_FIELDS = ['email', 'firstName', 'lastName', 'company'] as const;

/** Suggest a field for each CSV header. */
export function suggestMapping(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) {
    const v = toVarName(h);
    const k = v.toLowerCase();
    if (['email', 'emailaddress', 'mail', 'workemail', 'eMail'.toLowerCase()].includes(k)) out[h] = 'email';
    else if (['firstname', 'first', 'givenname', 'fname'].includes(k)) out[h] = 'firstName';
    else if (['lastname', 'last', 'surname', 'familyname', 'lname'].includes(k)) out[h] = 'lastName';
    else if (['company', 'companyname', 'organization', 'organisation', 'account', 'accountname'].includes(k)) out[h] = 'company';
    else out[h] = v || 'skip';
  }
  if (!Object.values(out).includes('email')) {
    const guess = headers.find((h) => /e-?mail/i.test(h));
    if (guess) out[guess] = 'email';
  }
  return out;
}

const importSchema = z.object({
  csv: z.string().min(1),
  mapping: z.record(z.string()), // header -> email | firstName | lastName | company | skip | <customVar>
  skipInActiveCampaigns: z.boolean().default(false),
});

export async function importLeads(listId: string, body: z.infer<typeof importSchema>) {
  const parsed = Papa.parse<Record<string, string>>(body.csv.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: 'greedy' });
  const emailHeader = Object.entries(body.mapping).find(([, v]) => v === 'email')?.[0];
  if (!emailHeader) throw badRequest('Map one column to Email');
  if (parsed.data.length > 100_000) throw badRequest('At most 100,000 rows per import');
  const invalid: { row: number; email: string; reason: string }[] = [];
  const seen = new Set<string>();
  let fileDuplicates = 0;
  const rows: Prisma.LeadCreateManyInput[] = [];
  parsed.data.forEach((r, i) => {
    const email = String(r[emailHeader] ?? '').trim().toLowerCase();
    if (!isValidEmail(email)) {
      if (invalid.length < 1000) invalid.push({ row: i + 2, email, reason: email ? 'Invalid email format' : 'Empty email' });
      else invalid.push({ row: i + 2, email: '', reason: '' });
      return;
    }
    if (seen.has(email)) {
      fileDuplicates++;
      return;
    }
    seen.add(email);
    const lead: Prisma.LeadCreateManyInput = { listId, email, firstName: '', lastName: '', company: '', customFields: {} };
    const custom: Record<string, string> = {};
    for (const [header, field] of Object.entries(body.mapping)) {
      if (field === 'skip' || field === 'email') continue;
      const value = String(r[header] ?? '').trim();
      if (field === 'firstName' || field === 'lastName' || field === 'company') lead[field] = value;
      else if (/^[A-Za-z][A-Za-z0-9_]*$/.test(field)) custom[field] = value;
    }
    lead.customFields = custom;
    rows.push(lead);
  });

  let skippedActive = 0;
  let toInsert = rows;
  if (body.skipInActiveCampaigns && rows.length) {
    const active = new Set<string>();
    for (let i = 0; i < rows.length; i += 5000) {
      const chunk = rows.slice(i, i + 5000).map((r) => r.email);
      const hits = await prisma.lead.findMany({
        where: { email: { in: chunk }, campaignLeads: { some: { state: 'active', campaign: { status: { in: ['active', 'paused'] } } } } },
        select: { email: true },
      });
      hits.forEach((h) => active.add(h.email));
    }
    toInsert = rows.filter((r) => !active.has(r.email));
    skippedActive = rows.length - toInsert.length;
  }

  let imported = 0;
  for (let i = 0; i < toInsert.length; i += 1000) {
    const res = await prisma.lead.createMany({ data: toInsert.slice(i, i + 1000), skipDuplicates: true });
    imported += res.count;
  }
  const alreadyInList = toInsert.length - imported;

  // Active campaigns using this list pick up the new leads immediately.
  const campaigns = await prisma.campaign.findMany({ where: { listId, status: { in: ['active', 'paused'] } }, select: { id: true } });
  for (const c of campaigns) await syncCampaignLeads(c.id, new Date());

  return {
    total: parsed.data.length,
    imported,
    duplicates: fileDuplicates + alreadyInList,
    skippedActive,
    invalidCount: invalid.length,
    invalid: invalid.filter((x) => x.reason).slice(0, 500),
  };
}

export async function leadRoutes(app: FastifyInstance) {
  app.get('/api/lists', async () => {
    const lists = await prisma.leadList.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { leads: true, campaigns: true } } } });
    return { lists: lists.map((l) => ({ id: l.id, name: l.name, leads: l._count.leads, campaigns: l._count.campaigns, createdAt: l.createdAt })) };
  });

  app.post('/api/lists', async (req) => {
    const b = z.object({ name: z.string().trim().min(1).max(200) }).parse(req.body);
    return prisma.leadList.create({ data: { name: b.name } });
  });

  app.post('/api/lists/preview-csv', async (req) => {
    const b = z.object({ csv: z.string().min(1) }).parse(req.body);
    const parsed = Papa.parse<Record<string, string>>(b.csv.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: 'greedy', preview: 6 });
    const headers = parsed.meta.fields ?? [];
    return { headers, sample: parsed.data.slice(0, 5), mapping: suggestMapping(headers) };
  });

  app.post('/api/lists/:id/import', async (req) => {
    const { id } = req.params as { id: string };
    const list = await prisma.leadList.findUnique({ where: { id } });
    if (!list) throw notFound('List not found');
    return importLeads(id, importSchema.parse(req.body));
  });

  app.get('/api/lists/:id/leads', async (req) => {
    const { id } = req.params as { id: string };
    const q = z.object({ q: z.string().optional(), status: z.string().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    const where: Prisma.LeadWhereInput = { listId: id };
    if (q.status) where.status = q.status as any;
    if (q.q) where.OR = [{ email: { contains: q.q, mode: 'insensitive' } }, { firstName: { contains: q.q, mode: 'insensitive' } }, { lastName: { contains: q.q, mode: 'insensitive' } }, { company: { contains: q.q, mode: 'insensitive' } }];
    const [total, leads] = await Promise.all([prisma.lead.count({ where }), prisma.lead.findMany({ where, orderBy: { createdAt: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize })]);
    return { total, page: q.page, pageSize: q.pageSize, leads };
  });

  app.get('/api/leads/:id', async (req) => {
    const { id } = req.params as { id: string };
    const lead = await prisma.lead.findUnique({ where: { id } });
    if (!lead) throw notFound('Lead not found');
    return lead;
  });

  /** Edit a lead's details (used by the Unibox "Edit lead" panel). The email stays fixed so reply matching keeps working. */
  app.patch('/api/leads/:id', async (req) => {
    const { id } = req.params as { id: string };
    const b = z
      .object({
        firstName: z.string().trim().max(200).optional(),
        lastName: z.string().trim().max(200).optional(),
        company: z.string().trim().max(300).optional(),
        customFields: z
          .record(z.string().max(5000))
          .refine((o) => Object.keys(o).length <= 100, 'At most 100 fields')
          .refine((o) => Object.keys(o).every((k) => /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(k)), 'Field names: letters, numbers and _ only, starting with a letter')
          .optional(),
      })
      .parse(req.body);
    const lead = await prisma.lead.findUnique({ where: { id } });
    if (!lead) throw notFound('Lead not found');
    const updated = await prisma.lead.update({ where: { id }, data: b });
    // keep the Unibox name in sync
    const name = `${updated.firstName} ${updated.lastName}`.trim();
    if (name) await prisma.thread.updateMany({ where: { leadId: id }, data: { leadName: name } });
    return updated;
  });

  app.post('/api/lists/:id/leads/delete', async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ ids: z.array(z.string()).max(10000).optional(), all: z.boolean().optional() }).parse(req.body);
    const where: Prisma.LeadWhereInput = { listId: id, campaignLeads: { none: { currentStep: { gt: 0 } } } };
    if (!b.all) where.id = { in: b.ids ?? [] };
    const r = await prisma.lead.deleteMany({ where });
    return { deleted: r.count };
  });

  app.get('/api/lists/:id/variables', async (req) => {
    const { id } = req.params as { id: string };
    const rows = await prisma.$queryRaw<{ key: string }[]>`SELECT DISTINCT jsonb_object_keys(custom_fields) AS key FROM leads WHERE list_id = ${id} LIMIT 200`;
    return { variables: [...BASE_FIELDS, ...rows.map((r) => r.key).filter((k) => !(BASE_FIELDS as readonly string[]).includes(k))] };
  });

  // ---- Suppression ----
  app.get('/api/suppression', async (req, reply) => {
    const q = z.object({ q: z.string().optional(), page: z.coerce.number().int().min(1).default(1), format: z.string().optional() }).parse(req.query);
    const where: Prisma.SuppressionWhereInput = q.q ? { value: { contains: q.q.toLowerCase() } } : {};
    if (q.format === 'csv') {
      const all = await prisma.suppression.findMany({ where, orderBy: { createdAt: 'desc' } });
      return sendCsv(reply, 'suppression.csv', `value,kind,reason,added\n${all.map((s) => `${s.value},${s.kind},${s.reason},${s.createdAt.toISOString()}`).join('\n')}`);
    }
    const [total, rows] = await Promise.all([prisma.suppression.count({ where }), prisma.suppression.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * 50, take: 50 })]);
    return { total, rows };
  });

  app.post('/api/suppression', async (req) => {
    const b = z.object({ text: z.string().min(1).max(2_000_000) }).parse(req.body);
    const values = [...new Set(b.text.split(/[\s,;]+/).map((v) => v.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))];
    const valid = values.filter((v) => (v.includes('@') ? isValidEmail(v) : /^[a-z0-9.-]+\.[a-z]{2,}$/.test(v)));
    for (const v of valid) await addSuppression(v, 'manual');
    // stop active sequences for these addresses / domains
    const emails = valid.filter((v) => v.includes('@'));
    const domains = valid.filter((v) => !v.includes('@'));
    await prisma.campaignLead.updateMany({
      where: { state: 'active', lead: { OR: [{ email: { in: emails } }, ...domains.map((d) => ({ email: { endsWith: `@${d}` } }))] } },
      data: { state: 'unsubscribed', nextDueAt: null, heldReason: 'Added to suppression list' },
    });
    return { added: valid.length, invalid: values.length - valid.length };
  });

  app.delete('/api/suppression/:id', async (req) => {
    const { id } = req.params as { id: string };
    await prisma.suppression.delete({ where: { id } }).catch(() => {
      throw notFound();
    });
    return { ok: true };
  });
}
