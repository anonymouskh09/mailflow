import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '@mailflow/core';
import { prisma } from '@mailflow/db';
import { log } from './log.js';
import { runHealthChecks } from './jobs/health.js';

const e = env();
const connection = new IORedis(e.REDIS_URL, { maxRetriesPerRequest: null });

/**
 * Repeatable jobs. BullMQ guarantees a given repeatable job runs on one worker at a time,
 * and each job does its own DB-level locking, so several worker processes are safe.
 */
const JOBS: { name: string; every: number; run: (job: Job) => Promise<unknown> }[] = [
  { name: 'health', every: 30 * 60_000, run: () => runHealthChecks() },
];

const queue = new Queue('mailflow', { connection });

async function main() {
  // Remove schedules from older versions, then (re)register.
  for (const r of await queue.getRepeatableJobs()) if (!JOBS.find((j) => j.name === r.name && j.every === Number(r.every))) await queue.removeRepeatableByKey(r.key);
  for (const j of JOBS) await queue.add(j.name, {}, { repeat: { every: j.every }, removeOnComplete: 100, removeOnFail: 200, jobId: j.name });

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
  log('info', 'worker started', { jobs: JOBS.map((j) => j.name) });

  const shutdown = async () => {
    log('info', 'worker stopping');
    await worker.close();
    await queue.close();
    await prisma.$disconnect();
    connection.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  log('error', 'worker crashed', { err: err.message });
  process.exit(1);
});
