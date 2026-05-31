# Slide: "Built on Google, top to bottom"

Content + layout spec for one pitch slide that makes the **Google stack** the hero — one
Google service per infrastructure tier, so a judge sees the breadth of the ecosystem in a
single frame. Complements `docs/BackendSlide.md` (which explains *how* SpeakEasy decides)
and the flow diagrams in `docs/diagrams/`.

Build the actual PowerPoint/Slides slide from this. Every label traces to real code — see
**Source of truth** to re-verify before presenting.

---

## Title
**Built on Google, top to bottom**
*One rehearsal, the whole Google stack*

---

## The stack (top → bottom, request flows down)

**Entry box** — the only non-Google box, the request origin:
`🎤 Speaker rehearses` → **Browser — React + Vite SPA** *(mic capture · on-device live nudge · renders report)*

Then four hero tiers, Google product as the big label:

| Tier | **Google product** | What it does | Detail to show |
|---|---|---|---|
| Edge | **Firebase Hosting + Auth** | Serves the SPA · Google sign-in · single origin | `/api/**` rewrite → Cloud Run; Firebase ID token on every call |
| Compute | **Cloud Run** | Stateless API (Hono container) | `/transcribe` · `/aggregate` · `/sessions`; verifies the ID token |
| AI / ML | **Vertex AI** *(the brain)* | Transcribe + judge | **Speech-to-Text v2** (word-level transcript) + **Gemini ×2** (report · tone) |
| Data | **Cloud Firestore** | Per-user history | `users/{uid}/sessions` — path-based ownership, no indexes |

**Side rail (spans every tier):**
`Cloud Build` builds the container image · `ADC` gives keyless service-account auth — **no
API keys anywhere in the repo.**

**Request-flow arrow (down the right edge, keep to ~4 labels):**
`ID token → /api rewrite → STT, then 3 parallel Gemini calls → save session` — and the
**report returns back up** to the browser.

---

## Footer — Google tech
`Firebase Hosting · Firebase Auth · Cloud Run · Vertex AI (Speech-to-Text + Gemini) · Cloud Firestore · Cloud Build`

---

## Visual direction
- Vertical stack of full-width tiers: entry box on top, **Firestore** at the bottom; a
  thin side rail (left or right) carries Cloud Build + ADC across all tiers.
- Theme: Linear near-black tokens already used by the web app (`design-md/`,
  `FrontEndDesign.md`). Canvas `#010102`; tier cards `#0f1011` charcoal, 1px `#23252a`
  hairline, 16px radius. No shadows.
- Ink `#f7f8f8`; product label bold (weight 600), function subtitle muted `#8a8f98`.
- Accent the **Vertex AI** tier with lavender `#5e6ad2` (it's the brain/differentiator);
  keep other tiers neutral so the eye lands on the AI layer.
- Optional: drop the official Google Cloud product glyph beside each tier label if you
  want logos; defaults to clean text labels.

## Speaker notes (verbal backup)
"Everything sits on Google. The browser app is served and gated by Firebase — Hosting
serves the SPA and rewrites `/api` to Cloud Run, Auth gives us Google sign-in and an ID
token on every call. Cloud Run runs our stateless API. The brain is Vertex AI:
Speech-to-Text turns the take into a word-level transcript, then two Gemini calls run in
parallel for the report and tone. Sessions persist per user in Firestore. Cloud
Build ships the container, and everything authenticates through ADC — so there's not a
single API key in the codebase."

---

## Source of truth (verify before presenting)
Every tier traces to real code:

| Claim | File |
|---|---|
| `/api/**` → Cloud Run rewrite; default project | `firebase.json`, `.firebaserc` |
| Firebase web config + Google sign-in (public, not a secret) | `apps/web/src/firebase.ts` |
| Firebase ID token attached to every `/api` call | `authedFetch` (`apps/web/src/`) |
| Hono API mounted at `/api`; transcribe/aggregate/sessions routes | `apps/api/src/` |
| Speech-to-Text v2, word time offsets | `apps/api/src/stt/transcribe.ts` |
| 2 parallel Gemini calls (report / tone) | `apps/api/src/aggregate/runAggregate.ts`, `apps/api/src/config.ts` |
| Per-user sessions `users/{uid}/sessions`; path-based rules | `firestore.rules` |
| Container image built for Cloud Run | `cloudbuild.yaml`, `apps/api/Dockerfile` |
| Keyless auth via ADC; no keys committed | CLAUDE.md "Deploy" section |
