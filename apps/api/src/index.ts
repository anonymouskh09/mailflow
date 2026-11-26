import { env } from '@mailflow/core';
import { buildApp } from './app.js';
import { bootstrapAdmin } from './auth.js';

const e = env();
await bootstrapAdmin();
const app = await buildApp();
await app.listen({ port: e.PORT, host: '0.0.0.0' });
