# UI designs

These are the approved screen designs, exported from the design canvas. Each file is one screen.
They use a small template format (`<x-dc>`, `<sc-for>`, `<sc-if>`, `{{holes}}` filled from the
`renderVals()` script at the bottom). Read them as visual reference: layout, spacing, colours,
copy, which buttons exist and which actions live in "⋯" menus. Rebuild them as React + Tailwind
components; do not copy the template syntax. All names, emails and numbers in them are sample data.

| File | Screen |
| --- | --- |
| `Main.dc.html` | Analytics (home) |
| `Accounts.dc.html` | Email accounts list (selection bar, row ⋯ menu open on one row) |
| `AddAccount.dc.html` | Add accounts modal (Google with keep-adding, Workspace domain, Outlook, any SMTP/IMAP, CSV) |
| `AccountDetail.dc.html` | Account detail: warmup score + settings, sending settings, connection |
| `Campaigns.dc.html` | Campaigns list with status tabs |
| `CampaignSequence.dc.html` | Campaign editor · Sequence tab |
| `CampaignOptions.dc.html` | Campaign editor · Settings tab (accounts, schedule, pacing, tracking & rules) |
| `CampaignDetail.dc.html` | Campaign detail: KPIs, by-step table, leads table |
| `Unibox.dc.html` | Unibox: conversation list, thread + reply box, lead panel |

Shared look: Inter font; ground #F7F7F8; white cards with 1px #E4E4E7 border and 12px radius;
text #18181B; muted #52525B; accent #4F46E5 (active nav #EEF2FF / #3730A3); 40px controls;
status pills (Active #DCFCE7/#166534, Paused #FEF3C7/#92400E, Error #FEE2E2/#991B1B,
Draft #EEF2FF/#3730A3, Completed #F4F4F5/#3F3F46).
