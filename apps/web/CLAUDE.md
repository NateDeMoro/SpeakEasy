# @quack/web

React + Vite + TS SPA. Two-phase flow: **idle** (context form + start) → **live** (nudge
centerpiece + peripheral cue strip) → **report** (real delivery metrics + real Gemini
context-advice + real Stage-3 tone card). Recorded clip → `@quack/api` for STT on stop
(chunked for long talks), then per-word stress + gap-fillers are computed and the aggregate report
is fetched.

## Edit rules
- Frontend only. Do not put Google *data*/server keys here — the web app calls `@quack/api`
  (same-origin `/api/...` via the Vite dev proxy / Firebase rewrite), never Google data APIs
  directly. The one exception is **Firebase Auth**: the public web config in `src/firebase.ts`
  (apiKey = app identifier, not a secret) and client-side sign-in are allowed.
- The whole app is gated behind Google sign-in (`AuthProvider` + `useAuth`). Every `/api` call
  goes through `authedFetch` (attaches the ID token) — never bare `fetch('/api…')`.
- Emit signals using `@quack/shared` types; never define a parallel signal shape here.
- Style via CSS variables in `theme/tokens.css` only — no hardcoded hex in components.

## Files
| Path | Description | Open when... |
|------|-------------|--------------|
| src/App.tsx | login gate (loading/sign-in) → phase machine (idle/live/report); sign-out header | changing the top-level flow |
| src/firebase.ts | Firebase app init + `auth` + `googleProvider`; committed public web config | changing Firebase setup |
| src/auth/AuthProvider.tsx | `onAuthStateChanged` context; `signIn`/`signOut`/`user`; `useAuth()` | wiring auth state |
| src/api/authedFetch.ts | `fetch` wrapper that attaches `Authorization: Bearer <idToken>` | calling any `/api` route |
| src/config.ts | all browser audio thresholds (processors/capture/nudge/dashboard); imports shared bands | tuning a live signal or the meters |
| src/audio/AudioCapture.ts | getUserMedia + AudioContext + rAF loop + MediaRecorder + nudge; calibrates recorder↔clip `offsetMs` (Stage 3 Step 0) | changing the capture pipeline |
| src/audio/processors/ | volume / pause / pace / pitch signal processors (consts in src/config.ts) | tuning or adding a live signal |
| src/audio/NudgeEngine.ts | single calm nudge (hysteresis); pace/pitch bands from `@quack/shared` | tuning the live nudge |
| src/audio/stress.ts | per-word acoustic stress (z-scored volume/pitch/duration, offset-corrected) → `word.stress` | tuning stress scoring |
| src/audio/chunker.ts | decode → 16 kHz mono → pause-aligned WAV segments + stitch (long-form STT past ~60s cap); `encodeClipToWav` re-encodes a whole short clip to WAV (server's Gemini filler pass rejects webm) | changing chunking / long-form STT |
| src/audio/fillers.ts | transcript + acoustic gap fillers → single `audio.filler` channel | changing filler derivation |
| src/audio/Recorder.ts | builds SessionRecord (+ optional context) from samples | changing how sessions are recorded |
| src/audio/useAudioCapture.ts | React binding + STT-on-stop (WAV-encode→chunk→stitch→stress→gap-fillers) + summarize + report fetch; all clips upload as WAV | wiring capture into UI |
| src/context/ContextForm.tsx | paste material + audience/setting fields → SpeechContext; optional `initialContext` prefills (remount via `key`) for "Reuse last request" | editing context capture |
| src/dashboard/ | live screen: nudge centerpiece + reactive orb + segmented pace/pitch meters + cue strip | editing the live dashboard |
| src/report/ | post-session report: real metrics + 4-quarter pace timeline + transcript (stress-weighted) + Gemini advice + real tone card (placeholder fallback when no material/old session) | editing the report |
| src/mock/placeholders.ts | typed `measured:false` stub data (shaped to `@quack/shared`) | stubbing an unbuilt signal |
| src/theme/ | Dual-palette tokens: dark `:root` default + light `[data-theme=light]` override + orb utility; `ThemeToggle.tsx` (live light/dark switch, persisted) | restyling / swapping design system / theming |

## Conventions
- Verdict bands (pace/pitch) come from `@quack/shared/config.ts` (single source for live + report);
  other audio thresholds live in `src/config.ts`. Dashboard's fine-grained pace buckets are
  web-local on purpose (they diverge from the nudge's `PACE_FAST_MIN_SPS` — see Problems.md).
- Stub-first: never render a bare `0` for an unmeasured signal — use a `measured:false` placeholder.
- Dev-only UI (raw readouts, tuners) gated behind `import.meta.env.DEV`.

## Theme swap
Replace values in `theme/tokens.css` with another `design-md` system; keep variable names stable.
Two palettes coexist: the dark `:root` block (default) and the additive `:root[data-theme='light']`
override (Direction A "Soft paper"). `ThemeToggle` (mounted once in `main.tsx`) flips the `data-theme`
attribute on `<html>` live; an inline script in `index.html` re-applies the saved choice before paint.
Light-mode accents are deepened so white `--c-on-accent` text stays legible on fills.
