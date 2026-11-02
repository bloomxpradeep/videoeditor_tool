import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { ChatEvent, JobMeta } from '../../server/protocol';
import { socket } from './ws';
import { QuestionCard } from './QuestionCard';
import { EMPTY_TYPO, TypographyPanel, typoBrief, useTypography, type Typo } from './TypographyPanel';

type ToolEv = Extract<ChatEvent, { kind: 'tool' }>;
type Item =
  | { t: 'event'; ev: ChatEvent }
  | { t: 'steps'; tools: ToolEv[] };

const md = (s: string) => ({ __html: DOMPurify.sanitize(marked.parse(s, { async: false }) as string) });

const PRESETS = {
  Length: ['Auto', '15 s', '30 s', '60 s'],
  Platform: ['Reels / Shorts 9:16', 'Square 1:1', 'Landscape 16:9'],
} as const;

const APPLY_TYPO = 'Apply these typography settings to the current video: rebuild only the text layers, render, and export a new version in exports/. Change nothing else.';

// per-job typography choices and the last brief sent to Claude, kept in this browser only
const typoStore = {
  get(jobId: string): { typo: Typo; applied: string } {
    try {
      const v = JSON.parse(localStorage.getItem(`reel-studio:typo:${jobId}`) || '{}');
      return { typo: { ...EMPTY_TYPO, ...v.typo }, applied: v.applied || '' };
    } catch {
      return { typo: EMPTY_TYPO, applied: '' };
    }
  },
  set(jobId: string, v: { typo: Typo; applied: string }) {
    try {
      localStorage.setItem(`reel-studio:typo:${jobId}`, JSON.stringify(v));
    } catch {}
  },
};

export function Chat({ job, events, online, onUploaded }: { job: JobMeta; events: ChatEvent[]; online: boolean; onUploaded: () => void }) {
  const [text, setText] = useState('');
  const [presets, setPresets] = useState<Record<string, string>>({});
  const [typoState, setTypoState] = useState(() => typoStore.get(job.id));
  const [typoOpen, setTypoOpen] = useState(false);
  const { cat, setFonts } = useTypography();
  const brief = typoBrief(typoState.typo, cat);
  const typoCount = typoState.typo.styles.length + Object.entries(typoState.typo).filter(([k, v]) => k !== 'styles' && v !== 'Auto').length;
  const saveTypo = (fn: (s: { typo: Typo; applied: string }) => { typo: Typo; applied: string }) =>
    setTypoState((s) => {
      const v = fn(s);
      typoStore.set(job.id, v);
      return v;
    });
  const [uploading, setUploading] = useState('');
  const [drag, setDrag] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const busy = job.status === 'running' || job.status === 'waiting';
  const firstMessage = !events.some((e) => e.kind === 'user');

  // tool calls between two messages collapse into one "steps" block
  const { items, done, answered, decided } = useMemo(() => {
    const items: Item[] = [];
    const done = new Map<string, boolean>();
    const answered = new Map<string, Record<string, string>>();
    const decided = new Map<string, boolean>();
    for (const ev of events) {
      if (ev.kind === 'tool_done') done.set(ev.id, ev.ok);
      else if (ev.kind === 'question_answered') answered.set(ev.reqId, ev.answers);
      else if (ev.kind === 'permission_done') decided.set(ev.reqId, ev.allow);
      else if (ev.kind === 'tool') {
        const last = items[items.length - 1];
        if (last?.t === 'steps') last.tools.push(ev);
        else items.push({ t: 'steps', tools: [ev] });
      } else items.push({ t: 'event', ev });
    }
    return { items, done, answered, decided };
  }, [events]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  function send() {
    const body = text.trim();
    if (!body || busy) return;
    const prefs = Object.entries(presets).filter(([, v]) => v && !v.startsWith('Auto'));
    let full = firstMessage && prefs.length ? `${body}\n\nPreferences: ${prefs.map(([k, v]) => `${k}: ${v}`).join('; ')}` : body;
    if (firstMessage && brief) {
      full += `\n\n${brief}`;
      saveTypo((s) => ({ ...s, applied: brief }));
    }
    socket.send({ type: 'send', jobId: job.id, text: full });
    setText('');
  }

  function applyTypo() {
    if (busy || !brief) return;
    socket.send({ type: 'send', jobId: job.id, text: `${APPLY_TYPO}\n\n${brief}` });
    saveTypo((s) => ({ ...s, applied: brief }));
    setTypoOpen(false);
  }

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setUploading(list.map((f) => f.name).join(', '));
    const fd = new FormData();
    list.forEach((f) => fd.append('files', f));
    try {
      const r = await fetch(`/api/jobs/${job.id}/upload`, { method: 'POST', body: fd });
      const { saved } = await r.json();
      setText((t) => `${t}${t && !t.endsWith('\n') ? '\n' : ''}${saved.map((p: string) => `Uploaded: ${p}`).join('\n')}\n`);
      onUploaded();
    } finally {
      setUploading('');
    }
  }

  return (
    <main
      className={`chat ${drag ? 'drag' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        upload(e.dataTransfer.files);
      }}
    >
      <header className="chat-head">
        <div>
          <h2>{job.name}</h2>
          <span className="muted">{job.workdir.replace(/^\/Users\/[^/]+/, '~')}</span>
        </div>
        {!online && <span className="pill error">Reconnecting…</span>}
        {busy && (
          <button className="ghost" onClick={() => socket.send({ type: 'stop', jobId: job.id })}>
            Stop
          </button>
        )}
      </header>

      <div className="log">
        {!events.length && (
          <div className="hint">
            <p>Tell Claude what to do with this edit. For example:</p>
            <ul>
              <li>“Make a 30 s reel from the raw in input/, Moon Reel text, Indian B-roll.”</li>
              <li>“Swap the end-card banner for images/new_banner.png. Change nothing else.”</li>
            </ul>
            <p className="muted">Drop files anywhere here to upload them into input/.</p>
          </div>
        )}
        {items.map((it, i) =>
          it.t === 'steps' ? (
            <Steps key={i} tools={it.tools} done={done} live={busy && i === items.length - 1} />
          ) : (
            <EventView
              key={i}
              ev={it.ev}
              job={job}
              answers={it.ev.kind === 'question' ? answered.get(it.ev.reqId) : undefined}
              decided={it.ev.kind === 'permission' ? decided.get(it.ev.reqId) : undefined}
              active={job.status === 'waiting'}
            />
          ),
        )}
        {job.status === 'running' && <div className="working"><span className="dot" /> Claude is working…</div>}
        <div ref={bottom} />
      </div>

      <footer className="composer">
        {typoOpen && <TypographyPanel value={typoState.typo} onChange={(fn) => saveTypo((s) => ({ ...s, typo: fn(s.typo) }))} cat={cat} setFonts={setFonts} />}
        <div className="typo-bar">
          <button className={`ghost typo-toggle ${typoOpen ? 'on' : ''}`} onClick={() => setTypoOpen((o) => !o)} aria-expanded={typoOpen}>
            <span className="aa">Aa</span> Text &amp; typography
            <span className="muted small">{typoCount ? ` · ${typoCount} set` : ' · Auto'}</span>
          </button>
          {!firstMessage && brief && brief !== typoState.applied && (
            <button className="primary" onClick={applyTypo} disabled={busy} title={busy ? 'Wait for Claude to finish' : undefined}>
              Apply to video
            </button>
          )}
          {firstMessage && brief && <span className="muted small">Sent with your first message.</span>}
        </div>
        {firstMessage && (
          <div className="presets">
            {Object.entries(PRESETS).map(([k, opts]) => (
              <label key={k}>
                {k}
                <select value={presets[k] || opts[0]} onChange={(e) => setPresets((p) => ({ ...p, [k]: e.target.value }))}>
                  {opts.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
        <div className="compose-row">
          <label className="ghost attach" title="Upload files into input/">
            📎
            <input type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={busy ? 'Claude is working. You can type your next message now.' : 'Write instructions for this edit… (Enter to send, Shift+Enter for a new line)'}
            rows={3}
          />
          <button className="primary" onClick={send} disabled={busy || !text.trim()}>
            Send
          </button>
        </div>
        {uploading && <div className="muted small">Uploading {uploading}…</div>}
      </footer>
    </main>
  );
}

function Steps({ tools, done, live }: { tools: ToolEv[]; done: Map<string, boolean>; live: boolean }) {
  const [open, setOpen] = useState(false);
  const last = tools[tools.length - 1];
  const failed = tools.filter((t) => done.get(t.id) === false).length;
  return (
    <div className="steps">
      <button className="steps-head" onClick={() => setOpen((o) => !o)}>
        <span className={`chev ${open ? 'open' : ''}`}>›</span>
        {live && !done.has(last.id) ? <span className="dot" /> : null}
        <span>{open ? `${tools.length} step${tools.length > 1 ? 's' : ''}` : last.summary}</span>
        <span className="muted small">
          {tools.length > 1 && !open ? ` +${tools.length - 1} more` : ''}
          {failed ? ` · ${failed} failed` : ''}
        </span>
      </button>
      {open && (
        <ul>
          {tools.map((t) => (
            <li key={t.id} className={done.get(t.id) === false ? 'fail' : ''}>
              <span className="tick">{done.has(t.id) ? (done.get(t.id) ? '✓' : '✗') : '…'}</span> {t.summary}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EventView(props: { ev: ChatEvent; job: JobMeta; answers?: Record<string, string>; decided?: boolean; active: boolean }) {
  const { ev, job } = props;
  switch (ev.kind) {
    case 'user':
      return <div className="msg user">{ev.text}</div>;
    case 'assistant':
      return <div className="msg claude" dangerouslySetInnerHTML={md(ev.text)} />;
    case 'image':
      return (
        <a className="thumb" href={`/api/jobs/${job.id}/file?path=${encodeURIComponent(ev.path)}`} target="_blank" rel="noreferrer">
          <img src={`/api/jobs/${job.id}/file?path=${encodeURIComponent(ev.path)}`} alt={ev.path} loading="lazy" />
          <span className="muted small">{ev.path}</span>
        </a>
      );
    case 'question':
      return (
        <QuestionCard
          questions={ev.questions}
          answers={props.answers}
          disabled={!props.active}
          onSubmit={(answers) => socket.send({ type: 'answer', jobId: job.id, reqId: ev.reqId, answers })}
        />
      );
    case 'permission':
      return <PermissionCard ev={ev} job={job} decided={props.decided} active={props.active} />;
    case 'result':
      return (
        <div className={`result ${ev.ok ? 'ok' : 'bad'}`}>
          {ev.ok ? 'Finished' : 'Stopped'}
          {ev.durationMs ? ` · ${Math.round(ev.durationMs / 1000)} s` : ''}
          {ev.costUsd ? ` · $${ev.costUsd.toFixed(2)}` : ''}
        </div>
      );
    case 'error':
      return <div className="result bad">{ev.message}</div>;
    default:
      return null;
  }
}

function PermissionCard({ ev, job, decided, active }: { ev: Extract<ChatEvent, { kind: 'permission' }>; job: JobMeta; decided?: boolean; active: boolean }) {
  const [reason, setReason] = useState('');
  const reply = (allow: boolean) =>
    socket.send({ type: 'permission', jobId: job.id, reqId: ev.reqId, allow, message: allow ? undefined : reason || undefined });
  return (
    <div className="card perm">
      <div className="card-title">{ev.title}</div>
      <pre>{ev.detail}</pre>
      {decided !== undefined ? (
        <div className={`muted small ${decided ? '' : 'denied'}`}>{decided ? 'Allowed' : 'Denied'}</div>
      ) : active ? (
        <div className="row">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, if denying (optional)" />
          <button className="ghost" onClick={() => reply(false)}>
            Deny
          </button>
          <button className="primary" onClick={() => reply(true)}>
            Allow
          </button>
        </div>
      ) : (
        <div className="muted small">Not answered</div>
      )}
    </div>
  );
}
