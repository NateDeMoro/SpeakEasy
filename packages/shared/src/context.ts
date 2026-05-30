/**
 * Speech material and audience/setting context.
 *
 * use when: building the Stage 1 context-capture UI, or assembling aggregate input.
 *
 * All fields are optional by design — the user provides whatever they want. Emphasis-vs-meaning
 * and context-aware advice are much stronger when `material` is supplied, so the UI should
 * actively encourage uploading the script/slides (it is not required, though).
 */

/** A reference to uploaded speech material that Gemini can read natively (PDF, image, text). */
export interface MaterialRef {
  kind: 'slides' | 'script' | 'notes';
  /** MIME type, e.g. 'application/pdf', 'image/png', 'text/plain'. */
  mimeType: string;
  /** Storage URI (e.g. gs:// or https://) once uploaded, or undefined for inline text. */
  uri?: string;
  /** Inline text content when pasted directly rather than uploaded. */
  text?: string;
  /** Original filename, for display. */
  filename?: string;
}

export interface ParsedMaterial {
  refs: MaterialRef[];
  /** Optional flattened text extracted from refs, for quick prompt assembly. */
  combinedText?: string;
}

/**
 * Open-ended audience and setting fields. All optional and free-form; this is intentionally
 * loose so users can fill in as much or as little as they like.
 */
export interface ContextFields {
  audience?: string;
  audienceSize?: string;
  audienceBackground?: string;
  location?: string;
  presentationType?: string;
  /** Anything else the user wants the coach to know. */
  notes?: string;
}

export interface SpeechContext {
  material?: ParsedMaterial;
  settings?: ContextFields;
}
