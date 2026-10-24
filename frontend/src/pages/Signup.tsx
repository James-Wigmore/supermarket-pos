import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Button, ErrorNote, Input, Select } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

type Branch = { id: string; name: string };

const INITIAL = { name: '', email: '', branchId: '', password: '', confirm: '' };

export const Signup = () => {
  const { session, login } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState(INITIAL);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const branches = useQuery({ queryKey: ['signup-branches'], queryFn: () => api<Branch[]>('/auth/branches') });

  if (session) return <Navigate to="/" replace />;

  const set = <K extends keyof typeof INITIAL>(key: K, value: (typeof INITIAL)[K]) => setF((prev) => ({ ...prev, [key]: value }));
  const ready = f.name.trim() && f.email.includes('@') && f.password.length >= 8 && f.password === f.confirm && Boolean(f.branchId);

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      await api('/auth/signup', {
        method: 'POST',
        body: {
          name: f.name.trim(),
          email: f.email.trim().toLowerCase(),
          password: f.password,
          branchId: f.branchId,
        },
      });
      const next = await login(f.email.trim().toLowerCase(), f.password);
      if (next.kind === 'done') navigate('/', { replace: true });
      else navigate('/login', { replace: true, state: { step: next } });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full place-items-center bg-tape p-4">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="w-full max-w-md space-y-4 rounded-panel bg-white p-7">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Create account</h1>
          <p className="text-sm text-muted">Open a cashier account for your branch. You can sign in right after.</p>
        </div>
        <Input label="Your name" value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus required />
        <Input label="Email" type="email" autoComplete="username" value={f.email} onChange={(e) => set('email', e.target.value)} required />
        <Select label="Branch" value={f.branchId} onChange={(e) => set('branchId', e.target.value)} disabled={!branches.data?.length} required>
          <option value="">{branches.isLoading ? 'Loading branches…' : branches.data?.length ? 'Select a branch' : 'No branch available'}</option>
          {branches.data?.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </Select>
        <Input label="Password" type="password" autoComplete="new-password" value={f.password} onChange={(e) => set('password', e.target.value)} hint="At least 8 characters" required />
        <Input label="Repeat password" type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => set('confirm', e.target.value)} error={f.confirm && f.confirm !== f.password ? 'The passwords do not match' : undefined} required />
        <ErrorNote error={error ?? branches.error} />
        <div className="flex items-center justify-between gap-2">
          <Link to="/login" className="text-sm font-medium text-brand hover:underline">Back to sign in</Link>
          <Button type="submit" loading={busy} disabled={!ready}>Create account</Button>
        </div>
      </form>
    </div>
  );
};
