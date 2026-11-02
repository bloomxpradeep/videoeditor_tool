import { useState } from 'react';
import type { Question } from '../../server/protocol';

const OTHER = '__other__';

// Claude's AskUserQuestion as clickable cards. Answers go back keyed by question text, multi-select comma-joined,
// which is the shape the tool expects.
export function QuestionCard(props: {
  questions: Question[];
  answers?: Record<string, string>;
  disabled: boolean;
  onSubmit: (answers: Record<string, string>) => void;
}) {
  const [picked, setPicked] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const [focus, setFocus] = useState<Record<number, string>>({});
  const locked = !!props.answers || props.disabled;

  const answerFor = (i: number) =>
    (picked[i] || []).map((l) => (l === OTHER ? (other[i] || '').trim() : l)).filter(Boolean).join(', ');
  const complete = props.questions.every((_, i) => answerFor(i));

  function toggle(i: number, label: string, multi: boolean) {
    if (locked) return;
    setFocus((f) => ({ ...f, [i]: label }));
    setPicked((p) => {
      const cur = p[i] || [];
      if (!multi) return { ...p, [i]: [label] };
      return { ...p, [i]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] };
    });
  }

  function submit() {
    const out: Record<string, string> = {};
    props.questions.forEach((q, i) => (out[q.question] = answerFor(i)));
    props.onSubmit(out);
  }

  return (
    <div className={`card question ${locked ? 'locked' : ''}`}>
      {props.questions.map((q, i) => {
        const answered = props.answers?.[q.question];
        const preview = q.options.find((o) => o.label === focus[i])?.preview;
        return (
          <div key={i} className="q">
            <div className="q-head">
              <span className="chip">{q.header}</span>
              {q.multiSelect && <span className="muted small">Choose any</span>}
            </div>
            <div className="card-title">{q.question}</div>
            {answered !== undefined ? (
              <div className="answered">→ {answered}</div>
            ) : (
              <>
                <div className="options">
                  {q.options.map((o) => {
                    const on = (picked[i] || []).includes(o.label);
                    return (
                      <button key={o.label} className={`option ${on ? 'on' : ''}`} disabled={locked} onClick={() => toggle(i, o.label, q.multiSelect)}>
                        <span className="opt-label">{o.label}</span>
                        <span className="opt-desc">{o.description}</span>
                      </button>
                    );
                  })}
                  <button className={`option ${(picked[i] || []).includes(OTHER) ? 'on' : ''}`} disabled={locked} onClick={() => toggle(i, OTHER, q.multiSelect)}>
                    <span className="opt-label">Other</span>
                    <span className="opt-desc">Type your own answer</span>
                  </button>
                </div>
                {(picked[i] || []).includes(OTHER) && (
                  <input
                    className="other"
                    autoFocus
                    value={other[i] || ''}
                    onChange={(e) => setOther((o) => ({ ...o, [i]: e.target.value }))}
                    placeholder="Your answer"
                  />
                )}
                {preview && <pre className="preview">{preview}</pre>}
              </>
            )}
          </div>
        );
      })}
      {!props.answers &&
        (props.disabled ? (
          <div className="muted small">Not answered</div>
        ) : (
          <div className="row end">
            <button className="primary" disabled={!complete} onClick={submit}>
              Send answer
            </button>
          </div>
        ))}
    </div>
  );
}
