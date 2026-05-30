import './dashboard/dashboard.css';
import { useAudioCapture } from './audio/useAudioCapture.js';
import { Dashboard } from './dashboard/Dashboard.js';

export function App() {
  const { running, error, snapshot, summaries, start, stop } = useAudioCapture();

  return (
    <div className="app">
      <h1 className="app__title">Speech Practice Coach</h1>
      <p className="app__subtitle">
        Stage 0 — live audio capture. Volume, pace, and dead air, computed on-device.
      </p>

      <div className="controls">
        {running ? (
          <button className="btn btn--ghost" onClick={stop}>
            Stop
          </button>
        ) : (
          <button className="btn btn--primary" onClick={start}>
            Start rehearsal
          </button>
        )}
        {error && <span className="error">{error}</span>}
      </div>

      <Dashboard snapshot={snapshot} />

      {summaries && (
        <div className="summary">
          <p className="card__label">Session channel summaries (schema check)</p>
          <pre>{JSON.stringify(summaries, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
