# SpeakEasy

[![Live app](https://img.shields.io/badge/Live-speakeasy--498118.web.app-5E6AD2?style=flat)](https://speakeasy-498118.web.app)
[![Firebase](https://img.shields.io/badge/Firebase-Hosting_·_Auth_·_Firestore-FFCA28?style=flat&logo=firebase&logoColor=black)](https://firebase.google.com/)
[![Cloud Run](https://img.shields.io/badge/Cloud_Run-API-4285F4?style=flat&logo=google-cloud&logoColor=white)](https://cloud.google.com/run)
[![Vertex AI](https://img.shields.io/badge/Vertex_AI-Gemini_2.5_Flash-4285F4?style=flat&logo=google-cloud&logoColor=white)](https://cloud.google.com/vertex-ai)
[![Speech-to-Text](https://img.shields.io/badge/Speech--to--Text-v2-4285F4?style=flat&logo=google-cloud&logoColor=white)](https://cloud.google.com/speech-to-text)
[![React](https://img.shields.io/badge/React_+_Vite-61DAFB?style=flat&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

A browser-based, real-time speech practice coach for **one upcoming talk** — a student
presentation, a professional pitch, a wedding toast. Paste your material, rehearse with light
live audio feedback, then get a detailed report tuned to your actual speech and audience —
including whether your **tone matched your message**.

Built for the **Google Track** at QuackHacks.

- **Live coaching** — volume, pace, pauses/dead air, and pitch tracked on-device; calm dashboard
  plus a single non-distracting nudge while you speak.
- **Context-aware report** — Gemini judges delivery against your slides, script, notes, and
  audience ("too much jargon," "you skipped your second main point").
- **Tone–content mismatch** — compares *what* you said (sentiment) against *how* you said it
  (prosody), flagging contradictions like an exciting result delivered flat.
- **Stress-weighted transcript** — per-word acoustic stress weights the report transcript so
  emphasized words read heavier.
- **Per-user history** — sessions persist behind Google sign-in for cross-rehearsal review.
- **Access & cost controls** — email allowlist + ~$3/day per-user cost cap + 10-minute recording
  limit so hosting spend stays bounded.

See [docs/ProjectPlan.md](docs/ProjectPlan.md) for the full product brief and staged plan.

## Demo

[**Watch the demo on YouTube →**](https://www.youtube.com/watch?v=9MeOcQKm9ZI)

**Live app:** https://speakeasy-498118.web.app

## Built on Google, top to bottom

| Tier | Google product | Role |
|------|----------------|------|
| Edge | **Firebase Hosting + Auth** | Serves the SPA, Google sign-in, single origin (`/api/**` rewrite → Cloud Run) |
| Compute | **Cloud Run** | Stateless Hono API; verifies the Firebase ID token |
| AI / ML | **Speech-to-Text + Vertex AI** | Word-level transcript (STT v2) + Gemini 2.5 Flash on Vertex (report · tone · filler recovery) |
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

Project `speakeasy-498118`, region `us-central1`. Gemini runs on **Vertex AI** (`GEMINI_USE_VERTEX=1`).

```bash
# API → Cloud Run
gcloud builds submit --config cloudbuild.yaml .
gcloud run deploy quack-api --image gcr.io/$PROJECT_ID/quack-api:latest \
  --region us-central1 --allow-unauthenticated --port 8080 \
  --set-env-vars GOOGLE_CLOUD_PROJECT=speakeasy-498118,GEMINI_USE_VERTEX=1

# Web → Firebase Hosting
pnpm -r build && firebase deploy --only hosting

# Firestore rules / indexes
firebase deploy --only firestore:rules,firestore:indexes
```

Vertex needs the Vertex AI API enabled + `roles/aiplatform.user` on the Cloud Run runtime SA. The
email allowlist (`apps/api/allowlist.json`, gitignored) ships to Cloud Build via `.gcloudignore`;
editing it requires an API rebuild + redeploy.
