import { useCallback, useEffect, useState } from 'react';

/**
 * Spoken-cue setting, persisted to localStorage like the theme toggle: an `enabled` flag that
 * defaults on (an explicit opt-out is remembered). Web Speech always plays to the system default
 * output device, so there is no device selection to manage.
 *
 * Every in-page instance stays in step (the live screen mounts both the control and the cue
 * consumer): a change broadcasts SYNC_EVENT and all hooks re-read; 'storage' covers other tabs.
 *
 * use when: rendering the audio-coach control or the live cue consumer.
 */

const ENABLED_KEY = 'audioCoachEnabled';
const SYNC_EVENT = 'audiocoach:change';

function readEnabled(): boolean {
  try {
    // Default on: only an explicit '0' (the user turned it off) disables it.
    return localStorage.getItem(ENABLED_KEY) !== '0';
  } catch {
    return true;
  }
}

export function useAudioCoach() {
  const [enabled, setEnabledState] = useState<boolean>(readEnabled);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    try {
      localStorage.setItem(ENABLED_KEY, next ? '1' : '0');
    } catch {
      // Storage can throw in private mode; the setting still applies for the session.
    }
    window.dispatchEvent(new Event(SYNC_EVENT));
  }, []);

  // Re-read on any change broadcast by another instance (or tab) so all stay in sync.
  useEffect(() => {
    const sync = () => setEnabledState(readEnabled());
    window.addEventListener(SYNC_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(SYNC_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return { enabled, setEnabled };
}
