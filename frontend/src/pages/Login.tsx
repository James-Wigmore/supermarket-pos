import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Button, ErrorNote, Input } from '../components/ui';
import { useAuth } from '../lib/auth';

export const Login = () => {
  const { session, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/" replace />;

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full place-items-center bg-tape p-4">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="w-full max-w-sm space-y-4 rounded-panel bg-white p-7">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted">Use the account your manager created for you.</p>
        </div>
        <Input label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <ErrorNote error={error} />
        <Button type="submit" size="lg" className="w-full" loading={busy}>Sign in</Button>
      </form>
    </div>
  );
};
