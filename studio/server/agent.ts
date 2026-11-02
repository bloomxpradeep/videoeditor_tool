// Runs one editor turn through the Claude Agent SDK (the same engine as Claude Code in the terminal) and turns its
// stream into ChatEvents. AskUserQuestion and permission prompts are parked as promises until the browser answers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { query, type CanUseTool, type McpServerConfig, type Query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { appendEvent, saveJob } from './jobs.js';
import type { ChatEvent, JobMeta, JobStatus, Question } from './protocol.js';

const MODEL = process.env.STUDIO_MODEL || 'claude-opus-5-5';
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

const STUDIO_PROMPT = `You are running inside Reel Studio, a browser chat app that video editors use instead of the terminal.
- The editor cannot see tool output or the terminal. Say in plain words what you did and where outputs were written (paths relative to the work folder).
- When a decision is genuinely the editor's, ask with AskUserQuestion; it shows as clickable cards in their chat.
- Keep progress messages short. Put finished videos in exports/ so they appear in the editor's player.
- A "Typography" block comes from the editor's text panel: follow it exactly. Its fonts are installed in ~/Library/Fonts; set them in AE by the PostScript names given.`;

// Bash commands that run without asking: the media toolchain used in every edit, plus read-only shell basics.
const SAFE_BASH = new Set([
  'ffmpeg', 'ffprobe', 'python', 'python3', 'osascript', 'aerender', 'whisper', 'sips', 'ls', 'cat', 'head', 'tail',
  'wc', 'grep', 'find', 'mkdir', 'cp', 'echo', 'cd', 'pwd', 'stat', 'file', 'du', 'sed', 'awk', 'sort', 'uniq',
  'date', 'sleep', 'test', 'true', 'for', 'do', 'done', 'if', 'then', 'fi', 'printf', 'node', 'mdls', 'open',
]);
const SAFE_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Skill', 'ToolSearch', 'TodoWrite', 'EnterPlanMode', 'ExitPlanMode',
  'Monitor', 'ListMcpResourcesTool', 'ReadMcpResourceTool',
]);

/** The premiere-pro server exactly as the user's Claude Code has it configured (command + env from ~/.claude.json). */
function userMcpServers(): Record<string, McpServerConfig> {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
    const servers = cfg.mcpServers || {};
    return servers['premiere-pro'] ? { 'premiere-pro': servers['premiere-pro'] } : {};
  } catch {
    return {};
  }
}

function bashIsSafe(cmd: string): boolean {
  // every segment between ; && || | must start with a known command (paths allowed: /x/y/aerender -> aerender)
  return cmd
    .split(/;|&&|\|\||\||\n/)
    .map((s) => s.trim().replace(/^(\w+=\S*\s+)+/, '')) // drop leading VAR=value
    .filter(Boolean)
    .every((s) => {
      const first = s.split(/\s+/)[0].replace(/^["']|["']$/g, '');
      return SAFE_BASH.has(path.basename(first));
    });
}

function summarize(name: string, input: Record<string, any>): string {
  if (name === 'Bash') return input.description || String(input.command).slice(0, 120);
  if (['Read', 'Write', 'Edit'].includes(name)) return `${name} ${path.basename(String(input.file_path))}`;
  if (name.startsWith('mcp__premiere-pro__')) {
    const tool = name.slice('mcp__premiere-pro__'.length);
    return `Premiere: ${tool === 'invoke_tool' ? input.name : tool}`.replace(/_/g, ' ');
  }
  if (name === 'Skill') return `Skill: ${input.skill}`;
  if (name === 'Agent') return `Sub-agent: ${input.description}`;
  return name;
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c: any) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n');
  return '';
}

type Emit = (ev: ChatEvent) => void;

export class JobRunner {
  private q?: Query;
  private pending = new Map<string, (v: any) => void>();

  constructor(
    public meta: JobMeta,
    private broadcast: (jobId: string, ev: ChatEvent | { status: JobStatus } | { filesChanged: true }) => void,
  ) {}

  get running() {
    return !!this.q;
  }

  private emit: Emit = (ev) => {
    appendEvent(this.meta.id, ev);
    this.broadcast(this.meta.id, ev);
  };

  private setStatus(status: JobStatus) {
    this.meta.status = status;
    saveJob(this.meta);
    this.broadcast(this.meta.id, { status });
  }

  answerQuestion(reqId: string, answers: Record<string, string>) {
    const r = this.pending.get(reqId);
    if (!r) return;
    this.pending.delete(reqId);
    this.emit({ kind: 'question_answered', reqId, answers, at: Date.now() });
    r(answers);
  }

  answerPermission(reqId: string, allow: boolean, message?: string) {
    const r = this.pending.get(reqId);
    if (!r) return;
    this.pending.delete(reqId);
    this.emit({ kind: 'permission_done', reqId, allow, at: Date.now() });
    r({ allow, message });
  }

  async stop() {
    for (const [id, r] of this.pending) r(null), this.pending.delete(id);
    await this.q?.interrupt().catch(() => {});
  }

  private ask<T>(ev: ChatEvent & { reqId: string }, signal: AbortSignal): Promise<T | null> {
    return new Promise((resolve) => {
      this.pending.set(ev.reqId, resolve);
      signal.addEventListener('abort', () => {
        if (this.pending.delete(ev.reqId)) resolve(null);
      });
      this.setStatus('waiting');
      this.emit(ev);
    }).then((v) => {
      if (this.q) this.setStatus('running');
      return v as T | null;
    });
  }

  private canUseTool: CanUseTool = async (toolName, input, { signal, title }) => {
    if (toolName === 'AskUserQuestion') {
      const reqId = crypto.randomUUID();
      const answers = await this.ask<Record<string, string>>(
        { kind: 'question', reqId, questions: (input.questions as Question[]) || [], at: Date.now() },
        signal,
      );
      if (!answers) return { behavior: 'deny', message: 'The editor dismissed the question.' };
      return { behavior: 'allow', updatedInput: { ...input, answers } };
    }
    if (SAFE_TOOLS.has(toolName) || toolName.startsWith('mcp__premiere-pro__')) {
      return { behavior: 'allow', updatedInput: input };
    }
    const filePath = typeof input.file_path === 'string' ? path.resolve(input.file_path) : '';
    const inside = (dir: string) => filePath.startsWith(dir + path.sep);
    if (['Write', 'Edit', 'NotebookEdit'].includes(toolName) && (inside(this.meta.workdir) || inside(path.join(os.homedir(), 'Movies')))) {
      return { behavior: 'allow', updatedInput: input };
    }
    if (toolName === 'Bash' && bashIsSafe(String(input.command || ''))) {
      return { behavior: 'allow', updatedInput: input };
    }
    const reqId = crypto.randomUUID();
    const detail = toolName === 'Bash' ? String(input.command) : JSON.stringify(input, null, 2).slice(0, 1500);
    const reply = await this.ask<{ allow: boolean; message?: string }>(
      { kind: 'permission', reqId, tool: toolName, title: title || `Claude wants to use ${toolName}`, detail, at: Date.now() },
      signal,
    );
    if (reply?.allow) return { behavior: 'allow', updatedInput: input };
    return { behavior: 'deny', message: reply?.message || 'The editor denied this action.' };
  };

  /** Run one editor message to completion. Resumes the job's session so context carries across turns. */
  async send(text: string) {
    if (this.q) throw new Error('Claude is still working on this job');
    this.emit({ kind: 'user', text, at: Date.now() });
    this.setStatus('running');
    let ok = false;
    try {
      this.q = query({
        prompt: text,
        options: {
          cwd: this.meta.workdir,
          model: MODEL,
          resume: this.meta.sessionId,
          settingSources: ['user', 'project', 'local'],
          systemPrompt: { type: 'preset', preset: 'claude_code', append: STUDIO_PROMPT },
          mcpServers: userMcpServers(),
          permissionMode: 'default',
          canUseTool: this.canUseTool,
        },
      });
      for await (const msg of this.q) ok = this.handle(msg) ?? ok;
    } catch (e: any) {
      this.emit({ kind: 'error', message: e?.message || String(e), at: Date.now() });
    } finally {
      this.q = undefined;
      for (const [id, r] of this.pending) r(null), this.pending.delete(id);
      this.setStatus(ok ? 'done' : 'error');
      this.broadcast(this.meta.id, { filesChanged: true });
    }
  }

  private handle(msg: SDKMessage): boolean | void {
    if ('session_id' in msg && msg.session_id && msg.session_id !== this.meta.sessionId) {
      this.meta.sessionId = msg.session_id;
      saveJob(this.meta);
    }
    const now = Date.now();
    if (msg.type === 'assistant' && !msg.parent_tool_use_id) {
      for (const b of msg.message.content as any[]) {
        if (b.type === 'text' && b.text.trim()) this.emit({ kind: 'assistant', text: b.text, at: now });
        if (b.type === 'tool_use' && b.name !== 'AskUserQuestion') {
          this.emit({ kind: 'tool', id: b.id, name: b.name, summary: summarize(b.name, b.input || {}), at: now });
          if (b.name === 'Read' && IMAGE_EXT.test(String(b.input?.file_path))) {
            const rel = path.relative(this.meta.workdir, path.resolve(this.meta.workdir, b.input.file_path));
            if (!rel.startsWith('..')) this.emit({ kind: 'image', path: rel, at: now });
          }
        }
      }
    } else if (msg.type === 'user' && !msg.parent_tool_use_id && Array.isArray(msg.message.content)) {
      for (const b of msg.message.content as any[]) {
        if (b.type !== 'tool_result') continue;
        this.emit({ kind: 'tool_done', id: b.tool_use_id, ok: !b.is_error, preview: resultText(b.content).slice(0, 600), at: now });
      }
      this.broadcast(this.meta.id, { filesChanged: true });
    } else if (msg.type === 'result') {
      const ok = msg.subtype === 'success';
      if (!ok) this.emit({ kind: 'error', message: `Run ended: ${msg.subtype}`, at: now });
      this.emit({ kind: 'result', ok, costUsd: msg.total_cost_usd, durationMs: msg.duration_ms, at: now });
      return ok;
    }
  }
}
