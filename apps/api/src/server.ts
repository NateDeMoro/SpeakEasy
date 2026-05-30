import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AggregateInput } from '@quack/shared';
import { runAggregate } from './aggregate/runAggregate.js';

// Mounted under /api so Firebase Hosting can rewrite /api/** → this Cloud Run service.
const app = new Hono().basePath('/api');

// web (browser) → Cloud Run. Tighten origins before deploy.
app.use('/*', cors({ origin: '*' }));

app.get('/health', (c) => c.json({ ok: true }));

/** Stage 2 endpoint: returns the aggregate report. Stubbed until Gemini is wired. */
app.post('/aggregate', async (c) => {
  const input = (await c.req.json()) as AggregateInput;
  const report = await runAggregate(input);
  return c.json(report);
});

const port = Number(process.env['PORT'] ?? 8080);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`@quack/api listening on :${info.port}`);
});
