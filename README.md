# SpeakEasy

A browser-based, real-time speech practice coach. Rehearse a specific talk, get light
live audio feedback while you speak, and receive a detailed after-the-fact report tuned to
your actual speech material and audience — including whether your **tone matched your
message**.

Built for the **Google Track** at QuackHacks — Google products, top to bottom.

## 🎥 Demo

[**Watch the demo on YouTube →**](https://www.youtube.com/watch?v=9MeOcQKm9ZI)

**Live app:** https://uoo-quackathon26eug-8210.web.app

## What it does

SpeakEasy is built for an ordinary person prepping one upcoming talk — a student, a
professional, someone giving a wedding toast — not aspiring pros committing to months of
skill-building. The job is "get this one talk ready," so the advice is about *this* speech
("cut your intro, slow down on the key point"), not abstract skill scores.

- **Live coaching** — volume, pace, pauses/dead air, and pitch are tracked on-device while
  you speak, surfaced as a calm dashboard plus a single non-distracting nudge.
- **Context-aware report** — paste your slides, script, or notes and describe the audience
  and setting; Gemini judges your delivery against the real talk and room ("too much jargon
  for this audience," "you skipped your second main point").
- **Tone–content mismatch** — compares *what* you said (Gemini sentiment) against *how* you
  said it (prosody), flagging contradictions like an exciting result delivered flat.
- **Stress-weighted transcript** — per-word acoustic stress weights the report transcript so
  the words you emphasized read heavier.
- **Per-user history** — sessions persist behind Google sign-in for cross-rehearsal review.

See [docs/ProjectPlan.md](docs/ProjectPlan.md) for the full product brief and staged plan.

## Built on Google, top to bottom

| Tier | Google product | Role |
|------|----------------|------|
| Edge | **Firebase Hosting + Auth** | Serves the SPA, Google sign-in, single origin (`/api/**` rewrite → Cloud Run) |
| Compute | **Cloud Run** | Stateless Hono API; verifies the Firebase ID token |
| AI / ML | **Vertex AI** | Speech-to-Text v2 (word-level transcript) + Gemini ×2 (report · tone) |
| Data | **Cloud Firestore** | Per-user history at `users/{uid}/sessions` |
| Build | **Cloud Build** | Builds the API container image |

Auth is keyless via **ADC** — no API keys anywhere in the repo.

## Architecture

pnpm monorepo, TypeScript throughout.

- **`apps/web`** — React + Vite SPA. Two-phase flow: **idle** (context form) → **live**
  (nudge + meters) → **report**. Mic capture and the live nudge run on-device; the recorded
  clip is sent to the API for transcription on stop.
- **`apps/api`** — Cloud Run service (Hono, mounted at `/api`). Proxies Speech-to-Text and
  Gemini server-side (keys never reach the client) and stores sessions in Firestore.
- **`packages/shared`** — modality-agnostic signal schema, summaries, and the aggregate
  report contract, so the planned Stage 4 video layer slots in as added channels.

The browser hits one origin: Firebase Hosting rewrites `/api/**` to Cloud Run. Every `/api`
call carries a Firebase ID token, verified server-side with firebase-admin.

## Development

```bash
pnpm install
pnpm dev                        # web app (Vite dev server)
pnpm --filter @quack/api dev    # API on :8080
pnpm -r typecheck
pnpm -r build
```

Requires Node >= 20 and pnpm 9.

## Deploy

Project `uoo-quackathon26eug-8210`, region `us-central1`.

```bash
# API → Cloud Run
gcloud builds submit --config cloudbuild.yaml .
gcloud run deploy quack-api --image gcr.io/$PROJECT/quack-api:latest \
  --region us-central1 --allow-unauthenticated --port 8080

# Web → Firebase Hosting
pnpm -r build && firebase deploy --only hosting

# Firestore rules / indexes
firebase deploy --only firestore:rules,firestore:indexes
```
