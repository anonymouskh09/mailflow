#!/usr/bin/env python3
"""Local testing helper: act as a lead on the GreenMail test server (no dependencies).

  python3 scripts/dev/lead.py list  james@lead.test            # show the lead's inbox
  python3 scripts/dev/lead.py reply james@lead.test "Quick"     # reply to the newest email whose subject contains "Quick"
          "Thursday works, send the deck"                         #   (in the same thread: In-Reply-To / References)
  python3 scripts/dev/lead.py ooo   james@lead.test "Quick"     # send an out-of-office auto-reply

Env: IMAP_HOST/IMAP_PORT (default 127.0.0.1:3143), SMTP_HOST/SMTP_PORT (127.0.0.1:3025), LEAD_PASSWORD (default "pass").
"""
import email, imaplib, os, smtplib, sys
from email.message import EmailMessage
from email.utils import make_msgid, parseaddr

IMAP = (os.environ.get('IMAP_HOST', '127.0.0.1'), int(os.environ.get('IMAP_PORT', 3143)))
SMTP = (os.environ.get('SMTP_HOST', '127.0.0.1'), int(os.environ.get('SMTP_PORT', 3025)))
PASSWORD = os.environ.get('LEAD_PASSWORD', 'pass')

def inbox(user):
    m = imaplib.IMAP4(*IMAP); m.login(user, PASSWORD); m.select('INBOX')
    _, ids = m.search(None, 'ALL'); out = []
    for i in ids[0].split():
        _, d = m.fetch(i, '(RFC822)'); out.append(email.message_from_bytes(d[0][1]))
    m.logout(); return out

def reply(user, match, text, auto=False):
    found = [m for m in inbox(user) if match.lower() in (m['Subject'] or '').lower()]
    if not found: sys.exit(f'no email with "{match}" in the subject')
    orig = found[-1]
    r = EmailMessage(); r['From'] = user; r['To'] = parseaddr(orig['From'])[1]
    r['Subject'] = ('Automatic reply: ' if auto else 'Re: ') + orig['Subject']
    r['In-Reply-To'] = orig['Message-ID']; r['References'] = orig['Message-ID']
    r['Message-ID'] = make_msgid(domain=user.split('@')[1])
    if auto: r['Auto-Submitted'] = 'auto-replied'
    r.set_content(text)
    s = smtplib.SMTP(*SMTP); s.send_message(r); s.quit()
    print('sent', r['Subject'], 'to', r['To'])

if __name__ == '__main__':
    if len(sys.argv) < 3: sys.exit(__doc__)
    cmd, user = sys.argv[1], sys.argv[2]
    if cmd == 'list':
        for msg in inbox(user): print(f"{msg['Date']} | {msg['From']} | {msg['Subject']}")
    elif cmd == 'reply': reply(user, sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else 'Sounds good, tell me more.')
    elif cmd == 'ooo': reply(user, sys.argv[3], 'I am out of the office until Monday with limited access to email.', auto=True)
    else: sys.exit(__doc__)
