// Job store: ~/Movies/_studio/jobs/<id>/{meta.json, chat.jsonl}. The edit itself lives in the job's workdir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { ChatEvent, FileEntry, JobMeta } from './protocol.js';

export const JOBS_DIR = process.env.STUDIO_JOBS_DIR || path.join(os.homedir(), 'Movies/_studio/jobs');
const VIDEO = new Set(['.mp4', '.mov', '.m4v', '.webm']);
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

fs.mkdirSync(JOBS_DIR, { recursive: true });

const jobDir = (id: string) => path.join(JOBS_DIR, id);

export function listJobs(): JobMeta[] {
  return fs
    .readdirSync(JOBS_DIR)
    .map((id) => getJob(id))
    .filter((j): j is JobMeta => !!j)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getJob(id: string): JobMeta | undefined {
  if (!/^[a-z0-9-]+$/.test(id)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(path.join(jobDir(id), 'meta.json'), 'utf8'));
  } catch {
    return undefined;
  }
}

export function saveJob(meta: JobMeta) {
  meta.updatedAt = Date.now();
  fs.writeFileSync(path.join(jobDir(meta.id), 'meta.json'), JSON.stringify(meta, null, 2));
}

export function createJob(name: string, workdir: string): JobMeta {
  const abs = path.resolve(workdir.replace(/^~(?=$|\/)/, os.homedir()));
  if (!abs.startsWith(os.homedir() + path.sep)) throw new Error('Work folder must be inside your home folder');
  fs.mkdirSync(abs, { recursive: true });
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'job';
  const id = `${slug}-${crypto.randomBytes(3).toString('hex')}`;
  fs.mkdirSync(jobDir(id), { recursive: true });
  const meta: JobMeta = { id, name, workdir: abs, status: 'idle', createdAt: Date.now(), updatedAt: Date.now() };
  saveJob(meta);
  return meta;
}

export function appendEvent(id: string, ev: ChatEvent) {
  fs.appendFileSync(path.join(jobDir(id), 'chat.jsonl'), JSON.stringify(ev) + '\n');
}

export function readEvents(id: string): ChatEvent[] {
  try {
    return fs
      .readFileSync(path.join(jobDir(id), 'chat.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

/** Resolve a path the browser asked for; only files inside the job's workdir are served. */
export function resolveInWorkdir(meta: JobMeta, p: string): string | undefined {
  const abs = path.resolve(meta.workdir, p);
  return abs === meta.workdir || abs.startsWith(meta.workdir + path.sep) ? abs : undefined;
}

/** Media in the folders editors care about: exports/, input/, images/ and the workdir root. */
export function listFiles(meta: JobMeta): FileEntry[] {
  const out: FileEntry[] = [];
  for (const sub of ['', 'exports', 'input', 'images']) {
    const dir = path.join(meta.workdir, sub);
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names) {
      const ext = path.extname(n).toLowerCase();
      const type = VIDEO.has(ext) ? 'video' : IMAGE.has(ext) ? 'image' : 'other';
      if (type === 'other' || n.startsWith('.')) continue;
      const st = fs.statSync(path.join(dir, n));
      if (st.isFile()) out.push({ path: path.join(sub, n), size: st.size, mtime: st.mtimeMs, type });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}
