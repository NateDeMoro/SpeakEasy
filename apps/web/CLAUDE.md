# @quack/web

React + Vite + TS SPA. The Stage 0 target: offline audio capture + live dashboard.

## Edit rules
- Frontend only. Do not put API keys here — the web app calls `@quack/api`, never Google directly.
- Emit signals using `@quack/shared` types; never define a parallel signal shape here.
- Style via CSS variables in `theme/tokens.css` only — no hardcoded hex in components.

## Files
| Path | Description | Open when... |
|------|-------------|--------------|
| src/audio/AudioCapture.ts | getUserMedia + AudioContext + rAF loop | changing the capture pipeline |
| src/audio/processors/ | volume / pause / pace signal processors | tuning or adding a live signal |
| src/audio/Recorder.ts | builds SessionRecord from samples | changing how sessions are recorded |
| src/audio/useAudioCapture.ts | React binding + summarize-on-stop | wiring capture into UI |
| src/dashboard/ | live meters | editing the live dashboard |
| src/theme/ | ElevenLabs tokens (swappable) | restyling / swapping design system |

## Theme swap
Replace values in `theme/tokens.css` with another `design-md` system; keep variable names stable.
