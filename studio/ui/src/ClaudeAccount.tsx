import { useState } from 'react';
import type { ClaudeAccount } from '../../server/protocol';

const post = (url: string, body?: object) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then(async (r) => {
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Something went wrong');
  });

// Sidebar footer: which Claude account jobs run under on this Mac, with sign in / sign out.
export function ClaudeAccountBox({ account }: { account: ClaudeAccount }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const run = (p: Promise<unknown>) => {
    setErr('');
    p.catch((e) => setErr(e.message));
  };

  if (account.checking) return <div className="account muted small">Checking Claude account…</div>;

  if (account.login)
    return (
      <div className="account signing">
        <strong>Sign in with Claude</strong>
        <p className="small">A claude.ai tab should have opened. Sign in there with your Claude account; this updates by itself.</p>
        {account.login.url && (
          <a className="small" href={account.login.url} target="_blank" rel="noreferrer">
            Tab didn’t open? Open the sign-in page
          </a>
        )}
        <form
          className="newjob"
          onSubmit={(e) => {
            e.preventDefault();
            run(post('/api/claude/code', { code }));
            setCode('');
          }}
        >
          <small>If claude.ai shows a code instead, paste it here:</small>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste code" />
          <div className="row">
            <button className="primary" type="submit" disabled={!code.trim()}>
              Submit code
            </button>
            <button className="ghost" type="button" onClick={() => run(post('/api/claude/cancel'))}>
              Cancel
            </button>
          </div>
        </form>
        {err && <div className="err">{err}</div>}
      </div>
    );

  return (
    <div className="account">
      {account.loggedIn ? (
        <>
          <div className="small">
            <span className="ok-dot" /> Claude: <strong>{account.email || 'signed in'}</strong>
            {account.plan && <span className="muted"> · {account.plan}</span>}
          </div>
          <button className="ghost small" onClick={() => confirm('Sign this Mac out of Claude? Jobs stop working until someone signs in again.') && run(post('/api/claude/logout'))}>
            Sign out
          </button>
        </>
      ) : (
        <>
          <div className="small">{account.error || 'Claude is not signed in. Jobs need a Claude account.'}</div>
          <button className="primary wide" onClick={() => run(post('/api/claude/login'))}>
            Sign in with Claude
          </button>
        </>
      )}
      {err && <div className="err">{err}</div>}
    </div>
  );
}
