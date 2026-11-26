import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma, type EventType } from '@mailflow/db';
import { clickSig, markUnsubscribed, escapeHtml } from '@mailflow/core';
import { safeEqual } from '../auth.js';

// 1×1 transparent GIF
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// Link scanners and prefetchers that click everything right after delivery.
const BOT_UA = /(bot|crawler|spider|preview|scanner|barracuda|mimecast|proofpoint|safelinks|urldefense|linkcheck|python-requests|curl|wget|headlesschrome)/i;
const BOT_WINDOW_MS = 15_000;

async function record(token: string, type: EventType, req: FastifyRequest, url?: string) {
  const m = await prisma.message.findUnique({ where: { token }, select: { id: true, campaignId: true, leadId: true, accountId: true, stepId: true, sentAt: true, campaignLeadId: true } });
  if (!m || !m.sentAt) return null;
  const ua = String(req.headers['user-agent'] ?? '').slice(0, 500);
  if (type === 'click' && (Date.now() - m.sentAt.getTime() < BOT_WINDOW_MS || BOT_UA.test(ua))) return m;
  await prisma.event.create({ data: { messageId: m.id, campaignId: m.campaignId, leadId: m.leadId, accountId: m.accountId, stepId: m.stepId, type, url, ip: req.ip, userAgent: ua } });
  if (type === 'open' || type === 'click') {
    await prisma.campaignLead.updateMany({
      where: { id: m.campaignLeadId, OR: [{ lastActivity: null }, { lastActivity: { notIn: ['Replied', 'Bounced', 'Unsubscribed'] } }] },
      data: { lastActivity: type === 'open' ? 'Opened' : 'Clicked', lastActivityAt: new Date() },
    });
  }
  return m;
}

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>body{margin:0;background:#F7F7F8;font-family:Inter,system-ui,sans-serif;color:#18181B;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
.c{background:#fff;border:1px solid #E4E4E7;border-radius:12px;padding:28px;max-width:420px;width:100%}h1{font-size:20px;margin:0 0 8px}p{color:#52525B;font-size:14px;line-height:1.6;margin:0 0 16px}
button{height:40px;padding:0 16px;border-radius:8px;border:1px solid #4F46E5;background:#4F46E5;color:#fff;font:500 14px Inter,system-ui,sans-serif;cursor:pointer}</style></head><body><div class="c">${body}</div></body></html>`;
}

export async function trackingRoutes(app: FastifyInstance) {
  // One-click unsubscribe posts application/x-www-form-urlencoded.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });

  app.get('/o/:file', async (req, reply) => {
    const { file } = req.params as { file: string };
    const token = file.replace(/\.gif$/, '');
    try {
      await record(token, 'open', req);
    } catch (err) {
      req.log.warn({ err: (err as Error).message }, 'open tracking failed');
    }
    return reply
      .header('Content-Type', 'image/gif')
      .header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
      .header('Pragma', 'no-cache')
      .send(PIXEL);
  });

  app.get('/c/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const { u, s } = req.query as { u?: string; s?: string };
    if (!u || !/^https?:\/\//i.test(u) || !s || !safeEqual(s, clickSig(token, u))) {
      return reply.code(400).type('text/html').send(page('Link not valid', '<h1>This link is not valid</h1><p>It may have been copied incompletely.</p>'));
    }
    try {
      await record(token, 'click', req, u.slice(0, 2000));
    } catch (err) {
      req.log.warn({ err: (err as Error).message }, 'click tracking failed');
    }
    return reply.redirect(u, 302);
  });

  const unsubscribe = async (token: string, req: FastifyRequest) => {
    const m = await prisma.message.findUnique({ where: { token }, include: { lead: { select: { email: true } } } });
    if (!m) return null;
    const already = await prisma.event.findFirst({ where: { messageId: m.id, type: 'unsubscribe' } });
    if (!already) await record(token, 'unsubscribe', req);
    await markUnsubscribed(m.lead.email);
    return m.lead.email;
  };

  app.get('/u/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const m = await prisma.message.findUnique({ where: { token }, select: { id: true } });
    if (!m) return reply.code(404).type('text/html').send(page('Not found', '<h1>Link not found</h1><p>This unsubscribe link is not valid.</p>'));
    return reply
      .type('text/html')
      .send(page('Unsubscribe', `<h1>Unsubscribe</h1><p>Click the button and you will not receive any more emails from us.</p><form method="post"><button type="submit">Unsubscribe</button></form>`));
  });

  app.post('/u/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const email = await unsubscribe(token, req);
    if (!email) return reply.code(404).type('text/html').send(page('Not found', '<h1>Link not found</h1>'));
    // One-click (RFC 8058) clients only need a 2xx.
    return reply.type('text/html').send(page('Unsubscribed', `<h1>You're unsubscribed</h1><p>${escapeHtml(email)} will not receive further emails from us.</p>`));
  });
}
