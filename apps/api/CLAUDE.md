# @quack/api

Cloud Run service. Proxies Gemini + Speech-to-Text and persists sessions to Firestore.
Scaffold only in Stage 0 (health check + stubbed `/aggregate`); built out in Stage 2.

## Edit rules
- ALL Google credentials/keys live here, never in the web app. Prefer Cloud Run's runtime
  service account (Application Default Credentials) over inline API keys.
- Implement the report against the `AggregateFn` contract in `@quack/shared` — don't redefine it.
- `@quack/shared` is bundled into `dist` by tsup (it is TS source, not a published package).

## Files
| Path | Description | Open when... |
|------|-------------|--------------|
| src/server.ts | Hono server, CORS, /health, /aggregate | adding routes |
| src/aggregate/runAggregate.ts | AggregateFn impl (stub → Gemini in Stage 2) | building the report |
| src/google/clients.ts | Gemini / STT / Firestore clients (stub) | wiring Google SDKs |
| Dockerfile | Cloud Run container (build from repo root) | deploying |

## Run
- Dev: `pnpm --filter @quack/api dev` (tsx, port 8080).
- Build: `pnpm --filter @quack/api build` → self-contained `dist/server.js`.
