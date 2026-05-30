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

## Architecture
pnpm monorepo, TypeScript throughout. Frontend React+Vite; backend Google Cloud Run +
Firestore (Gemini + Speech-to-Text proxied server-side — keys never reach the client).
The signal schema is modality-agnostic so the Stage 4 video layer slots in as added channels.

Commands: `pnpm install`; `pnpm dev` (web); `pnpm -r typecheck`; `pnpm -r build`;
`pnpm --filter @quack/api dev` (API on :8080).

## Deploy (project `uoo-quackathon26eug-8210`, region us-central1)
Web → Firebase Hosting (https://uoo-quackathon26eug-8210.web.app); API → Cloud Run
(`quack-api`). Hosting rewrites `/api/**` → Cloud Run, so the browser hits one origin.
The Hono app is mounted at `/api` (`basePath`); the Vite dev proxy mirrors this.
- API: `gcloud builds submit --config cloudbuild.yaml .` then
  `gcloud run deploy quack-api --image gcr.io/$PROJECT/quack-api:latest --region us-central1 --allow-unauthenticated --port 8080`
- Web: `pnpm -r build` then `firebase deploy --only hosting`
- Preview (no prod impact): `firebase hosting:channel:deploy <name>`
- Local needs `CLOUDSDK_PYTHON=python3.13` for gcloud (set in shell rc).

## Files
| Path | Description | Open when... |
|------|-------------|--------------|
| packages/shared/ | Signal schema, summaries, aggregate contract (has CLAUDE.md) | defining/recording signals or the report |
| apps/web/ | React+Vite SPA; Stage 0 audio capture + dashboard (has CLAUDE.md) | building the frontend |
| apps/api/ | Cloud Run service; Gemini/STT/Firestore (has CLAUDE.md) | building the backend |
| docs/ProjectPlan.md | Product brief and staged plan (Stage 0–4) | recalling product direction |
| docs/PrePlanning.md | Pre-hackathon notes | recalling early ideas |
| design-md/ | Reference design systems; web uses ElevenLabs tokens | styling/swapping the theme |
| firebase.json / .firebaserc | Hosting config + `/api/**`→Cloud Run rewrite; default project | changing deploy/routing |
| cloudbuild.yaml | Builds the API container (apps/api/Dockerfile) for Cloud Run | changing the API build |
