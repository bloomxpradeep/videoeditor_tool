// Messages between the Reel Studio server and the browser. Shared by server/ and ui/.

export type JobStatus = 'idle' | 'running' | 'waiting' | 'done' | 'error';

export interface JobMeta {
  id: string;
  name: string;
  workdir: string;
  sessionId?: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
}

export interface QuestionOption {
  label: string;
  description: string;
  preview?: string;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

// One entry in a job's chat log (chat.jsonl). The UI rebuilds the whole conversation from these.
export type ChatEvent =
  | { kind: 'user'; text: string; at: number }
  | { kind: 'assistant'; text: string; at: number }
  | { kind: 'tool'; id: string; name: string; summary: string; at: number }
  | { kind: 'tool_done'; id: string; ok: boolean; preview: string; at: number }
  | { kind: 'image'; path: string; at: number }
  | { kind: 'question'; reqId: string; questions: Question[]; at: number }
  | { kind: 'question_answered'; reqId: string; answers: Record<string, string>; at: number }
  | { kind: 'permission'; reqId: string; tool: string; title: string; detail: string; at: number }
  | { kind: 'permission_done'; reqId: string; allow: boolean; at: number }
  | { kind: 'result'; ok: boolean; costUsd?: number; durationMs?: number; at: number }
  | { kind: 'error'; message: string; at: number };

export interface FileEntry {
  path: string; // relative to the job's workdir
  size: number;
  mtime: number;
  type: 'video' | 'image' | 'other';
}

// Typography panel: the text looks Claude can build, and the fonts installed in ~/Library/Fonts.
export interface TextStyle {
  id: string;
  name: string;
  bestFor: string;
  ref: string; // where the look is already built, passed to Claude with the choice
}

export interface FontFamily {
  family: string;
  files: string[]; // relative to ~/Library/Fonts
  postscript: string[];
}

export type ServerMsg =
  | { type: 'jobs'; jobs: JobMeta[] }
  | { type: 'history'; jobId: string; events: ChatEvent[] }
  | { type: 'event'; jobId: string; event: ChatEvent }
  | { type: 'status'; jobId: string; status: JobStatus }
  | { type: 'files_changed'; jobId: string };

export type ClientMsg =
  | { type: 'subscribe'; jobId: string }
  | { type: 'send'; jobId: string; text: string }
  | { type: 'answer'; jobId: string; reqId: string; answers: Record<string, string> }
  | { type: 'permission'; jobId: string; reqId: string; allow: boolean; message?: string }
  | { type: 'stop'; jobId: string };
