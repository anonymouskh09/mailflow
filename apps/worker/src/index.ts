import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '@mailflow/core';
import { prisma } from '@mailflow/db';
import { log } from './log.js';
import { runHealthChecks } from './jobs/health.js';
import { rollupStats } from './jobs/rollup.js';
import { sendScheduledReplies } from './jobs/unibox.js';
import { tick } from './engine/sender.js';
import { syncAll } from './imap/sync.js';
import { IdleManager } from './imap/idle.js';
import { planWarmup } from './warmup/planner.js';
import { sendDueWarmups } from './warmup/sender.js';

const e = env();
const connection = new IORedis(e.REDIS_URL, { maxRetriesPerRequest: null });
const redis = new IORedis(e.REDIS_URL);

/**
 * Repeatable jobs. BullMQ runs each scheduled job on one worker at a time; the jobs also lock at the
 * database / Redis level, so several worker processes are safe.
 */
const JOBS: { name: string; every: number; run: (job: Job) => Promise<unknown> }[] = [
  {
    name: 'send',
    every: 30_000,
    run: async () => {
      const r = await tick();
      if (r.sent || r.failed) log('info', 'send tick', { ...r });
      const w = await sendDueWarmups();
      if (w) log('info', 'warmup sent', { sent: w });
      const u = await sendScheduledReplies();
      if (u) log('info', 'scheduled replies sent', { sent: u });
      return r;
    },
  },
  {
    name: 'imap',
    every: 120_000,
    run: async () => {
      const n = await syncAll(redis);
      if (n) log('info', 'imap sync', { processed: n });
      return n;
    },
  },
  { name: 'warmup-plan', every: 10 * 60_000, run: () => planWarmup() },
  { name: 'rollup', every: 2 * 60_000, run: () => rollupStats(2) },
  { name: 'health', every: 30 * 60_000, run: () => runHealthChecks() },
];

const queue = new Queue('mailflow', { connection });

async function main() {
  for (const r of await queue.getRepeatableJobs()) if (!JOBS.find((j) => j.name === r.name && j.every === Number(r.every))) await queue.removeRepeatableByKey(r.key);
  for (const j of JOBS) await queue.add(j.name, {}, { repeat: { every: j.every }, removeOnComplete: 100, removeOnFail: 200, jobId: j.name });
  // full roll-up once at start so history is complete after upgrades
  rollupStats(90).catch((err) => log('warn', 'initial rollup failed', { err: err.message }));

  const worker = new Worker(
    'mailflow',
    async (job) => {
      const def = JOBS.find((j) => j.name === job.name);
      if (!def) return;
      return def.run(job);
    },
    { connection, concurrency: JOBS.length },
  );
  worker.on('failed', (job, err) => log('error', 'job failed', { job: job?.name, err: err.message }));

  const idle = new IdleManager(redis);
  idle.start();
  log('info', 'worker started', { jobs: JOBS.map((j) => j.name) });

  const shutdown = async () => {
    log('info', 'worker stopping');
    await idle.stop();
    await worker.close();
    await queue.close();
    await prisma.$disconnect();
    connection.disconnect();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  log('error', 'worker crashed', { err: err.message });
  process.exit(1);
});
