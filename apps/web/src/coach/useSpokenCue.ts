import { useEffect, useRef, useState } from 'react';
import type { LiveSnapshot } from '../audio/types.js';
import { speak } from './speech.js';
import { useAudioCoach } from './useAudioCoach.js';

const CUE_HOLD_MS = 4000;

/**
 * Spoken-cue consumer for the live hero. When a fresh cue fires (its `seq` changed) and the feature
 * is enabled, it speaks the phrase and returns it for CUE_HOLD_MS so the hero can show it in place
 * of the calm nudge, then returns null. The `seq` guard means a cue fires once even though the
 * snapshot updates every frame; a cue that fires while disabled is recorded (not replayed) so
 * enabling later won't speak a stale cue.
 *
 * use when: surfacing the spoken cue in the live dashboard hero.
 */
export function useSpokenCue(snapshot: LiveSnapshot): string | null {
  const { enabled } = useAudioCoach();
  const [active, setActive] = useState<{ text: string; seq: number } | null>(null);
  const lastSeq = useRef(0);

  const cue = snapshot.audioCue;
  useEffect(() => {
    if (!cue || cue.seq === lastSeq.current) return;
    lastSeq.current = cue.seq;
    if (!enabled) return;
    speak(cue.phrase);
    setActive({ text: cue.phrase, seq: cue.seq });
  }, [cue, enabled]);

  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => setActive(null), CUE_HOLD_MS);
    return () => window.clearTimeout(id);
  }, [active]);

  return active?.text ?? null;
}
