import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@mailflow/db';
import { clickSig } from '@mailflow/core';
import { buildApp } from './app.js';
import { resetRateLimit, clearHashCache } from './auth.js';
import { resetDb, makeAccount, makeCampaign } from '../../worker/src/test/factory.js';

let app: FastifyInstance;
let cookie = '';

beforeAll(async () => {
  app = await buildApp({ logger: false });
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb();
  await prisma.settings.update({ where: { id: 1 }, data: { passwordHash: await bcrypt.hash('correct horse', 4) } });
  resetRateLimit('127.0.0.1');
  clearHashCache();
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@test.dev', password: 'correct horse' } });
  cookie = String(res.headers['set-cookie']).split(';')[0];
});

const authed = (opts: any) => app.inject({ ...opts, headers: { ...(opts.headers ?? {}), cookie } });

async function sentMessage() {
  const a = await makeAccount();
  const { campaign, leads } = await makeCampaign({ accounts: [a.id], leads: ['lead@acme.com'] });
  const cl = await prisma.campaignLead.findFirstOrThrow({ where: { campaignId: campaign.id } });
  const step = await prisma.sequenceStep.findFirstOrThrow({ where: { campaignId: campaign.id } });
  const m = await prisma.message.create({
    data: { campaignId: campaign.id, leadId: leads[0].id, stepId: step.id, campaignLeadId: cl.id, accountId: a.id, stepPosition: 1, token: 'tok123', status: 'sent', sentAt: new Date(Date.now() - 60_000), messageId: '<m@x>', toEmail: 'lead@acme.com' },
  });
  return { m, campaign, cl };
}

describe('auth', () => {
  it('rejects wrong passwords, sets an HttpOnly cookie, protects the API', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@test.dev', password: 'nope' } });
    expect(bad.statusCode).toBe(401);
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@test.dev', password: 'correct horse' } });
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly/i);
    expect(String(res.headers['set-cookie'])).toMatch(/SameSite=Lax/i);
    expect((await app.inject({ url: '/api/accounts' })).statusCode).toBe(401);
    expect((await authed({ url: '/api/accounts' })).statusCode).toBe(200);
  });

  it('rate-limits login attempts', async () => {
    resetRateLimit('127.0.0.1');
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@test.dev', password: 'x' } })).statusCode;
    expect(last).toBe(429);
  });

  it('never returns secrets', async () => {
    await makeAccount();
    const res = await authed({ url: '/api/accounts' });
    expect(res.body).not.toMatch(/password_?enc|passwordEnc|refresh/i);
  });

  it('validates bodies with clear errors', async () => {
    const res = await authed({ method: 'POST', url: '/api/campaigns', payload: { name: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/name/);
  });
});

describe('tracking', () => {
  it('records opens and serves a gif', async () => {
    const { m } = await sentMessage();
    const res = await app.inject({ url: '/o/tok123.gif', headers: { 'user-agent': 'Mozilla/5.0' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/gif');
    expect(await prisma.event.count({ where: { messageId: m.id, type: 'open' } })).toBe(1);
  });

  it('redirects signed clicks only and filters bots', async () => {
    const { m } = await sentMessage();
    const url = 'https://acme.com/pricing';
    const ok = await app.inject({ url: `/c/tok123?u=${encodeURIComponent(url)}&s=${clickSig('tok123', url)}`, headers: { 'user-agent': 'Mozilla/5.0' } });
    expect(ok.statusCode).toBe(302);
    expect(ok.headers.location).toBe(url);
    const forged = await app.inject({ url: `/c/tok123?u=${encodeURIComponent('https://evil.com')}&s=${clickSig('tok123', url)}` });
    expect(forged.statusCode).toBe(400);
    await app.inject({ url: `/c/tok123?u=${encodeURIComponent(url)}&s=${clickSig('tok123', url)}`, headers: { 'user-agent': 'Barracuda link scanner' } });
    expect(await prisma.event.count({ where: { messageId: m.id, type: 'click' } })).toBe(1);
  });

  it('unsubscribe page needs a click; one-click POST unsubscribes and suppresses', async () => {
    const { cl } = await sentMessage();
    const page = await app.inject({ url: '/u/tok123' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<form method="post">');
    expect(await prisma.suppression.count()).toBe(0);
    const res = await app.inject({ method: 'POST', url: '/u/tok123', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'List-Unsubscribe=One-Click' });
    expect(res.statusCode).toBe(200);
    expect(await prisma.suppression.findUnique({ where: { value: 'lead@acme.com' } })).toBeTruthy();
    expect((await prisma.campaignLead.findUniqueOrThrow({ where: { id: cl.id } })).state).toBe('unsubscribed');
    expect(await prisma.event.count({ where: { type: 'unsubscribe' } })).toBe(1);
  });
});

describe('leads and campaigns', () => {
  it('imports leads with mapping, dedupes and reports invalid rows', async () => {
    const list = await prisma.leadList.create({ data: { name: 'L' } });
    const csv = 'E-mail,First Name,Industry\na@x.com,Ann,SaaS\nbad,Bob,X\nA@X.com,Dup,Y\nc@y.com,,Legal\n';
    const res = await authed({ method: 'POST', url: `/api/lists/${list.id}/import`, payload: { csv, mapping: { 'E-mail': 'email', 'First Name': 'firstName', Industry: 'industry' } } });
    expect(res.json()).toMatchObject({ total: 4, imported: 2, duplicates: 1, invalidCount: 1 });
    const lead = await prisma.lead.findFirstOrThrow({ where: { email: 'a@x.com' } });
    expect(lead.customFields).toEqual({ industry: 'SaaS' });
    const preview = await authed({ method: 'POST', url: '/api/lists/preview-csv', payload: { csv } });
    expect(preview.json().mapping).toEqual({ 'E-mail': 'email', 'First Name': 'firstName', Industry: 'industry' });
  });

  it('refuses to launch an incomplete campaign and explains why', async () => {
    const created = (await authed({ method: 'POST', url: '/api/campaigns', payload: { name: 'Test' } })).json();
    const res = await authed({ method: 'POST', url: `/api/campaigns/${created.id}/launch`, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/sending account/);
    expect(res.json().error).toMatch(/subject/);
    expect(res.json().error).toMatch(/leads/);
  });

  it('launches a complete campaign and creates campaign leads', async () => {
    const a = await makeAccount();
    const created = (await authed({ method: 'POST', url: '/api/campaigns', payload: { name: 'Test' } })).json();
    const c = await prisma.campaign.findUniqueOrThrow({ where: { id: created.id } });
    await prisma.lead.createMany({ data: [{ listId: c.listId!, email: 'a@x.com' }, { listId: c.listId!, email: 'b@x.com' }] });
    await authed({ method: 'PUT', url: `/api/campaigns/${c.id}/accounts`, payload: { accountIds: [a.id] } });
    const steps = (await authed({ method: 'GET', url: `/api/campaigns/${c.id}` })).json().steps;
    await authed({ method: 'PUT', url: `/api/campaigns/${c.id}/steps`, payload: { steps: [{ id: steps[0].id, delayDays: 0, subject: 'Hi {{firstName | there}}', bodyHtml: '<p>Hello</p>' }, { delayDays: 2, subject: '', bodyHtml: '<p>Bump</p>' }] } });
    const res = await authed({ method: 'POST', url: `/api/campaigns/${c.id}/launch`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('active');
    expect(await prisma.campaignLead.count({ where: { campaignId: c.id } })).toBe(2);
    // after launch, steps can be edited but not removed
    const now = (await authed({ url: `/api/campaigns/${c.id}` })).json().steps;
    const del = await authed({ method: 'PUT', url: `/api/campaigns/${c.id}/steps`, payload: { steps: [{ id: now[0].id, delayDays: 0, subject: 'x', bodyHtml: 'y' }] } });
    expect(del.statusCode).toBe(400);
  });

  it('previews a step for a lead with missing-variable counts', async () => {
    const a = await makeAccount({ signatureHtml: '{{senderName}}' });
    const { campaign, leads } = await makeCampaign({ accounts: [a.id], leads: ['a@x.com', 'b@x.com'], steps: [{ subject: 'Hi {{firstName}}', body: 'From {{city}} {{signature}}' }] });
    const res = await authed({ method: 'POST', url: `/api/campaigns/${campaign.id}/preview`, payload: { position: 1, leadId: leads[0].id } });
    const body = res.json();
    expect(body.subject).toBe('Hi First1');
    expect(body.html).toContain(a.fromName);
    expect(body.missingCounts).toEqual({ city: 2 });
  });
});
