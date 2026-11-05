import { useState } from 'react';
import type { ClaudeAccount, JobMeta, JobStatus } from '../../server/protocol';
import { ClaudeAccountBox } from './ClaudeAccount';

const LABEL: Record<JobStatus, string> = {
  idle: 'New',
  running: 'Working',
  waiting: 'Needs you',
  done: 'Done',
  error: 'Stopped',
};

export function JobSidebar(props: {
  jobs: JobMeta[];
  current: string;
  account: ClaudeAccount;
  onPick: (id: string) => void;
  onCreate: (name: string, workdir: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [workdir, setWorkdir] = useState('~/Movies/');
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      await props.onCreate(name.trim(), workdir.trim());
      setAdding(false);
      setName('');
      setWorkdir('~/Movies/');
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <aside className="sidebar">
      <div className="brand">Reel Studio</div>
      <button className="primary wide" onClick={() => setAdding((a) => !a)}>
        {adding ? 'Cancel' : '+ New job'}
      </button>
      {adding && (
        <form className="newjob" onSubmit={submit}>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Potli Diwali reel" required autoFocus />
          </label>
          <label>
            Edit folder
            <input value={workdir} onChange={(e) => setWorkdir(e.target.value)} placeholder="~/Movies/client/project_edit" required />
          </label>
          <small>
            A folder on the studio Mac. Use an existing edit folder to continue a project, or a new path to start one, then drop your
            footage into the chat.
          </small>
          {err && <div className="err">{err}</div>}
          <button className="primary" type="submit">
            Create
          </button>
        </form>
      )}
      <nav>
        {props.jobs.map((j) => (
          <button key={j.id} className={`job ${j.id === props.current ? 'active' : ''}`} onClick={() => props.onPick(j.id)}>
            <span className="job-name">{j.name}</span>
            <span className={`pill ${j.status}`}>{LABEL[j.status]}</span>
            <span className="job-dir">{j.workdir.replace(/^\/Users\/[^/]+/, '~')}</span>
          </button>
        ))}
        {!props.jobs.length && !adding && <p className="muted pad">No jobs yet.</p>}
      </nav>
      <ClaudeAccountBox account={props.account} />
    </aside>
  );
}
