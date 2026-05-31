import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AggregateInput, ChannelSummary, Transcript } from '@quack/shared';
import { SCHEMA_VERSION } from '@quack/shared';
import { FieldValue } from 'firebase-admin/firestore';
import { runAggregate } from './aggregate/runAggregate.js';
import { transcribeWithFillers } from './stt/transcribe.js';
import { getFirestore } from './google/clients.js';
import { requireAuth, type AuthEnv } from './auth/requireAuth.js';

// Mounted under /api so Firebase Hosting can rewrite /api/** → this Cloud Run service.
const app = new Hono<AuthEnv>().basePath('/api');

// web (browser) → Cloud Run. In prod the browser hits the same origin (Hosting rewrites
// /api/** here), so CORS matters mainly for the Vite dev proxy and any direct Cloud Run hit.
// Allowlisted now that requests carry a Firebase ID token in the Authorization header.
app.use(
  '/*',
  cors({
    origin: [
      'https://uoo-quackathon26eug-8210.web.app',
      'https://uoo-quackathon26eug-8210.firebaseapp.com',
      'http://localhost:5173',
    ],
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
  }),
);

app.get('/health', (c) => c.json({ ok: true }));

/** Per-user session store: `users/{uid}/sessions/{sessionId}` — ownership is structural. */
const userSessions = (db: NonNullable<ReturnType<typeof getFirestore>>, uid: string) =>
  db.collection('users').doc(uid).collection('sessions');

/**
 * Stage 2 endpoint: returns the context-aware aggregate report and best-effort persists the
 * session to Firestore (`users/{uid}/sessions/{sessionId}`). Persistence failure logs but still
 * returns the report. We store the summaries — never the raw per-frame `series` — to stay under
 * the 1 MiB doc limit; comparison views only need summaries.
 */
app.post('/aggregate', requireAuth, async (c) => {
  const input = (await c.req.json()) as AggregateInput;
  const report = await runAggregate(input);

  const db = getFirestore();
  if (db) {
    const uid = c.get('uid');
    try {
      await userSessions(db, uid).doc(input.session.sessionId).set({
        sessionId: input.session.sessionId,
        uid,
        schemaVersion: SCHEMA_VERSION,
        durationMs: input.session.durationMs,
        capturedModalities: input.session.capturedModalities,
        channelSummaries: input.channelSummaries,
        transcript: input.transcript ?? null,
        // AggregateInput has no `context` field — reassemble the SpeechContext shape from its parts.
        context: { material: input.speechMaterial ?? null, settings: input.settings ?? null },
        report,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.error('[aggregate] Firestore persist failed (best-effort):', err);
    }
  }
  return c.json(report);
});

/** Recent rehearsals for the signed-in user, for cross-session comparison. */
app.get('/sessions', requireAuth, async (c) => {
  const db = getFirestore();
  if (!db) return c.json({ sessions: [] });
  const snap = await userSessions(db, c.get('uid'))
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get();
  const sessions = snap.docs.map((d) => {
    const v = d.data();
    // Stats-only summaries (drop timeline/events): the client computes the same delivery-category
    // verdicts as the report from these — keeps the thresholds in one place and the payload small.
    const channelSummaries = ((v['channelSummaries'] ?? []) as ChannelSummary[]).map((s) => ({
      descriptor: s.descriptor,
      stats: s.stats,
    }));
    return {
      sessionId: v['sessionId'],
      createdAt: v['createdAt']?.toMillis?.() ?? null,
      summary: v['report']?.summary ?? '',
      channelSummaries,
    };
  });
  return c.json({ sessions });
});

/** Full stored report + summaries for one of the signed-in user's prior rehearsals. */
app.get('/sessions/:id', requireAuth, async (c) => {
  const db = getFirestore();
  if (!db) return c.json({ error: 'persistence disabled' }, 503);
  // Ownership is enforced by the path: another user's id simply doesn't exist here → 404.
  const doc = await userSessions(db, c.get('uid')).doc(c.req.param('id')).get();
  if (!doc.exists) return c.json({ error: 'not found' }, 404);
  const v = doc.data()!;
  return c.json({ ...v, createdAt: v['createdAt']?.toMillis?.() ?? null });
});

/** Stage 1: transcribe a recorded rehearsal clip (raw audio body) → word-level Transcript. */
app.post('/transcribe', requireAuth, async (c) => {
  const body = new Uint8Array(await c.req.arrayBuffer());
  const contentType = c.req.header('content-type');
  console.log(`[transcribe] ${body.byteLength} bytes, content-type=${contentType}`);
  if (body.byteLength === 0) return c.json({ error: 'empty audio body' }, 400);
  try {
    const transcript: Transcript = await transcribeWithFillers(body, contentType);
    return c.json(transcript);
  } catch (err) {
    // Full error (auth/recognizer/encoding) goes to the API terminal; message back to the client.
    console.error('[transcribe] failed:', err);
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

const port = Number(process.env['PORT'] ?? 8080);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`@quack/api listening on :${info.port}`);
});
