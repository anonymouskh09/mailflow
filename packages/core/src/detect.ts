// Classify incoming mail: auto-replies, bounces, warmup.

export interface HeaderBag {
  get(name: string): unknown;
}

function h(headers: HeaderBag | Map<string, unknown>, name: string): string {
  const v = headers.get(name.toLowerCase());
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v && 'text' in (v as any)) return String((v as any).text);
  if (typeof v === 'object' && v && 'value' in (v as any)) return String((v as any).value);
  return String(v);
}

const OOO_PHRASES = [
  /out of (the )?office/i,
  /\bauto(matic)?[- ]?reply\b/i,
  /\bautoreply\b/i,
  /\bon (annual |parental |maternity |paternity )?leave\b/i,
  /\bon vacation\b/i,
  /\bon holiday\b/i,
  /\baway from (the |my )?(office|desk|email)\b/i,
  /\blimited access to (my )?e-?mail\b/i,
  /\bi am currently (out|away|travell?ing)\b/i,
  /\bi('m| am) (out|away) until\b/i,
  /\bwill (be )?(back|return) on\b/i,
  /\babwesenheitsnotiz\b/i,
  /\bthank you for your (e-?mail|message)[.,!]? (this is an automated|i will)/i,
];

export function isAutoReply(headers: HeaderBag | Map<string, unknown>, subject: string, text: string): boolean {
  const auto = h(headers, 'auto-submitted').toLowerCase();
  if (auto && auto !== 'no') return true;
  if (h(headers, 'x-autoreply') || h(headers, 'x-autorespond') || h(headers, 'x-auto-response-suppress').match(/all|oof/i)) return true;
  const prec = h(headers, 'precedence').toLowerCase();
  if (prec === 'auto_reply') return true;
  if (/^(auto(matic)?[ -]?reply|out of (the )?office|automatische antwort|réponse automatique|respuesta automática)/i.test(subject.trim())) return true;
  const sample = `${subject}\n${text.slice(0, 1500)}`;
  return OOO_PHRASES.some((re) => re.test(sample));
}

export function isBounceSender(from: string, subject: string): boolean {
  return (
    /mailer-daemon|postmaster|mail delivery (subsystem|system)/i.test(from) ||
    /^(undeliverable|undelivered mail|delivery status notification \(failure\)|mail delivery failed|returned mail|failure notice|delivery failure|message not delivered)/i.test(
      subject.trim(),
    )
  );
}

/** Extract the original Message-ID and failed recipient from a DSN / bounce body. */
export function parseBounce(raw: string): { originalMessageId: string | null; recipient: string | null; permanent: boolean } {
  const mid = /^(?:original-)?message-id:\s*(<[^>\s]+>)/im.exec(raw)?.[1] ?? null;
  const recipient =
    /^final-recipient:\s*rfc822;\s*<?([^\s>]+@[^\s>]+)>?/im.exec(raw)?.[1] ??
    /^original-recipient:\s*rfc822;\s*<?([^\s>]+@[^\s>]+)>?/im.exec(raw)?.[1] ??
    /(?:to|recipient|address)[^\n]{0,40}?<?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})>?[^\n]{0,60}(?:failed|rejected|does not exist|not found|unknown)/i.exec(raw)?.[1] ??
    null;
  const status = /^status:\s*(\d)\.\d+\.\d+/im.exec(raw)?.[1];
  const permanent = status ? status === '5' : !/(temporar|deferred|delayed|will retry|4\.\d\.\d)/i.test(raw);
  return { originalMessageId: mid, recipient: recipient?.toLowerCase() ?? null, permanent };
}

export const WARMUP_HEADER = 'X-MF-Warmup';

/** Warmup code embedded in header and body: "mf-xxxxxxxx". */
export function findWarmupCode(headers: HeaderBag | Map<string, unknown>, text: string): string | null {
  const hv = h(headers, WARMUP_HEADER.toLowerCase()).trim();
  if (hv) return hv;
  return /\b(mfw-[a-z0-9]{8,})\b/i.exec(text)?.[1] ?? null;
}

/** Strip quoted history from a reply for snippets. */
export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .+wrote:\s*$/i.test(line.trim()) || /^-{2,}\s*Original Message/i.test(line.trim()) || /^From:\s.+/i.test(line.trim())) break;
    if (line.trim().startsWith('>')) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}
