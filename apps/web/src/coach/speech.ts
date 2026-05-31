/**
 * Browser Web Speech API wrapper for the spoken coaching cues. Cancel-then-speak so cues never
 * queue or overlap (the engine already gates frequency). No-ops where speechSynthesis is absent.
 *
 * Note: speechSynthesis has no output-device control — it always plays to the system default. The
 * device dropdown is therefore best-effort; it persists a choice for a possible future routed path.
 *
 * use when: speaking a cue from the live screen.
 */

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function speak(phrase: string): void {
  if (!isSpeechSupported()) return;
  const synth = window.speechSynthesis;
  synth.cancel(); // drop anything mid-utterance so the newest cue wins
  synth.speak(new SpeechSynthesisUtterance(phrase));
}
