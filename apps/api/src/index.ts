import { env } from '@mailflow/core';
import { buildApp } from './app.js';
import { bootstrapAdmin } from './auth.js';
import { seedLabels } from './routes/unibox.js';

const e = env();
await bootstrapAdmin();
await seedLabels();
const app = await buildApp();
await app.listen({ port: e.PORT, host: '0.0.0.0' });
