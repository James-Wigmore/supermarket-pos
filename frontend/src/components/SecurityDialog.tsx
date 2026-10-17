import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ChangePassword } from './ChangePassword';
import { Badge, Button, ErrorNote, Input, Modal, useToast } from './ui';

type View = 'home' | 'password' | 'approval';

const ToggleApproval = ({ enabling, onDone, onCancel }: { enabling: boolean; onDone: () => void; onCancel: () => void }) => {
  const [password, setPassword] = useState('');
  const save = useMutation({ mutationFn: () => api('/auth/email-approval', { method: 'POST', body: { enabled: enabling, password } }), onSuccess: onDone });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (password) save.mutate(); }}>
      <p className="text-sm text-muted">{enabling ? 'We will send a test email to your address first. Turn this on only if you can open it.' : 'Confirm with your password to turn email approval off.'}</p>
      <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      <ErrorNote error={save.error} />
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant={enabling ? 'primary' : 'danger'} loading={save.isPending} disabled={!password}>{enabling ? 'Turn on approval' : 'Turn off approval'}</Button>
      </div>
    </form>
  );
};

/** Password and email-approval settings for the signed-in user. */
export const SecurityDialog = ({ onClose }: { onClose: () => void }) => {
  const { session, can, reloadSession } = useAuth();
  const toast = useToast();
  const [view, setView] = useState<View>('home');
  const approval = session?.loginApproval;
  const changed = async (message: string) => { await reloadSession(); toast('success', message); setView('home'); };

  if (view === 'password') return <ChangePassword onClose={() => setView('home')} />;
  return (
    <Modal open onClose={onClose} title="Account security" width="sm" footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {view === 'approval' && <ToggleApproval enabling={!approval?.optedIn} onCancel={() => setView('home')} onDone={() => void changed(approval?.optedIn ? 'Email approval is off' : 'Email approval is on')} />}
      {view === 'home' && (
        <div className="space-y-6">
          <section>
            <h3 className="mb-1 font-semibold">Password</h3>
            {can('user:manage')
              ? <Button variant="secondary" onClick={() => setView('password')}>Change password</Button>
              : <p className="text-sm text-muted">To change your password, ask your manager. They can reset it for you.</p>}
          </section>
          <section>
            <h3 className="mb-1 flex items-center gap-2 font-semibold">Email sign-in approval {approval?.enabled ? <Badge tone="good">On</Badge> : <Badge tone="warn">Off</Badge>}</h3>
            <p className="mb-2 text-sm text-muted">After your password, you approve each sign-in from an email, so a stolen password alone is not enough.</p>
            {!approval?.configured && <p className="text-sm font-medium text-danger">Email approval is not set up on this server, so it is not protecting your account. Sign-in uses your password only. Ask your administrator to set up email.</p>}
            {approval?.configured && approval.required && <p className="text-sm text-muted">It is required for your role, so it cannot be turned off. If your email address is wrong, ask your manager to correct it.</p>}
            {approval?.configured && !approval.required && <Button variant="secondary" onClick={() => setView('approval')}>{approval.optedIn ? 'Turn off' : 'Turn on'}</Button>}
          </section>
        </div>
      )}
    </Modal>
  );
};
