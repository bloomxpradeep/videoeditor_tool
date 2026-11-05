import { useEffect, useState } from 'react';
import type { ChatEvent, FileEntry, JobMeta } from '../../server/protocol';

const url = (job: JobMeta, p: string, v?: number) => `/api/jobs/${job.id}/file?path=${encodeURIComponent(p)}${v ? `&v=${Math.round(v)}` : ''}`;
const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const when = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function FilesPanel({ job, files, events }: { job: JobMeta; files: FileEntry[]; events: ChatEvent[] }) {
  const exportsVideos = files.filter((f) => f.type === 'video' && f.path.startsWith('exports/'));
  const latest = exportsVideos[0] || files.find((f) => f.type === 'video');
  const [picked, setPicked] = useState('');
  const playing = files.find((f) => f.path === picked) || latest;
  const setPlaying = (f: FileEntry) => setPicked(f.path);

  // a new export takes over the player
  useEffect(() => setPicked(''), [latest?.path, latest?.mtime]);

  const qcImages = events.filter((e): e is Extract<ChatEvent, { kind: 'image' }> => e.kind === 'image').slice(-6).reverse();
  const others = files.filter((f) => f !== playing);

  return (
    <aside className="files">
      <h3>Output</h3>
      {playing ? (
        playing.type === 'video' ? (
          <div className="player">
            <video key={playing.path + playing.mtime} src={url(job, playing.path, playing.mtime)} controls playsInline />
            <div className="row between">
              <span className="small">{playing.path}</span>
              <a className="small" href={url(job, playing.path, playing.mtime)} download>
                Download
              </a>
            </div>
          </div>
        ) : (
          <img className="player" src={url(job, playing.path, playing.mtime)} alt={playing.path} />
        )
      ) : (
        <p className="muted small">Finished videos in exports/ appear here.</p>
      )}

      {qcImages.length > 0 && (
        <>
          <h3>Frames Claude checked</h3>
          <div className="grid">
            {qcImages.map((e, i) => (
              <a key={i} href={url(job, e.path)} target="_blank" rel="noreferrer" title={e.path}>
                <img src={url(job, e.path)} alt={e.path} loading="lazy" />
              </a>
            ))}
          </div>
        </>
      )}

      <div className="row between">
        <h3>Files</h3>
        {exportsVideos.length > 0 && (
          <a className="small" href={`/api/jobs/${job.id}/zip`} download title="Exports and the Premiere project as one zip">
            Download all
          </a>
        )}
      </div>
      <ul className="filelist">
        {others.map((f) => (
          <li key={f.path}>
            <button onClick={() => setPlaying(f)}>
              <span className="ficon">{f.type === 'video' ? '▶' : '▣'}</span>
              <span className="fname">{f.path}</span>
              <span className="muted small">
                {size(f.size)} · {when(f.mtime)}
              </span>
            </button>
          </li>
        ))}
        {!others.length && <li className="muted small">Nothing yet.</li>}
      </ul>
    </aside>
  );
}
