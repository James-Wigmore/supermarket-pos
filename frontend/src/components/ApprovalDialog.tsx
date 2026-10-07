import { useCallback, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import type { Approval } from '../lib/types';
import { Button, ErrorNote, Input, Modal } from './ui';

interface Props {
  open: boolean;
  reason: string;
  error?: string;
  onSubmit: (approval: Approval) => void | Promise<void>;
  onCancel: () => void;
}

/** Collects a manager's credentials so a restricted action can proceed. */
export const ApprovalDialog = ({ open, reason, error, onSubmit, onCancel }: Props) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit({ email: email.trim(), password });
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onCancel} title="Manager approval needed" width="sm"
      footer={<><Button variant="secondary" onClick={onCancel}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!email || !password}>Approve</Button></>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <p className="text-sm text-muted">{reason}</p>
        <Input label="Manager email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <Input label="Manager password" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorNote error={error} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
};

/**
 * Runs an action; when the server asks for manager approval, prompts for it and retries.
 * Usage: const { run, dialog } = useApproval(); await run('reason', (approval) => api(...));
 */
export const useApproval = () => {
  const [state, setState] = useState<{ reason: string; error?: string } | null>(null);
  const pending = useRef<{ action: (a?: Approval) => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void } | null>(null);

  const run = useCallback(<T,>(reason: string, action: (approval?: Approval) => Promise<T>) => new Promise<T>((resolve, reject) => {
    action().then(resolve, (err) => {
      if (err instanceof ApiError && err.needsApproval) {
        pending.current = { action, resolve: resolve as (v: unknown) => void, reject };
        setState({ reason });
      } else reject(err);
    });
  }), []);

  const submit = async (approval: Approval) => {
    const current = pending.current;
    if (!current) return;
    try {
      current.resolve(await current.action(approval));
      pending.current = null;
      setState(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setState((s) => s && { ...s, error: err.message });
      else {
        current.reject(err);
        pending.current = null;
        setState(null);
      }
    }
  };

  const cancel = () => {
    pending.current?.reject(new Error('Approval cancelled'));
    pending.current = null;
    setState(null);
  };

  const dialog = <ApprovalDialog open={Boolean(state)} reason={state?.reason ?? ''} error={state?.error} onSubmit={submit} onCancel={cancel} />;
  return { run, dialog };
};
