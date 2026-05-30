/**
 * Typed accessors for the design tokens defined in tokens.css.
 *
 * use when: you need a token value in TS (e.g. canvas drawing, inline style) rather than CSS.
 * These map 1:1 to CSS custom properties so swapping tokens.css keeps these names valid.
 */

export const token = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Stable token-name constants. Keep in sync with tokens.css variable names. */
export const C = {
  ink: '--c-ink',
  bodyStrong: '--c-body-strong',
  muted: '--c-muted',
  canvas: '--c-canvas',
  surfaceCard: '--c-surface-card',
  hairline: '--c-hairline',
  primary: '--c-primary',
  meterGood: '--c-meter-good',
  meterWatch: '--c-meter-watch',
  meterFlag: '--c-meter-flag',
  success: '--c-success',
  error: '--c-error',
} as const;
