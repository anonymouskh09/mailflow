// Built-in warmup content: neutral business-style emails, no links or images.
import { spin } from './render.js';

const SUBJECTS = [
  '{spin: Quick question|Short question|One quick thing} about {spin: next week|Thursday|the plan|our call}',
  '{spin: Following up|Checking in|Circling back} on {spin: the schedule|last week|our chat|the notes}',
  '{spin: Thanks|Thank you|Many thanks} for {spin: the update|your help|the notes|sending that over}',
  '{spin: Meeting|Call|Catch-up} {spin: time|slot|agenda} for {spin: Monday|Tuesday|Wednesday|Friday}',
  '{spin: Notes|Summary|Recap} from {spin: today|this morning|yesterday}',
  '{spin: Can we|Could we|Shall we} {spin: move|shift|reschedule} {spin: our call|the meeting|tomorrow}?',
  '{spin: Small update|Quick update|Update} on the {spin: project|timeline|proposal|draft}',
  '{spin: Lunch|Coffee|A quick chat} {spin: next week|this week|sometime soon}?',
];

const OPENERS = ['{spin: Hi|Hello|Hey} {name},', '{spin: Hi|Hello} {name}, hope {spin: you are well|your week is going well|all is good}.', '{name},', '{spin: Good morning|Morning|Hi there} {name},'];

const BODIES = [
  '{spin: I wanted to|Just wanted to|I thought I would} {spin: check|confirm|see} whether {spin: Thursday|Tuesday afternoon|next Monday} still {spin: works|suits you} for {spin: our call|the review|a quick catch-up}.',
  '{spin: Thanks again for|I appreciate} {spin: the notes|your thoughts|the quick reply}. {spin: I will|I am going to} {spin: go through them|review them|look at them properly} {spin: today|this afternoon|tomorrow morning} and {spin: get back to you|follow up}.',
  '{spin: Could you|Would you be able to} {spin: send me|share} the {spin: latest version|updated draft|final numbers} when you {spin: get a chance|have a minute}? {spin: No rush at all|There is no rush|Whenever suits}.',
  '{spin: Just a quick note|A short note} to say the {spin: plan|timeline|schedule} looks {spin: good|fine|great} on my side. {spin: Let me know|Tell me} if anything {spin: changes|comes up}.',
  '{spin: I have|I\'ve} {spin: put together|drafted|written up} a {spin: short summary|few notes|quick outline} from {spin: our last conversation|the meeting|yesterday}. {spin: Happy to|Glad to} {spin: go over it|walk you through it} {spin: whenever works|if useful}.',
  '{spin: Are you|Will you be} {spin: around|free|available} {spin: later this week|on Friday|next week} for {spin: ten minutes|a short call|a quick chat}? {spin: I would like to|I want to} {spin: run a couple of ideas past you|go over the next steps}.',
];

const CLOSERS = ['{spin: Thanks|Thank you|Cheers|Best|Kind regards|All the best},\n{sender}', '{spin: Speak soon|Talk soon|Best wishes},\n{sender}', '{spin: Thanks in advance|Much appreciated},\n{sender}'];

const REPLIES = [
  '{spin: Thanks|Thank you|Great}, {spin: that works for me|sounds good|all clear}. {spin: Speak soon|Talk then|See you then}.',
  '{spin: Got it|Received|Noted}, {spin: thanks for the update|thank you|appreciate it}. {spin: I will take a look|I\'ll review it} {spin: shortly|today|later on}.',
  '{spin: Yes|Sure|Absolutely}, {spin: that is fine|no problem|happy with that}. {spin: Let me know if you need anything else|Shout if anything changes}.',
  '{spin: Perfect|Lovely|Brilliant}, {spin: thanks|thank you} {name}. {spin: I have added it to my calendar|I will keep that slot free}.',
];

function pick<T>(arr: T[], rnd: () => number): T {
  return arr[Math.floor(rnd() * arr.length)];
}

function firstName(name: string, email: string): string {
  return (name.split(' ')[0] || email.split('@')[0]).replace(/[^\p{L}\p{N}'-]/gu, '') || 'there';
}

export function generateWarmup(opts: { toName: string; toEmail: string; fromName: string; code: string; rnd?: () => number }) {
  const rnd = opts.rnd ?? Math.random;
  const name = firstName(opts.toName, opts.toEmail);
  const sender = opts.fromName.split(' ')[0] || opts.fromName;
  const fill = (s: string) => spin(s, rnd).replace(/\{name\}/g, name).replace(/\{sender\}/g, sender);
  const subject = fill(pick(SUBJECTS, rnd));
  const paragraphs = [fill(pick(OPENERS, rnd)), fill(pick(BODIES, rnd))];
  if (rnd() < 0.5) paragraphs.push(fill(pick(BODIES, rnd)));
  paragraphs.push(fill(pick(CLOSERS, rnd)));
  const text = `${paragraphs.join('\n\n')}\n\nRef: ${opts.code}`;
  return { subject, text };
}

export function generateWarmupReply(opts: { toName: string; toEmail: string; fromName: string; code: string; rnd?: () => number }) {
  const rnd = opts.rnd ?? Math.random;
  const name = firstName(opts.toName, opts.toEmail);
  const sender = opts.fromName.split(' ')[0] || opts.fromName;
  const body = spin(pick(REPLIES, rnd), rnd).replace(/\{name\}/g, name);
  return { text: `${body}\n\n${sender}\n\nRef: ${opts.code}` };
}
