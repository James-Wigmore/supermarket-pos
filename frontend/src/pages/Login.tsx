import { useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { TwoFactorEnrolment } from '../components/TwoFactorEnrolment';
import { Button, ErrorNote, Input } from '../components/ui';
import { useAuth, type LoginStep } from '../lib/auth';

type Step = { kind: 'credentials' } | Exclude<LoginStep, { kind: 'done' }>;

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

const CodeStep = ({ challengeToken, onBack }: { challengeToken: string; onBack: () => void }) => {
  const { verifyCode } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try { await verifyCode(challengeToken, code.trim()); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-4">
      <Input label="Authenticator code" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} hint="The 6-digit code from your app, or one of your recovery codes" autoFocus required />
      <ErrorNote error={error} />
      <Button type="submit" size="lg" className="w-full" loading={busy} disabled={code.trim().length < 6}>Verify</Button>
      <Button variant="ghost" className="w-full" onClick={onBack}>Use a different account</Button>
    </form>
  );
};

export const Login = () => {
  const { session, login, startSession } = useAuth();
  const location = useLocation();
  const [step, setStep] = useState<Step>(() => (location.state as { step?: Step } | null)?.step ?? { kind: 'credentials' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/" replace />;
  const restart = () => { setStep({ kind: 'credentials' }); setPassword(''); };

  if (step.kind === 'code') {
    return <Card title="Two-step verification" subtitle="Enter the code from your authenticator app."><CodeStep challengeToken={step.challengeToken} onBack={restart} /></Card>;
  }
  if (step.kind === 'setup') {
    return (
      <Card title="Set up two-factor authentication" subtitle="Your role requires a second step at sign-in. This takes a minute.">
        <TwoFactorEnrolment setupToken={step.setupToken} onCancel={restart} onDone={({ session: s }) => (s ? startSession(s) : restart())} />
      </Card>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const next = await login(email.trim(), password);
      if (next.kind !== 'done') setStep(next);
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
