export const PRESETS = {
  google: { smtpHost: 'smtp.gmail.com', smtpPort: 587, smtpSecure: false, imapHost: 'imap.gmail.com', imapPort: 993, imapSecure: true },
  outlook: { smtpHost: 'smtp.office365.com', smtpPort: 587, smtpSecure: false, imapHost: 'outlook.office365.com', imapPort: 993, imapSecure: true },
} as const;

export type PresetName = keyof typeof PRESETS;

export const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]{2,}$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export function emailDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase().trim() ?? '';
}
