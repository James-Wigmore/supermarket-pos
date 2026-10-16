import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, ErrorNote, Input } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { loadSetupStatus } from '../lib/queries';

const STEPS = ['Business', 'Branch and registers', 'Administrator'] as const;
const MAX_REGISTERS = 10;

const INITIAL = {
  businessName: '', currency: 'UGX', receiptHeader: '', receiptFooter: 'Thank you for shopping with us',
  branchName: 'Main Branch', branchCode: 'MAIN', address: '', phone: '', registerCount: 1,
  adminName: '', email: '', password: '', confirm: '',
};

/** First-run wizard, shown until the first administrator exists. */
export const Setup = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const emailApproval = useQuery({ queryKey: ['setup'], queryFn: loadSetupStatus }).data?.emailApproval;
  const [step, setStep] = useState(0);
  const [f, setF] = useState(INITIAL);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof INITIAL>(key: K, value: (typeof INITIAL)[K]) => setF((prev) => ({ ...prev, [key]: value }));
  const text = (key: keyof typeof INITIAL, label: string, extra: object = {}) => (
    <Input label={label} value={String(f[key])} onChange={(e) => set(key, e.target.value as never)} {...extra} />
  );

  const ready = [
    f.businessName.trim() && f.currency.length === 3,
    f.branchName.trim() && /^[A-Za-z0-9]{2,10}$/.test(f.branchCode) && f.registerCount >= 1,
    f.adminName.trim() && f.email.includes('@') && f.password.length >= 8 && f.password === f.confirm,
  ][step];

  const finish = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api('/setup', {
        method: 'POST',
        body: {
          businessName: f.businessName, currency: f.currency, receiptHeader: f.receiptHeader, receiptFooter: f.receiptFooter,
          branch: { code: f.branchCode, name: f.branchName, address: f.address || undefined, phone: f.phone || undefined },
          registers: Array.from({ length: f.registerCount }, (_, i) => `Register ${i + 1}`),
          admin: { name: f.adminName, email: f.email, password: f.password },
        },
      });
      client.setQueryData(['setup'], { needsSetup: false, emailApproval: Boolean(emailApproval) });
      const step = await login(f.email.trim(), f.password);
      // with email approval running, the owner approves this first sign-in before the next step (connect Google Sheets, Windows app)
      if (step.kind === 'done') navigate('/settings?tab=sheets', { replace: true });
      else navigate('/login', { replace: true, state: { step } });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full place-items-center bg-tape p-4">
      <form onSubmit={(e) => { e.preventDefault(); if (step < STEPS.length - 1) setStep(step + 1); else void finish(); }} className="w-full max-w-lg space-y-4 rounded-panel bg-white p-7">
        <div>
          <p className="text-sm font-semibold text-brand">Step {step + 1} of {STEPS.length}</p>
          <h1 className="text-2xl font-bold tracking-tight">{step === 0 ? 'Set up your store' : STEPS[step]}</h1>
        </div>
        {step === 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {text('businessName', 'Business name', { className: 'sm:col-span-2', autoFocus: true })}
            {text('currency', 'Currency code', { maxLength: 3, hint: 'e.g. UGX, KES, USD', onChange: (e: { target: { value: string } }) => set('currency', e.target.value.toUpperCase()) })}
            {text('receiptHeader', 'Receipt header line (optional)')}
            {text('receiptFooter', 'Receipt footer message', { className: 'sm:col-span-2' })}
          </div>
        )}
        {step === 1 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {text('branchName', 'Branch name', { autoFocus: true })}
            {text('branchCode', 'Branch code', { maxLength: 10, onChange: (e: { target: { value: string } }) => set('branchCode', e.target.value.toUpperCase()) })}
            {text('address', 'Address (printed on receipts)', { className: 'sm:col-span-2' })}
            {text('phone', 'Phone (printed on receipts)')}
            <Input label="Number of registers (tills)" type="number" min={1} max={MAX_REGISTERS} value={f.registerCount} onChange={(e) => set('registerCount', Math.min(MAX_REGISTERS, Math.max(1, Number(e.target.value) || 1)))} />
          </div>
        )}
        {step === 2 && (
          <div className="grid gap-3">
            <p className="text-sm text-muted">This account has full access. Keep the password safe: it cannot be recovered without another administrator.</p>
            {text('adminName', 'Your name', { autoFocus: true })}
            {text('email', 'Email (used to sign in)', { type: 'email', autoComplete: 'username' })}
            {text('password', 'Password (8+ characters)', { type: 'password', autoComplete: 'new-password' })}
            {text('confirm', 'Repeat password', { type: 'password', autoComplete: 'new-password', error: f.confirm && f.confirm !== f.password ? 'Passwords do not match' : undefined })}
            {emailApproval === false && <p role="alert" className="text-sm font-medium text-danger">Email sign-in approval is OFF: this server has no email set up, so everyone signs in with a password only. Set it up later (see the README) to protect admin and manager accounts.</p>}
            {emailApproval && <p className="text-sm text-muted">Email approval is on. Your first sign-in will be sent to this address, so check it carefully.</p>}
          </div>
        )}
        <ErrorNote error={error} />
        <div className="flex justify-between gap-2">
          <Button variant="secondary" onClick={() => setStep(step - 1)} disabled={step === 0 || busy}>Back</Button>
          <Button type="submit" disabled={!ready} loading={busy}>{step < STEPS.length - 1 ? 'Next' : 'Create store'}</Button>
        </div>
      </form>
    </div>
  );
};
