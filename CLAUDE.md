# QuackHacksWildcats

Hackathon project: a browser-based real-time speech practice coach. See
[docs/ProjectPlan.md](docs/ProjectPlan.md) for the product brief and staged plan.

## Competition: Google Track
We are competing in the **Google Track**. Judging is on best use of Google's
technologies/tools plus creativity, technical execution, practicality, and
ambitious problem-solving. Goal: use *most* of the Google ecosystem (not every
single one). Prefer Google products over equivalents when designing features.

Track-named technologies (prioritize these):
- **Google Cloud** — hosting, compute, storage, BigQuery, etc.
- **Gemini APIs** — LLM/multimodal features
- **Firebase** — auth, Firestore, hosting, functions (MCP tools available)
- **AI Studio** — prompt/model prototyping for Gemini
- **Agent Platform** — agent/orchestration tooling

Also available via MCP this session: Gmail, Google Calendar, Google Drive,
Firebase. Reach for these to integrate Google products where they fit.

## Working rules
- Read this CLAUDE.md at the start of every prompt before doing anything.
- Keep this CLAUDE.md current: whenever you change the project's structure, conventions, or workflow, update this file in the same turn to reflect it.
- When a prompt scopes work to a specific folder or file(s), edit only those files. Don't touch anything outside that scope without asking.
- Component-level CLAUDE.md files scope what can be edited within their folder. Respect them.
- Add any major problems encountered to `docs/Problems.md`. Record time encountered, stage, and component scope.

## Architecture
pnpm monorepo, TypeScript throughout. Frontend React+Vite; backend Google Cloud Run +
Firestore (Gemini + Speech-to-Text proxied server-side — keys never reach the client).
The signal schema is modality-agnostic so the Stage 4 video layer slots in as added channels.

Auth: Firebase native Google sign-in. The web does Firebase Auth client-side (its public web
config in `apps/web/src/firebase.ts` is not a secret) and sends the ID token on every `/api`
call via `authedFetch`; the API verifies it with firebase-admin and attributes data to the uid.
History is stored per user at `users/{uid}/sessions/{sessionId}` (ownership is path-based — no
composite index needed). The whole app is gated behind sign-in. `AUTH_MOCK=1` bypasses token
verification for offline dev (injects `AUTH_MOCK_UID`).

Commands: `pnpm install`; `pnpm dev` (web); `pnpm -r typecheck`; `pnpm -r build`;
`pnpm --filter @quack/api dev` (API on :8080).

## Deploy (project `uoo-quackathon26eug-8210`, region us-central1)
Web → Firebase Hosting (https://uoo-quackathon26eug-8210.web.app); API → Cloud Run
(`quack-api`). Hosting rewrites `/api/**` → Cloud Run, so the browser hits one origin.
The Hono app is mounted at `/api` (`basePath`); the Vite dev proxy mirrors this.
- API: `gcloud builds submit --config cloudbuild.yaml .` then
  `gcloud run deploy quack-api --image gcr.io/$PROJECT/quack-api:latest --region us-central1 --allow-unauthenticated --port 8080`
- Web: `pnpm -r build` then `firebase deploy --only hosting`
- Firestore rules/indexes: `firebase deploy --only firestore:rules,firestore:indexes`
- Auth setup (console, one-time): enable the Google sign-in provider; ensure `localhost` +
  `web.app`/`firebaseapp.com` are authorized domains. Cloud Run runs `--allow-unauthenticated`;
  request auth is enforced in-app via the Firebase ID token, not at the Cloud Run boundary.
- Preview (no prod impact): `firebase hosting:channel:deploy <name>`
- Local needs `CLOUDSDK_PYTHON=python3.13` for gcloud (set in shell rc).

## Files
| Path | Description | Open when... |
|------|-------------|--------------|
| packages/shared/ | Signal schema, summaries, aggregate contract (has CLAUDE.md) | defining/recording signals or the report |
| apps/web/ | React+Vite SPA; two-phase idle→live→report flow (has CLAUDE.md) | building the frontend |
| apps/api/ | Cloud Run service under /api; STT + Gemini report + Firestore sessions (has CLAUDE.md) | building the backend |
| docs/ProjectPlan.md | Product brief and staged plan (Stage 0–4) | recalling product direction |
| docs/FrontEndDesign.md | Front-end design: two-phase live→report, stub-first (built in Stage 2) | building/restyling the frontend |
| docs/BackendSlide.md | Pitch-slide spec: two decision engines (live nudges + Gemini tone) | making the "how it works" slide |
| docs/StackSlide.md | Pitch-slide spec: Google-product stack diagram (one service per tier) | making the architecture/stack slide |
| docs/PrePlanning.md | Pre-hackathon notes | recalling early ideas |
| design-md/ | Reference design systems; web uses Linear (near-black) tokens | styling/swapping the theme |
| firebase.json / .firebaserc | Hosting + `/api/**`→Cloud Run rewrite + Firestore rules/indexes; default project | changing deploy/routing |
| firestore.rules / firestore.indexes.json | Path-based per-user session rules (deny all else); empty indexes (subcollection needs none) | changing the data model or access |
| cloudbuild.yaml | Builds the API container (apps/api/Dockerfile) for Cloud Run | changing the API build |
