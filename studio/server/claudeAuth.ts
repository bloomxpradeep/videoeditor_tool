// Claude account for this Mac, driven through the claude binary the Agent SDK ships with. The login lands in the
// macOS keychain, which every job's query() already reads, so signing in here is all a new Mac needs.
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import type { ClaudeAccount } from './protocol.js';

const require = createRequire(import.meta.url);

/** The SDK's bundled binary for this Mac's CPU, else a claude on PATH. */
function claudeBin(): string {
  try {
    return require.resolve(`@anthropic-ai/claude-agent-sdk-darwin-${process.arch}/claude`);
  } catch {
    return 'claude';
  }
}

let login: { proc: ChildProcess; url?: string } | undefined;
let account: ClaudeAccount = { loggedIn: false, checking: true };
let onChange: (a: ClaudeAccount) => void = () => {};

export function watchAccount(cb: (a: ClaudeAccount) => void) {
  onChange = cb;
}

function publish(next: ClaudeAccount) {
  account = next;
  onChange(account);
}

const withLogin = (a: ClaudeAccount): ClaudeAccount => {
  const { login: _, ...rest } = a;
  return login ? { ...rest, login: { url: login.url } } : rest;
};

export function currentAccount(): ClaudeAccount {
  return account;
}

export function refreshAccount(): Promise<ClaudeAccount> {
  return new Promise((resolve) => {
    execFile(claudeBin(), ['auth', 'status', '--json'], { timeout: 20000 }, (err, stdout) => {
      let next: ClaudeAccount = { loggedIn: false };
      try {
        const s = JSON.parse(stdout);
        next = { loggedIn: !!s.loggedIn, email: s.email, plan: s.subscriptionType, method: s.authMethod };
      } catch {
        if (err) next.error = 'Could not run Claude. Run npm run studio:setup again.';
      }
      publish(withLogin(next));
      resolve(account);
    });
  });
}

/**
 * Start `claude auth login`. It opens claude.ai in this Mac's browser and finishes by itself once the editor signs
 * in; the link it prints and the paste-code input cover the case where that tab never opened or can't call back.
 */
export function startLogin() {
  if (login) return;
  const proc = spawn(claudeBin(), ['auth', 'login', '--claudeai'], { stdio: ['pipe', 'pipe', 'pipe'] });
  login = { proc };
  let out = '';
  const read = (b: Buffer) => {
    out += b.toString();
    const url = /https:\/\/\S*oauth\/authorize\S*/.exec(out)?.[0];
    if (url && login && !login.url) {
      login.url = url;
      publish(withLogin(account));
    }
  };
  proc.stdout!.on('data', read);
  proc.stderr!.on('data', read);
  proc.on('exit', () => {
    login = undefined;
    refreshAccount();
  });
  publish(withLogin(account));
}

/** The code claude.ai shows after signing in, for when the browser could not hand it back on its own. */
export function submitCode(code: string) {
  login?.proc.stdin?.write(code.trim() + '\n');
}

export function cancelLogin() {
  login?.proc.kill();
}

export function logout(): Promise<ClaudeAccount> {
  return new Promise((resolve) => execFile(claudeBin(), ['auth', 'logout'], { timeout: 20000 }, () => resolve(refreshAccount())));
}
