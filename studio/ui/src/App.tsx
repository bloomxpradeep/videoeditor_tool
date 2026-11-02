import { useEffect, useState } from 'react';
import type { ChatEvent, FileEntry, JobMeta } from '../../server/protocol';
import { socket } from './ws';
import { JobSidebar } from './JobSidebar';
import { Chat } from './Chat';
import { FilesPanel } from './FilesPanel';

const LAST_JOB = 'reel-studio:job';
const store = {
  get: () => {
    try {
      return localStorage.getItem(LAST_JOB) || '';
    } catch {
      return '';
    }
  },
  set: (v: string) => {
    try {
      localStorage.setItem(LAST_JOB, v);
    } catch {}
  },
};

function notify(title: string, body: string) {
  if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
  new Notification(title, { body });
}

export function App() {
  const [jobs, setJobs] = useState<JobMeta[]>([]);
  const [jobId, setJobId] = useState(store.get());
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [online, setOnline] = useState(socket.connected);
  const job = jobs.find((j) => j.id === jobId);
  const jobIdRef = useRefValue(jobId);

  useEffect(() => {
    socket.onConnection = setOnline;
    setOnline(socket.connected); // the socket may have opened before this effect ran
    return socket.on((m) => {
      if (m.type === 'jobs') setJobs(m.jobs);
      else if (m.type === 'history' && m.jobId === jobIdRef.current) setEvents(m.events);
      else if (m.type === 'event' && m.jobId === jobIdRef.current) {
        setEvents((ev) => [...ev, m.event]);
        if (m.event.kind === 'question') notify('Claude has a question', m.event.questions[0]?.question || '');
        if (m.event.kind === 'permission') notify('Claude needs permission', m.event.title);
        if (m.event.kind === 'result') notify('Reel Studio', m.event.ok ? 'Claude finished' : 'The run stopped');
      } else if (m.type === 'files_changed' && m.jobId === jobIdRef.current) loadFiles(m.jobId);
    });
  }, []);

  function loadFiles(id: string) {
    fetch(`/api/jobs/${id}/files`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setFiles)
      .catch(() => setFiles([]));
  }

  useEffect(() => {
    setEvents([]);
    setFiles([]);
    store.set(jobId);
    if (!jobId) return;
    socket.send({ type: 'subscribe', jobId });
    loadFiles(jobId);
  }, [jobId]);

  const waiting = jobs.filter((j) => j.status === 'waiting').length;
  useEffect(() => {
    document.title = waiting ? `(${waiting}) Reel Studio` : 'Reel Studio';
  }, [waiting]);

  async function createJob(name: string, workdir: string) {
    const r = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, workdir }),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || 'Could not create the job');
    setJobs((js) => [body, ...js.filter((j) => j.id !== body.id)]);
    setJobId(body.id);
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  }

  return (
    <div className="app">
      <JobSidebar jobs={jobs} current={jobId} onPick={setJobId} onCreate={createJob} />
      {job ? (
        <>
          <Chat key={job.id} job={job} events={events} online={online} onUploaded={() => loadFiles(job.id)} />
          <FilesPanel job={job} files={files} events={events} />
        </>
      ) : (
        <main className="empty">
          <h1>Reel Studio</h1>
          <p>Create a job from the sidebar. Point it at an edit folder (an existing one or a new one), then tell Claude what to make.</p>
        </main>
      )}
    </div>
  );
}

// keeps the latest value readable from long-lived socket callbacks
function useRefValue<T>(v: T) {
  const [ref] = useState(() => ({ current: v }));
  ref.current = v;
  return ref;
}
