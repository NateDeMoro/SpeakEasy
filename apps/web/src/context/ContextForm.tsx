import { useState } from 'react';
import type { ContextFields, MaterialRef, SpeechContext } from '@quack/shared';
import './context.css';

type MaterialKind = MaterialRef['kind'];

/** Free-text setting fields (goalSeconds is numeric and handled separately). */
type TextField = Exclude<keyof ContextFields, 'goalSeconds'>;

const SETTING_FIELDS: { key: TextField; label: string; placeholder: string }[] = [
  { key: 'audience', label: 'Audience', placeholder: 'e.g. my thesis committee' },
  { key: 'audienceSize', label: 'Audience size', placeholder: 'e.g. about 8 people' },
  { key: 'audienceBackground', label: 'Audience background', placeholder: 'e.g. domain experts' },
  { key: 'location', label: 'Location', placeholder: 'e.g. lecture hall, on stage' },
  { key: 'presentationType', label: 'Presentation type', placeholder: 'e.g. conference talk' },
  { key: 'notes', label: 'Anything else', placeholder: 'e.g. keep it upbeat' },
];

/** Parse a mm:ss (or m:ss) target into whole seconds. Returns undefined when empty/malformed. */
function parseGoalSeconds(text: string): number | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const m = /^(\d{1,3}):([0-5]?\d)$/.exec(t);
  if (!m) return undefined;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Assemble a SpeechContext, dropping empty material/fields so absence stays meaningful. */
function buildContext(
  kind: MaterialKind,
  materialText: string,
  fields: ContextFields,
  goalText: string,
): SpeechContext {
  const ctx: SpeechContext = {};
  const text = materialText.trim();
  if (text) {
    const ref: MaterialRef = { kind, mimeType: 'text/plain', text };
    ctx.material = { refs: [ref], combinedText: text };
  }
  const settings: ContextFields = {};
  for (const { key } of SETTING_FIELDS) {
    const v = fields[key];
    if (typeof v === 'string' && v.trim()) settings[key] = v.trim();
  }
  const goalSeconds = parseGoalSeconds(goalText);
  if (goalSeconds !== undefined) settings.goalSeconds = goalSeconds;
  if (Object.keys(settings).length) ctx.settings = settings;
  return ctx;
}

/**
 * Stage 1 context capture: paste the speech material plus open-ended audience/setting fields. All
 * optional, but pasting the script/slides is actively encouraged — emphasis-vs-meaning and the
 * context-aware report (Stages 2–3) are much stronger with it. `onChange` emits the assembled
 * SpeechContext so the parent can attach it to the session record at stop.
 *
 * use when: rendering the rehearsal setup form. Paste only this stage; file types arrive in Stage 2.
 */
export function ContextForm({ onChange }: { onChange: (ctx: SpeechContext) => void }) {
  const [kind, setKind] = useState<MaterialKind>('script');
  const [materialText, setMaterialText] = useState('');
  const [fields, setFields] = useState<ContextFields>({});
  const [goalText, setGoalText] = useState('');

  const emit = (k: MaterialKind, text: string, f: ContextFields, goal: string) =>
    onChange(buildContext(k, text, f, goal));

  const setField = (key: TextField, value: string) => {
    const next = { ...fields, [key]: value };
    setFields(next);
    emit(kind, materialText, next, goalText);
  };

  return (
    <details className="context" open>
      <summary className="context__summary">Speech context (optional, but recommended)</summary>

      <div className="context__body">
        <div className="field">
          <label className="field__label" htmlFor="material-kind">
            Material
          </label>
          <select
            id="material-kind"
            className="field__input"
            value={kind}
            onChange={(e) => {
              const k = e.target.value as MaterialKind;
              setKind(k);
              emit(k, materialText, fields, goalText);
            }}
          >
            <option value="script">Script</option>
            <option value="notes">Notes</option>
            <option value="slides">Slides (paste text)</option>
          </select>
          <textarea
            className="field__input field__textarea"
            placeholder="Paste your script, slide text, or notes here — the coach reads your talk against it."
            value={materialText}
            onChange={(e) => {
              setMaterialText(e.target.value);
              emit(kind, e.target.value, fields, goalText);
            }}
          />
          <p className="field__hint">
            Pasting the actual talk makes the after-the-fact report much sharper.
          </p>
        </div>

        <div className="context__grid">
          {SETTING_FIELDS.map(({ key, label, placeholder }) => (
            <div className="field" key={key}>
              <label className="field__label" htmlFor={`ctx-${key}`}>
                {label}
              </label>
              <input
                id={`ctx-${key}`}
                className="field__input"
                placeholder={placeholder}
                value={fields[key] ?? ''}
                onChange={(e) => setField(key, e.target.value)}
              />
            </div>
          ))}
          <div className="field">
            <label className="field__label" htmlFor="ctx-goal">
              Target length
            </label>
            <input
              id="ctx-goal"
              className="field__input"
              placeholder="mm:ss, e.g. 5:00"
              inputMode="numeric"
              value={goalText}
              onChange={(e) => {
                setGoalText(e.target.value);
                emit(kind, materialText, fields, e.target.value);
              }}
            />
          </div>
        </div>
      </div>
    </details>
  );
}
