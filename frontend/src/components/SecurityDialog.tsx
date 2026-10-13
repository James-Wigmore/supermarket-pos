import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ChangePassword } from './ChangePassword';
import { TwoFactorEnrolment } from './TwoFactorEnrolment';
import { Badge, Button, ErrorNote, Input, Modal, useToast } from './ui';

type View = 'home' | 'password' | 'enrol' | 'disable';

const DisableTwoFactor = ({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) => {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const save = useMutation({ mutationFn: () => api('/auth/2fa/disable', { method: 'POST', body: { password, code } }), onSuccess: onDone });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <p className="text-sm text-muted">Confirm with your password and a current authenticator (or recovery) code.</p>
      <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      <Input label="Authenticator code" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
      <ErrorNote error={save.error} />
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="danger" loading={save.isPending} disabled={!password || code.trim().length < 6}>Turn off two-factor</Button>
      </div>
    </form>
  );
};

/** Password and two-factor settings for the signed-in user. */
export const SecurityDialog = ({ onClose }: { onClose: () => void }) => {
  const { session, can, reloadSession } = useAuth();
  const toast = useToast();
  const [view, setView] = useState<View>('home');
  const twoFactor = session?.twoFactor;
  const changed = async (message: string) => { await reloadSession(); toast('success', message); setView('home'); };

  if (view === 'password') return <ChangePassword needsCode={twoFactor?.enabled} onClose={() => setView('home')} />;
  return (
    <Modal open onClose={onClose} title="Account security" width="sm" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {view === 'enrol' && <TwoFactorEnrolment onCancel={() => setView('home')} onDone={() => void changed('Two-factor authentication is on')} />}
      {view === 'disable' && <DisableTwoFactor onCancel={() => setView('home')} onDone={() => void changed('Two-factor authentication is off')} />}
      {view === 'home' && (
        <div className="space-y-6">
          <section>
            <h3 className="mb-1 font-semibold">Password</h3>
            {can('user:manage')
              ? <Button variant="secondary" onClick={() => setView('password')}>Change password</Button>
              : <p className="text-sm text-muted">To change your password, ask your manager. They can reset it for you.</p>}
          </section>
          <section>
            <h3 className="mb-1 flex items-center gap-2 font-semibold">Two-factor authentication {twoFactor?.enabled ? <Badge tone="good">On</Badge> : <Badge>Off</Badge>}</h3>
            <p className="mb-2 text-sm text-muted">A code from an authenticator app is needed on every sign-in, so a stolen password alone is not enough.</p>
            {twoFactor?.enabled
              ? twoFactor.required
                ? <p className="text-sm text-muted">It is required for your role, so it cannot be turned off. If you lose your phone, ask your manager to reset it.</p>
                : <Button variant="secondary" onClick={() => setView('disable')}>Turn off</Button>
              : <Button onClick={() => setView('enrol')}>Turn on</Button>}
          </section>
        </div>
      )}
    </Modal>
  );
};
