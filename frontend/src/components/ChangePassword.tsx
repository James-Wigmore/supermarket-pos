import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api, tokenStore } from '../lib/api';
import { Button, ErrorNote, Input, Modal, useToast } from './ui';

const MIN_LENGTH = 8;

/** Lets any signed-in user change their own password. The API returns a fresh session token. */
export const ChangePassword = ({ onClose, needsCode = false }: { onClose: () => void; needsCode?: boolean }) => {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [code, setCode] = useState('');
  const save = useMutation({
    mutationFn: () => api<{ token: string }>('/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: next, code: needsCode ? code.trim() : undefined } }),
    onSuccess: ({ token }) => { tokenStore.set(token); toast('success', 'Password changed'); onClose(); },
  });
  const problem = next && next.length < MIN_LENGTH ? `Use at least ${MIN_LENGTH} characters` : again && again !== next ? 'The two new passwords do not match' : undefined;
  const ready = current && next.length >= MIN_LENGTH && next === again && (!needsCode || code.trim().length >= 6);

  return (
    <Modal open onClose={onClose} title="Change your password" width="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!ready}>Change password</Button></>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (ready) save.mutate(); }}>
        <Input label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
        <Input label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} hint={`At least ${MIN_LENGTH} characters`} />
        <Input label="Repeat new password" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} error={problem} />
        {needsCode && <Input label="Authenticator code" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} hint="Required because two-factor is on" />}
        <ErrorNote error={save.error} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
};
