import { isSpeechSupported } from './speech.js';
import { useAudioCoach } from './useAudioCoach.js';
import './coach.css';

/**
 * Audio-coach control: an opt-in toggle for spoken cues. Shown on the idle and live screens. Spoken
 * cues use the browser voice (Web Speech), which always plays to the system default output device.
 *
 * use when: mounting the spoken-cue setting on a relevant screen.
 */
export function AudioCoachControl() {
  const { enabled, setEnabled } = useAudioCoach();
  const supported = isSpeechSupported();

  return (
    <div className="coach">
      <button
        type="button"
        className={`coach__toggle${enabled ? ' coach__toggle--on' : ''}`}
        onClick={() => setEnabled(!enabled)}
        disabled={!supported}
        aria-pressed={enabled}
        title={supported ? undefined : 'Your browser does not support spoken cues'}
      >
        <span className="coach__dot" aria-hidden="true" />
        {enabled ? 'Spoken cues on' : 'Spoken cues off'}
      </button>

      <p className="coach__note">
        {supported
          ? 'Spoken with the browser voice; plays to your system default output device.'
          : 'Spoken cues need a browser with speech support (e.g. Chrome).'}
      </p>
    </div>
  );
}
