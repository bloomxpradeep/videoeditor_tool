// Reel Studio server: REST for jobs and files, WebSocket for the live chat. Binds to localhost only.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import { createJob, getJob, listFiles, listJobs, readEvents, resolveInWorkdir, saveJob } from './jobs.js';
import { JobRunner } from './agent.js';
import { FONT_DIR, fontFile, installGoogleFont, listFonts, listStyles, styleThumb } from './typography.js';
import type { ClientMsg, ServerMsg } from './protocol.js';

const PORT = Number(process.env.STUDIO_PORT || 8787);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_DIST = path.join(HERE, '../ui/dist');

const app = express();
app.use(express.json());

const runners = new Map<string, JobRunner>();
const subs = new Map<WebSocket, string>(); // socket -> job it is viewing

function send(ws: WebSocket, m: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
}
function toAll(m: ServerMsg, jobId?: string) {
  for (const [ws, viewing] of subs) if (!jobId || viewing === jobId) send(ws, m);
}

function runner(jobId: string): JobRunner | undefined {
  let r = runners.get(jobId);
  if (!r) {
    const meta = getJob(jobId);
    if (!meta) return undefined;
    r = new JobRunner(meta, (id, ev) => {
      if ('status' in ev) {
        toAll({ type: 'status', jobId: id, status: ev.status });
        toAll({ type: 'jobs', jobs: listJobs() });
      } else if ('filesChanged' in ev) toAll({ type: 'files_changed', jobId: id }, id);
      else toAll({ type: 'event', jobId: id, event: ev }, id);
    });
    runners.set(jobId, r);
  }
  return r;
}

// A server restart kills any run that was in flight.
for (const j of listJobs()) if (j.status === 'running' || j.status === 'waiting') saveJob({ ...j, status: 'error' });

app.get('/api/jobs', (_req, res) => res.json(listJobs()));

app.post('/api/jobs', (req, res) => {
  try {
    const { name, workdir } = req.body || {};
    if (!name || !workdir) return res.status(400).json({ error: 'name and workdir are required' });
    const meta = createJob(String(name), String(workdir));
    toAll({ type: 'jobs', jobs: listJobs() });
    res.json(meta);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/jobs/:id/files', (req, res) => {
  const meta = getJob(req.params.id);
  if (!meta) return res.sendStatus(404);
  res.json(listFiles(meta));
});

app.get('/api/jobs/:id/file', (req, res) => {
  const meta = getJob(req.params.id);
  const abs = meta && resolveInWorkdir(meta, String(req.query.path || ''));
  if (!abs || !fs.existsSync(abs)) return res.sendStatus(404);
  res.sendFile(abs, { dotfiles: 'deny' }); // handles Range requests, so videos seek
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const meta = getJob(req.params.id as string);
      if (!meta) return cb(new Error('no such job'), '');
      const dir = path.join(meta.workdir, 'input');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => cb(null, path.basename(Buffer.from(file.originalname, 'latin1').toString('utf8'))),
  }),
});
app.post('/api/jobs/:id/upload', upload.array('files'), (req, res) => {
  toAll({ type: 'files_changed', jobId: req.params.id as string }, req.params.id as string);
  res.json({ saved: ((req.files as Express.Multer.File[]) || []).map((f) => path.join('input', f.filename)) });
});

app.get('/api/typography', (_req, res) => res.json({ styles: listStyles(), fonts: listFonts() }));

app.get('/api/typography/thumb/:id', async (req, res) => {
  const p = await styleThumb(req.params.id);
  if (!p) return res.sendStatus(404);
  res.sendFile(p);
});

app.get('/api/fonts/file', (req, res) => {
  const p = fontFile(String(req.query.path || ''));
  if (!p) return res.sendStatus(404);
  res.sendFile(p);
});

app.post('/api/fonts/google', async (req, res) => {
  try {
    const files = await installGoogleFont(String(req.body?.family || ''));
    res.json({ files, fonts: listFonts() });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

const fontUpload = multer({
  limits: { fileSize: 30e6 },
  fileFilter: (_req, file, cb) => cb(null, /\.(ttf|otf)$/i.test(file.originalname)),
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, FONT_DIR),
    filename: (_req, file, cb) => cb(null, path.basename(Buffer.from(file.originalname, 'latin1').toString('utf8'))),
  }),
});
app.post('/api/fonts/upload', fontUpload.array('files'), (req, res) => {
  const files = ((req.files as Express.Multer.File[]) || []).map((f) => f.filename);
  if (!files.length) return res.status(400).json({ error: 'Only .ttf and .otf font files can be added' });
  res.json({ files, fonts: listFonts() });
});

if (fs.existsSync(UI_DIST)) {
  app.use(express.static(UI_DIST));
  app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile(path.join(UI_DIST, 'index.html')));
}

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  subs.set(ws, '');
  send(ws, { type: 'jobs', jobs: listJobs() });
  ws.on('close', () => subs.delete(ws));
  ws.on('message', (raw) => {
    let m: ClientMsg;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    const r = runner(m.jobId);
    if (!r) return;
    switch (m.type) {
      case 'subscribe':
        subs.set(ws, m.jobId);
        send(ws, { type: 'history', jobId: m.jobId, events: readEvents(m.jobId) });
        break;
      case 'send':
        if (r.running) break;
        r.send(m.text).catch(() => {});
        break;
      case 'answer':
        r.answerQuestion(m.reqId, m.answers);
        break;
      case 'permission':
        r.answerPermission(m.reqId, m.allow, m.message);
        break;
      case 'stop':
        r.stop();
        break;
    }
  });
});

// Loopback only, on IPv4 and IPv6, so http://localhost works whichever one macOS resolves it to.
for (const host of ['127.0.0.1', '::1']) {
  const server = http.createServer(app);
  server.on('upgrade', (req, sock, head) => {
    if (req.url?.split('?')[0] !== '/ws') return sock.destroy();
    wss.handleUpgrade(req, sock, head, (ws) => wss.emit('connection', ws, req));
  });
  server.on('error', (e: NodeJS.ErrnoException) => {
    if (host === '::1' && e.code === 'EADDRNOTAVAIL') return; // no IPv6 loopback on this machine
    throw e;
  });
  server.listen(PORT, host, () => host === '127.0.0.1' && console.log(`Reel Studio is open at http://localhost:${PORT}`));
}
