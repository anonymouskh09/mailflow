// Template rendering: {{variables | fallback}}, {spin: a | b}, signature, unsubscribe, tracking.

export type Vars = Record<string, string | null | undefined>;

/** "First Name" -> "firstName", "company_name" -> "companyName" */
export function toVarName(header: string): string {
  const words = header
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (!words.length) return '';
  return words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
}

/** Resolve {spin: a | b | c} (also nested) picking one option per occurrence. */
export function spin(text: string, rnd: () => number = Math.random): string {
  let out = text;
  for (let guard = 0; guard < 50; guard++) {
    // innermost spin block first
    const re = /\{spin:\s*([^{}]*)\}/i;
    const m = re.exec(out);
    if (!m) break;
    const options = m[1].split('|').map((s) => s.trim());
    const pick = options[Math.floor(rnd() * options.length)] ?? '';
    out = out.slice(0, m.index) + pick + out.slice(m.index + m[0].length);
  }
  return out;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const VAR_RE = /\{\{\s*([A-Za-z0-9_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;

/** Names used in a template, with whether they have a fallback. */
export function extractVars(text: string): { name: string; hasFallback: boolean }[] {
  const out: { name: string; hasFallback: boolean }[] = [];
  for (const m of text.matchAll(VAR_RE)) out.push({ name: m[1], hasFallback: m[2] !== undefined });
  return out;
}

export interface SubstituteResult {
  text: string;
  missing: string[];
}

/**
 * Replace variables. `raw` names are inserted without escaping (signature, links).
 */
export function substitute(text: string, vars: Vars, opts: { html: boolean; raw?: string[] } = { html: false }): SubstituteResult {
  const missing: string[] = [];
  const lower = new Map(Object.entries(vars).map(([k, v]) => [k.toLowerCase(), v]));
  const result = text.replace(VAR_RE, (_all, name: string, fallback: string | undefined) => {
    const v = vars[name] ?? lower.get(name.toLowerCase());
    let value = v === null || v === undefined ? '' : String(v);
    if (!value.trim()) {
      if (fallback !== undefined) value = fallback;
      else missing.push(name);
    }
    const isRaw = opts.raw?.includes(name);
    return opts.html && !isRaw ? escapeHtml(value) : value;
  });
  return { text: result, missing: [...new Set(missing)] };
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<img[^>]*>/gi, '')
      .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
        const t = inner.replace(/<[^>]+>/g, '').trim();
        return t && t !== href ? `${t} (${href})` : href;
      })
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|h[1-6]|blockquote)>/gi, '\n\n')
      .replace(/<\/(div|li|tr)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Plain text (e.g. typed body or signature) to simple HTML. */
export function textToHtml(text: string): string {
  if (/<[a-z][\s\S]*>/i.test(text)) return text;
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function rewriteLinks(html: string, makeUrl: (url: string) => string, skip: (url: string) => boolean): string {
  return html.replace(/(<a\s[^>]*href=")([^"]+)(")/gi, (all, pre: string, url: string, post: string) => {
    const decoded = decodeEntities(url);
    if (!/^https?:\/\//i.test(decoded) || skip(decoded)) return all;
    return pre + escapeHtml(makeUrl(decoded)) + post;
  });
}

export interface RenderInput {
  subject: string;
  bodyHtml: string;
  lead: Vars;
  sender: { fromName: string; email: string; signatureHtml: string };
  unsubscribeUrl?: string;
  openPixelUrl?: string; // set when open tracking is on
  clickUrl?: (url: string) => string; // set when click tracking is on
  unsubscribeFooter?: boolean;
  plainText?: boolean;
  /** Append the sender's signature when the body does not place {{signature}} itself. */
  appendSignature?: boolean;
  rnd?: () => number;
}

export interface RenderOutput {
  subject: string;
  html: string | null;
  text: string;
  missing: string[];
}

export function renderEmail(input: RenderInput): RenderOutput {
  const rnd = input.rnd ?? Math.random;
  const vars: Vars = {
    ...input.lead,
    senderName: input.sender.fromName,
    senderEmail: input.sender.email,
    signature: input.sender.signatureHtml
      ? textToHtml(substitute(input.sender.signatureHtml, { senderName: input.sender.fromName, senderEmail: input.sender.email }, { html: false }).text)
      : '',
    unsubscribeLink: input.unsubscribeUrl ?? '',
  };
  const subj = substitute(spin(input.subject, rnd), vars, { html: false });
  let rawBody = spin(textToHtml(input.bodyHtml), rnd);
  if (input.appendSignature && input.sender.signatureHtml.trim() && !/\{\{\s*signature/i.test(rawBody)) rawBody += '<div>{{signature}}</div>';
  const usesUnsub = /\{\{\s*unsubscribeLink/i.test(rawBody);
  const body = substitute(rawBody, vars, { html: true, raw: ['signature', 'unsubscribeLink'] });
  const missing = [...new Set([...subj.missing, ...body.missing])].filter((m) => !['signature', 'unsubscribeLink'].includes(m));

  let html = body.text;
  if (input.unsubscribeFooter && input.unsubscribeUrl && !usesUnsub) {
    html += `<p style="font-size:12px;color:#71717a;margin-top:24px">If you'd rather not hear from me, <a href="${escapeHtml(input.unsubscribeUrl)}">unsubscribe here</a>.</p>`;
  }
  let text = htmlToText(html);

  if (input.plainText) return { subject: subj.text.trim(), html: null, text, missing };

  if (input.clickUrl) {
    const unsub = input.unsubscribeUrl;
    html = rewriteLinks(html, input.clickUrl, (u) => !!unsub && u === unsub);
  }
  if (input.openPixelUrl) {
    html += `<img src="${escapeHtml(input.openPixelUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">`;
  }
  text = text.trim();
  return { subject: subj.text.trim(), html: `<div>${html}</div>`, text, missing };
}

/** Lead object -> variable map used in templates. */
export function leadVars(lead: { email: string; firstName: string; lastName: string; company: string; customFields: unknown }): Vars {
  const custom = (lead.customFields && typeof lead.customFields === 'object' ? lead.customFields : {}) as Record<string, unknown>;
  const out: Vars = {};
  for (const [k, v] of Object.entries(custom)) out[k] = v === null || v === undefined ? '' : String(v);
  return { ...out, email: lead.email, firstName: lead.firstName, lastName: lead.lastName, company: lead.company };
}
