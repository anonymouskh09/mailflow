import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from './crypto.js';
import { spin, substitute, toVarName, renderEmail, htmlToText, extractVars } from './render.js';
import { isWithinSchedule, nextOpenTime, zonedToUtc, dayKey, dayBounds } from './time.js';
import { isAutoReply, parseBounce, isBounceSender, findWarmupCode, stripQuoted } from './detect.js';
import { classifySendError } from './mail/transport.js';
import { warmupTarget } from './warmup.js';
import { generateWarmup } from './warmupContent.js';

describe('crypto', () => {
  it('round-trips and uses a random IV', () => {
    const a = encrypt('s3cret');
    const b = encrypt('s3cret');
    expect(a).not.toBe(b);
    expect(a).not.toContain('s3cret');
    expect(decrypt(a)).toBe('s3cret');
  });
  it('rejects tampered ciphertext', () => {
    const a = encrypt('hello');
    const parts = a.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decrypt(parts.join(':'))).toThrow();
  });
});

describe('variables and spintax', () => {
  it('camelCases headers', () => {
    expect(toVarName('First Name')).toBe('firstName');
    expect(toVarName('company_name')).toBe('companyName');
    expect(toVarName('  City ')).toBe('city');
    expect(toVarName('LinkedIn URL')).toBe('linkedInUrl');
  });
  it('substitutes with fallbacks and reports missing', () => {
    const r = substitute('Hi {{firstName | there}}, {{company}} / {{ city }}', { firstName: '', company: 'Acme', city: '' }, { html: false });
    expect(r.text).toBe('Hi there, Acme / ');
    expect(r.missing).toEqual(['city']);
  });
  it('escapes values in html but not raw names', () => {
    const r = substitute('{{a}} {{signature}}', { a: '<b>', signature: '<i>sig</i>' }, { html: true, raw: ['signature'] });
    expect(r.text).toBe('&lt;b&gt; <i>sig</i>');
  });
  it('spins options, nested too', () => {
    const seq = [0, 0.99];
    let i = 0;
    const rnd = () => seq[i++ % seq.length];
    expect(spin('{spin: Hi | Hello | Hey} there', () => 0)).toBe('Hi there');
    expect(spin('{spin: Hi | Hello | Hey} there', () => 0.99)).toBe('Hey there');
    expect(spin('{spin: a {spin: b|c} | d}', rnd)).toMatch(/^(a b|a c|d)$/);
  });
  it('extracts variables', () => {
    expect(extractVars('{{a}} {{b | x}}')).toEqual([
      { name: 'a', hasFallback: false },
      { name: 'b', hasFallback: true },
    ]);
  });
});

describe('renderEmail', () => {
  const base = {
    subject: 'Quick question, {{firstName}}',
    bodyHtml: '<p>Hi {{firstName | there}},</p><p>Visit <a href="https://acme.com/x?a=1&amp;b=2">our site</a>.</p><p>{{signature}}</p>',
    lead: { firstName: 'James', email: 'j@x.com' },
    sender: { fromName: 'Ali Khan', email: 'ali@g.co', signatureHtml: '{{senderName}}\nGrowth Lead' },
  };
  it('renders vars, signature, footer, pixel and click links', () => {
    const out = renderEmail({
      ...base,
      unsubscribeUrl: 'https://t.x/u/tok',
      openPixelUrl: 'https://t.x/o/tok.gif',
      clickUrl: (u) => `https://t.x/c/tok?u=${encodeURIComponent(u)}`,
      unsubscribeFooter: true,
    });
    expect(out.subject).toBe('Quick question, James');
    expect(out.html).toContain('Hi James');
    expect(out.html).toContain('Ali Khan<br>Growth Lead');
    expect(out.html).toContain('https://t.x/c/tok?u=https%3A%2F%2Facme.com%2Fx%3Fa%3D1%26b%3D2');
    expect(out.html).toContain('href="https://t.x/u/tok"'); // unsubscribe link not rewritten
    expect(out.html).toContain('https://t.x/o/tok.gif');
    expect(out.text).toContain('unsubscribe here (https://t.x/u/tok)');
    expect(out.text).not.toContain('<');
    expect(out.missing).toEqual([]);
  });
  it('plain-text mode has no html and no pixel', () => {
    const out = renderEmail({ ...base, plainText: true, openPixelUrl: 'https://t.x/o/tok.gif' });
    expect(out.html).toBeNull();
    expect(out.text).toContain('our site (https://acme.com/x?a=1&b=2)');
  });
  it('reports missing variables without fallback', () => {
    const out = renderEmail({ ...base, subject: '{{company}} idea', lead: { email: 'x@y.z' } });
    expect(out.missing).toContain('company');
    expect(out.missing).not.toContain('firstName'); // body uses a fallback
  });
  it('htmlToText keeps paragraphs', () => {
    expect(htmlToText('<p>a</p><p>b<br>c</p>')).toBe('a\n\nb\nc');
  });
});

describe('schedule', () => {
  const s = { timezone: 'Europe/London', days: [1, 2, 3, 4, 5], windowStart: '09:00', windowEnd: '17:00' };
  it('converts wall time across DST', () => {
    expect(zonedToUtc(2026, 7, 1, 9, 0, 'Europe/London').toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(zonedToUtc(2026, 1, 15, 9, 0, 'Europe/London').toISOString()).toBe('2026-01-15T09:00:00.000Z');
    expect(zonedToUtc(2026, 1, 15, 9, 0, 'Asia/Tashkent').toISOString()).toBe('2026-01-15T04:00:00.000Z');
  });
  it('detects window', () => {
    expect(isWithinSchedule(new Date('2026-11-25T10:00:00Z'), s)).toBe(true); // Wed 10:00
    expect(isWithinSchedule(new Date('2026-11-25T17:00:00Z'), s)).toBe(false); // 17:00 exclusive
    expect(isWithinSchedule(new Date('2026-11-28T10:00:00Z'), s)).toBe(false); // Saturday
  });
  it('finds next open time', () => {
    expect(nextOpenTime(new Date('2026-11-27T18:00:00Z'), s)!.toISOString()).toBe('2026-11-30T09:00:00.000Z'); // Fri evening -> Mon
    expect(nextOpenTime(new Date('2026-11-25T06:00:00Z'), s)!.toISOString()).toBe('2026-11-25T09:00:00.000Z');
    const inside = new Date('2026-11-25T12:34:00Z');
    expect(nextOpenTime(inside, s)).toBe(inside);
    expect(nextOpenTime(inside, { ...s, days: [] })).toBeNull();
  });
  it('day keys and bounds respect the timezone', () => {
    expect(dayKey(new Date('2026-11-25T22:30:00Z'), 'Asia/Tashkent')).toBe('2026-11-26');
    const b = dayBounds(new Date('2026-11-25T22:30:00Z'), 'Asia/Tashkent');
    expect(b.start.toISOString()).toBe('2026-11-25T19:00:00.000Z');
    expect(b.end.toISOString()).toBe('2026-11-26T19:00:00.000Z');
  });
});

describe('detection', () => {
  const H = (o: Record<string, string>) => new Map(Object.entries(o));
  it('flags auto replies by header and phrase', () => {
    expect(isAutoReply(H({ 'auto-submitted': 'auto-replied' }), 'Re: hi', '')).toBe(true);
    expect(isAutoReply(H({ 'auto-submitted': 'no' }), 'Re: hi', 'Sounds great')).toBe(false);
    expect(isAutoReply(H({}), 'Out of Office: Re: hi', '')).toBe(true);
    expect(isAutoReply(H({}), 'Re: hi', 'I am out of the office until 2 December')).toBe(true);
    expect(isAutoReply(H({}), 'Re: hi', 'Yes, Thursday works. Send the deck.')).toBe(false);
  });
  it('parses DSN bounces', () => {
    const raw = 'Final-Recipient: rfc822; nobody@example.com\nStatus: 5.1.1\n\nMessage-ID: <abc@x.com>';
    expect(parseBounce(raw)).toEqual({ originalMessageId: '<abc@x.com>', recipient: 'nobody@example.com', permanent: true });
    expect(isBounceSender('MAILER-DAEMON@x.com', 'Undelivered Mail Returned to Sender')).toBe(true);
    expect(isBounceSender('james@x.com', 'Re: hi')).toBe(false);
  });
  it('finds warmup codes', () => {
    expect(findWarmupCode(H({ 'x-mf-warmup': 'mfw-abc12345' }), '')).toBe('mfw-abc12345');
    expect(findWarmupCode(H({}), 'Thanks\n\nRef: mfw-zz99aa88bb')).toBe('mfw-zz99aa88bb');
    expect(findWarmupCode(H({}), 'no code')).toBeNull();
  });
  it('strips quoted text', () => {
    expect(stripQuoted('Sounds good\n\nOn Mon, Ali wrote:\n> hi')).toBe('Sounds good');
  });
  it('classifies send errors', () => {
    expect(classifySendError({ responseCode: 550, response: '550 5.1.1 user unknown' })).toBe('hard_bounce');
    expect(classifySendError({ responseCode: 451, response: '451 try later' })).toBe('temporary');
    expect(classifySendError({ code: 'ETIMEDOUT' })).toBe('temporary');
    expect(classifySendError({ code: 'EAUTH', responseCode: 535 })).toBe('auth');
    expect(classifySendError({ responseCode: 550, response: '550 5.4.5 Daily user sending quota exceeded' })).toBe('rate_limit');
    expect(classifySendError({ responseCode: 421, response: '421 4.7.0 Too many messages, rate limit' })).toBe('rate_limit');
  });
});

describe('warmup plan', () => {
  const w = { startVolume: 3, increasePerDay: 2, maxVolume: 40, workingDays: [0, 1, 2, 3, 4, 5, 6], weekendFactor: 50 };
  it('ramps up to the max and reduces weekends', () => {
    expect(warmupTarget(w, 0, 1)).toBe(3);
    expect(warmupTarget(w, 5, 1)).toBe(13);
    expect(warmupTarget(w, 100, 1)).toBe(40);
    expect(warmupTarget(w, 5, 6)).toBe(7);
    expect(warmupTarget({ ...w, workingDays: [1, 2, 3, 4, 5] }, 5, 0)).toBe(0);
  });
  it('generates content without links and with the code', () => {
    const g = generateWarmup({ toName: 'Sara Ahmed', toEmail: 's@x.co', fromName: 'Ali Khan', code: 'mfw-abcdefgh' });
    expect(g.subject.length).toBeGreaterThan(5);
    expect(g.subject).not.toMatch(/[{}]/);
    expect(g.text).toContain('Sara');
    expect(g.text).toContain('mfw-abcdefgh');
    expect(g.text).not.toMatch(/https?:|[{}]/);
  });
});
