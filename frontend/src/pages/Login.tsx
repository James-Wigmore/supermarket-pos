import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Button, ErrorNote, Input } from '../components/ui';
import { ApiError } from '../lib/api';
import { useAuth, type ApprovalState, type LoginStep } from '../lib/auth';

type Pending = Extract<LoginStep, { kind: 'emailApproval' }>;

const POLL_MS = 3000;
const MAX_BACKOFF_MS = 30_000;

const ENDED: Partial<Record<ApprovalState, string>> = {
  REJECTED: 'This sign-in was rejected. If it was not you, ask your manager to reset your password.',
  EXPIRED: 'This sign-in request expired. Sign in again to get a new email.',
  CANCELLED: 'This sign-in request was cancelled.',
  FAILED: 'The approval email could not be sent.',
};

const Card = ({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) => (
  <div className="grid min-h-full place-items-center bg-tape p-4">
    <div className="w-full max-w-sm space-y-4 rounded-panel bg-white p-7">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="text-sm text-muted">{subtitle}</p>
      </div>
      {children}
    </div>
  </div>
);

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Waits for the emailed approval: checks the status on a timer (backing off on errors), shows the time left and lets the user cancel. */
const ApprovalPending = ({ pending, onBack }: { pending: Pending; onBack: () => void }) => {
  const { checkApproval, cancelApproval } = useAuth();
  const [endsAt, setEndsAt] = useState(() => Date.now() + pending.secondsLeft * 1000);
  const [now, setNow] = useState(() => Date.now());
  const [ended, setEnded] = useState<ApprovalState>();
  const [error, setError] = useState<unknown>();
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const check = async () => {
      try {
        const { status, secondsLeft } = await checkApproval(pending.requestToken);
        if (stopped) return;
        failures = 0;
        setError(undefined);
        if (status === 'COMPLETED') return; // signed in: this screen is replaced
        if (status !== 'PENDING') return setEnded(status);
        setEndsAt(Date.now() + secondsLeft * 1000);
      } catch (err) {
        if (stopped) return;
        setError(err);
        const retry = err instanceof ApiError && (err.isNetwork || err.status === 429 || err.status >= 500);
        if (!retry) return; // a definite answer (rejected, expired, unknown request): stop asking
        failures += 1;
      }
      timer = setTimeout(() => void check(), Math.min(POLL_MS * 2 ** failures, MAX_BACKOFF_MS));
    };
    timer = setTimeout(() => void check(), POLL_MS);
    return () => { stopped = true; clearTimeout(timer); };
  }, [checkApproval, pending.requestToken]);

  const cancel = async () => {
    setCancelling(true);
    try {
      await cancelApproval(pending.requestToken);
      onBack();
    } catch (err) {
      setError(err);
    } finally {
      setCancelling(false);
    }
  };

  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const stopped = Boolean(ended) || (error instanceof ApiError && !(error.isNetwork || error.status === 429 || error.status >= 500));

  return (
    <div className="space-y-4">
      {ended ? <p role="alert" className="text-sm">{ENDED[ended]}</p> : (
        <>
          <p className="text-sm">We sent an email to <b>{pending.emailHint}</b>. Open it and press <b>Approve Login</b>. This page continues by itself.</p>
          <p className="text-center text-3xl font-bold tabular-nums" aria-label="Time left">{clock(left)}</p>
        </>
      )}
      <ErrorNote error={error} />
      {stopped
        ? <Button size="lg" className="w-full" onClick={onBack}>Sign in again</Button>
        : <Button variant="secondary" className="w-full" loading={cancelling} onClick={() => void cancel()}>Cancel sign-in</Button>}
    </div>
  );
};

export const Login = () => {
  const { session, login } = useAuth();
  const location = useLocation();
  const [step, setStep] = useState<Pending | null>(() => (location.state as { step?: Pending } | null)?.step ?? null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/" replace />;

  if (step) {
    return (
      <Card title="Approve your sign-in" subtitle="Your password was correct. One more step.">
        <ApprovalPending pending={step} onBack={() => { setStep(null); setPassword(''); setError(undefined); }} />
      </Card>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const next = await login(email.trim(), password);
      if (next.kind === 'emailApproval') setStep(next);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Sign in" subtitle="Use the account your manager created for you.">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-4">
        <Input label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <ErrorNote error={error} />
        <Button type="submit" size="lg" className="w-full" loading={busy}>Sign in</Button>
        <p className="text-center text-xs text-muted">Forgot your password? Ask your manager to reset it.</p>
      </form>
    </Card>
  );
};
