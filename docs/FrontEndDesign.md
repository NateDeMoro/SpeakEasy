# Front End Design Plan

Status: **built in Stage 2.** The two-phase `idle → live → report` flow, the report shell, and
the Linear dark theme are implemented. This doc now reflects the as-built design (plus the
Stage-3 placeholders still pending). Two amendments to the original plan are called out inline:
pace/pitch keep their segmented light-up meters (not collapsed to single cues), and the Stage-1
transcript is retained in the report.

Scope: `apps/web` only (respect `apps/web/CLAUDE.md` edit rules — frontend only, no API keys,
emit `@quack/shared` types, style via CSS variables in `theme/tokens.css`).

---

## 1. Guiding approach — stub-first

Build the **complete ideal front end up front**, using placeholder data for any signal whose
backend isn't implemented yet. As each backend feature lands, swap the placeholder *source*
for real values without restructuring components.

Two rules that make the progressive swap cheap and safe:

1. **Stub through the real shared types.** All placeholder data lives in one mock module,
   shaped exactly like production data (`LiveSnapshot`, `ChannelSummary`, the aggregate
   contract in `@quack/shared`). Components read the same props/types they will use in
   production, so "swap placeholder for real" = changing the data source, never the component.
2. **Never render a bare `0` for an unmeasured signal.** A filler count of `0` reads as
   "perfect, no fillers," which misleads the user and demo judges. Each placeholder carries a
   `measured: false` flag; components render an explicit **"not measured yet"** state (dimmed,
   em-dash, or a small "coming soon" tag) for unimplemented signals. Reserve a real `0` for a
   signal genuinely measured as zero.

---

## 2. Two-phase structure (live → report)

The product is two distinct screens, not one scrolling page.

- **Phase 1 — Live rehearsal screen:** while the user is talking, show real-time delivery cues.
- **Phase 2 — Post-session report:** after they stop, show the rich after-the-fact report.

The data already splits cleanly along this boundary:
- **Live** = `snapshot` (`LiveSnapshot`, per-frame, on-device).
- **Report** = `record` (`SessionRecord`) + `summaries` (`ChannelSummary[]`), ready after `stop()`.

### Phase state machine (`App.tsx`)
`idle → live → report`, with a reset back to idle.

| Phase | Shows | Enter when |
|---|---|---|
| `idle` | Title, `ContextForm` (audience + pasted/uploaded script), **Start rehearsal** | initial load, or "New rehearsal" from report |
| `live` | Live rehearsal screen (nudge + cue strip) | Start pressed, mic running |
| `report` | Post-session report | Stop pressed; transition completes once the transcript resolves (handle the `transcribing` interim with a loading state) |

Notes:
- `ContextForm` moves to the **idle** screen — context is set *before* rehearsing, not alongside
  live meters. (Today it sits above the live dashboard; that changes.)
- Derive phase from existing state (`running` / `transcribing` / `record`) or add an explicit
  `phase` field — decide at implementation time; explicit is clearer.

---

## 3. Phase 1 — Live rehearsal screen

### Prominence decision: promote the nudge, keep the pace/pitch meters
**The single calm nudge is the centerpiece (over a reactive orb). Pace and pitch keep their
segmented light-up meters; volume, dead air, and the (not-yet-measured) filler cue sit in a thin
peripheral strip.**

> **Amendment (post-Stage-2):** the original plan collapsed *all* meters into single cues. In
> practice the segmented pace (5-bucket) and pitch (3-bucket) meters that light up by category
> are the most legible at a glance and were restored. Raw numbers (dBFS / syll-s / Hz) still move
> off the live screen — they live in the dev readout (gated behind `import.meta.env.DEV`).

Reasoning (from `docs/ProjectPlan.md`): the real-time side is deliberately thin — "standard
delivery metrics plus a single nudge," and the brief warns "avoid gold-plating the dashboard."
A speaker mid-rehearsal absorbs one calm line plus a couple of glanceable colored meters; the
depth belongs in the report, where there is no latency pressure.

### Layout
- **Nudge centerpiece:** large EB Garamond Light (300), centered, generous whitespace, with a
  soft atmospheric gradient orb drifting behind it. Idle copy: "You're doing fine — keep going."
  `aria-live="polite"` retained.
- **Pace + pitch meters:** segmented light-up bars, **no raw numbers** on screen.
  - **Pace** — 5 buckets (slow / a little slow / good / a little fast / fast); the active bucket
    lights up in its category color.
  - **Pitch variation** — 3 buckets (monotone / varied / expressive); active bucket lights up.
- **Peripheral cue strip:** a thin row of glanceable indicators — bar or dot + short label:
  - **Volume** — bar, colored good/watch/flag (via `--c-meter-*`).
  - **Dead air** — dot + "speaking" / "Ns silent".
  - **Filler words** — **placeholder state** (see §5 constraint); renders "not measured yet"
    until streaming STT exists.
- **Dev controls gated:** the `WindowControl` A/B window tuners currently on each card are dev
  tooling. Keep them behind a dev flag — visible while tuning, off in the demo/production build.

### Visual cue intent (from the original brainstorm)
The live screen is meant to give *displayed cues*, not just numbers — e.g. a clear "too many
filler words" signal, volume too quiet/loud, pace too fast, going monotone, dead air running
long. The cue strip encodes each as a calm visual state (color + short label), and the nudge
surfaces the single most important one in words.

---

## 4. Phase 2 — Post-session report (full shell)

Build the **full report shell**, including the differentiator sections as clearly-labeled
placeholder cards (Gemini aggregate isn't built yet). Styled as real cards so the layout is
demo-complete; placeholders read "coming soon," not fake data.

New: `src/report/Report.tsx` (+ report css). Consumes `record` + `summaries`.

### Sections
1. **Delivery metrics (real, from local summaries):** volume, pace, pitch variation, dead air,
   filler count + timeline — sourced from `summarizeAll(record.channels)` we already compute on
   `stop()`. These are live data today, not placeholders.
1b. **Transcript (real, Stage 1):** the word-level transcript from batch STT, rendered with the
   filler words highlighted (`isDisfluency`) and a filler count. Carried over from the Stage-1
   single-screen UI — it was dropped in the first two-phase pass and restored. Shows a
   "Transcribing…" state while STT runs, and "No speech detected" when the clip is empty.
2. **Tone–content mismatch** — *placeholder card.* Content sentiment (Gemini) vs. prosody —
   e.g. an exciting result delivered flat. Placeholder now.
3. **Context-aware advice** — *placeholder card.* Reads the `SpeechContext` (audience, setting,
   script) to judge delivery against the real talk and room. Placeholder now.

Each placeholder card is wired to local data where possible (e.g. context advice can already
echo the captured `SpeechContext`) so the swap to real Gemini output is minimal.

---

## 5. Key constraint — live filler words need streaming STT

**Filler words are not available live today.** `apps/api/src/stt/transcribe.ts` uses batch sync
`recognize`, called once when the client POSTs the recorded clip on `stop()`. `buildFillerChannel`
(`apps/web/src/audio/fillers.ts`) derives fillers from that **post-hoc** transcript.

Consequences:
- Filler data **can** render in the **report** today (post-hoc).
- A **live** filler cue requires **streaming STT**, which `docs/ProjectPlan.md` lists as Stage 1
  work and flags as the main new dependency/risk (STT must be configured to preserve disfluencies).

Decision: **add the live filler cue to the UI now as a placeholder** (`measured: false`,
"not measured yet" state), and swap in real values when streaming STT lands. This matches the
stub-first approach — the component ships now, the data source fills in later.

---

## 6. Theme — Linear (near-black, lavender accent)

Design source: `design-md/linear.app/DESIGN.md` (active token source in
`apps/web/src/theme/tokens.css`). Replaced the original ElevenLabs off-white system — we wanted a
dark UI. Near-black canvas (`#010102`), charcoal panels (`#0f1011`) with hairline borders, light
gray ink (`#f7f8f8`), and the Linear lavender-blue (`#5e6ad2`) as the single chromatic accent
(brand mark, focus rings, primary CTAs — never decoration). Quietly technical, dense, luxurious.

### Display typeface
Linear's display is a custom sans (SF Pro Display fallback) at 500–700 with negative tracking.
`--t-display-family` is a system sans stack (`-apple-system, 'SF Pro Display', 'Inter', …`) at
weight 600; **Inter** (loaded via Google Fonts) carries body / nav / captions / buttons. The
earlier EB Garamond serif was dropped — a serif clashes with Linear's sans identity.

### Theme tasks (done)
- `tokens.css` swapped to the Linear dark palette; **variable names kept stable** so components
  (which reference only CSS variables, never raw hex) needed no structural change.
- Added `--c-on-accent` (near-black) for text on bright accent fills — meter segments, tags, and
  filler highlights now read dark-on-color instead of light-on-color.
- Meter accents remapped to vivid-on-dark: good `#4cd6a0`, watch `#e8a13c`, flag `#ff6b81`,
  info/sky `#6ea8fe`, lavender `#828fff`.
- **Atmospheric orb** utility (`.orb` in `tokens.css`): a soft radial gradient behind the live
  nudge, reactive to pace (lavender idle → mint good → peach slow → rose fast). Decoration only.
- Cards: `--c-surface-card` charcoal panel, 1px `--c-hairline`, `--radius-card` (16px). CTAs:
  lavender pill primary, transparent outline secondary.

### Optional flourish (decide later)
Consider making the orb *react* to the live session (e.g. bloom mint when pace is good, peach
when slow) as an on-brand atmospheric feedback layer and a strong demo moment. Default to purely
decorative if it adds risk.

---

## 7. File change summary

All within `apps/web` (in scope per `CLAUDE.md`).

| File | Change |
|---|---|
| `src/App.tsx` | Phase state machine (`idle/live/report`); move `ContextForm` to idle; render `Report`; "New rehearsal" reset |
| `src/mock/placeholders.ts` (new) | Typed stub data + `measured` flags, shaped to `@quack/shared` + `LiveSnapshot` |
| `src/dashboard/Dashboard.tsx` + `dashboard.css` | Nudge centerpiece; peripheral cue strip (incl. filler placeholder); drop raw numbers; gate `WindowControl` behind dev flag |
| `src/report/Report.tsx` + css (new) | Full report shell: real delivery-metric cards + placeholder differentiator cards (tone–content mismatch, context advice) |
| `src/theme/tokens.css` + `index.html` | EB Garamond (300) display family; load fonts; add orb utility |
| `apps/web/CLAUDE.md` | Document new `mock/` + `report/` dirs and the two-phase flow (update in the same turn as the code) |

---

## 8. Implementation order (when we resume)

1. Theme: load EB Garamond, set display family, add orb utility. Verify build.
2. Mock module: typed placeholders + `measured` flags.
3. Live screen redesign: nudge centerpiece + cue strip; gate dev controls. Typecheck + visual check.
4. Phase state machine in `App.tsx`; move `ContextForm` to idle.
5. Report shell: real metric cards first, then placeholder differentiator cards.
6. Update `apps/web/CLAUDE.md`.
7. Progressive wiring later: replace placeholders as streaming STT (live fillers) and the Gemini
   aggregate (report differentiators) come online.

---

## 9. Decisions log (for traceability)

- Two phases: live screen → post-session report. **Locked.**
- Live prominence: nudge is the centerpiece. Pace (5-bucket) + pitch (3-bucket) keep their
  segmented light-up meters; volume/dead-air/filler are thin cues. **Amended** (post-Stage-2 —
  originally all meters were to be collapsed; segmented meters proved more legible).
- Live cues include filler words — filler is a **placeholder** until streaming STT exists. **Locked.**
- Transcript (word-level, filler-highlighted) is retained in the report as a real Stage-1
  element. **Locked** (was dropped in the first two-phase pass, then restored).
- Build full ideal front end now with placeholder data; progressively swap for real values.
  **Locked** (stub-first).
- Report: **full shell** — delivery metrics + transcript + context-advice are real; tone–mismatch
  is a placeholder card (real finding when present). **Locked.**
- Theme: **Linear** (`design-md/linear.app`) — near-black canvas, lavender accent, system sans
  display. **Locked** (replaced ElevenLabs off-white + EB Garamond serif; we wanted a dark UI).
