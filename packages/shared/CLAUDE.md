# @quack/shared

Single source of truth for the modality-agnostic signal schema and the aggregate contract.
Imported by both `apps/web` (recorder, report typing) and `apps/api` (aggregate impl).

## Edit rules
- This package is a cross-team contract. Change types only with team agreement.
- Any breaking change to `SessionRecord` shape: bump `SCHEMA_VERSION` in `schema.ts`.
- Keep it dependency-free (types + pure functions only). No runtime libs, no I/O.

## Files
| Path | Description | Open when... |
|------|-------------|--------------|
| src/schema.ts | Channels, samples, SessionRecord, Transcript | defining/recording signals |
| src/summaries.ts | ChannelSummary + summarizer registry | preparing aggregate input; adding a signal |
| src/aggregate.ts | AggregateInput/Report/Fn contract | implementing or consuming the report |
| src/context.ts | SpeechContext, ParsedMaterial, ContextFields | building context-capture UI |

## Adding a new signal/modality
1. Emit `SignalChannel`s with a new `descriptor` (`${modality}.${signal}`).
2. Register a `Summarizer` under that `signal` key in `summaries.ts` (generic fallback exists).
3. Analyses consume it via `findSummary(...)` and must degrade gracefully if absent.
