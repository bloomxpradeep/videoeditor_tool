import { useState } from 'react';

// Shown to other Macs on the network until they enter the passcode printed by `npm run studio:lan`.
export function Login() {
  const [passcode, setPasscode] = useState('');
  const [err, setErr] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passcode: passcode.trim() }),
    }).catch(() => undefined);
    if (r?.ok) location.reload();
    else setErr(r ? 'Wrong passcode' : 'Cannot reach the studio Mac');
  }

  return (
    <main className="empty login">
      <h1>Reel Studio</h1>
      <p>Enter the passcode shown on the studio Mac.</p>
      <form className="newjob" onSubmit={submit}>
        <input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} placeholder="Passcode" required autoFocus />
        {err && <div className="err">{err}</div>}
        <button className="primary" type="submit">
          Open
        </button>
      </form>
    </main>
  );
}
