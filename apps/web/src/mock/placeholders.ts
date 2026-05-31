/**
 * Typed placeholder data for signals whose backend isn't wired yet (stub-first approach,
 * `docs/FrontEndDesign.md` §1). Each placeholder is shaped exactly like the real `@quack/shared`
 * data it stands in for and carries `measured: false`, so components render an explicit
 * "not measured yet" state rather than a misleading `0`.
 *
 * use when: a live cue or report card needs to ship before its data source exists. Swap the
 * placeholder for the real value when the backend lands — the component shape doesn't change.
 */

import type { EmphasisFinding, MismatchFinding } from '@quack/shared';

/** A value the UI shows as "not measured yet" until its backend lands. */
export interface Placeholder<T> {
  readonly measured: false;
  /** Illustrative shape so the card renders realistically; never presented as a real reading. */
  readonly sample: T;
}

/**
 * Live filler cue. Real filler detection is post-hoc today (report only); a live cue needs
 * streaming STT (`docs/FrontEndDesign.md` §5). Placeholder until then.
 */
export const FILLER_CUE_PLACEHOLDER: Placeholder<{ note: string }> = {
  measured: false,
  sample: { note: 'live filler detection needs streaming STT' },
};

/** Stage 3 differentiator: did vocal stress land on the words that carry the point. */
export const EMPHASIS_PLACEHOLDER: Placeholder<EmphasisFinding[]> = {
  measured: false,
  sample: [
    {
      word: 'the breakthrough result',
      tStartMs: 12400,
      importance: 0.9,
      delivered: 0.3,
      verdict: 'under',
      options: [
        { word: 'breakthrough', stress: 0.3, stressed: false },
        { word: 'result', stress: 0.26, stressed: false },
      ],
    },
    { word: 'obviously', tStartMs: 18800, importance: 0.2, delivered: 0.8, verdict: 'over' },
  ],
};

/** Stage 3 differentiator: content sentiment vs. delivered prosody. */
export const MISMATCH_PLACEHOLDER: Placeholder<MismatchFinding[]> = {
  measured: false,
  sample: [
    {
      tStartMs: 24000,
      tEndMs: 27500,
      contentSentiment: 'excited',
      deliveredTone: 'flat',
      detail: 'The strongest result was delivered in a monotone.',
    },
  ],
};
