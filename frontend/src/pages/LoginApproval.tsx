
import { useState } from 'react';

type Decision = 'approve' | 'reject';

export default function LoginApproval() {
  const [token] = useState(
    () => new URLSearchParams(window.location.search).get('token') ?? '',
  );
  const [message, setMessage] = useState(
    'Review this request before approving the login.',
  );
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);

  const decide = async (decision: Decision) => {
    if (!token || busy || finished) return;

    setBusy(true);

    try {
      const response = await fetch(
        `/api/auth/login/approval/${decision === 'approve' ? 'confirm' : 'reject'}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        },
      );

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.message ?? 'This request is invalid or expired.');
      }

      setMessage(
        decision === 'approve'
          ? 'Login approved. Return to the device that requested it.'
          : 'Login request rejected.',
      );
      setFinished(true);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Unable to process the request.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return <main><h1>Login approval</h1><p>Approval token is missing.</p></main>;
  }

  return (
    <main>
      <h1>POS login approval</h1>
      <p>{message}</p>

      {!finished && (
        <div>
          <button disabled={busy} onClick={() => decide('approve')}>
            {busy ? 'Processing…' : 'Approve login'}
          </button>

          <button disabled={busy} onClick={() => decide('reject')}>
            Reject login
          </button>
        </div>
      )}
    </main>
  );
}
