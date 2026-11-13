import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ChangePassword } from './ChangePassword';
import { Badge, Button, ErrorNote, Input, Modal, Spinner, Textarea, useToast } from './ui';

type View = 'home' | 'password' | 'approval' | 'totpSetup' | 'totpDisable';

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

/** Generates a secret, waits for a confirming code, then shows one-time recovery codes. */
const TwoFactorSetup = ({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) => {
  const [data, setData] = useState<{ secret: string } | null>(null);
  const [loadError, setLoadError] = useState<unknown>();
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const confirm = useMutation({
    mutationFn: () => api<{ recoveryCodes: string[] }>('/auth/totp/confirm', { method: 'POST', body: { code } }),
    onSuccess: (res) => setRecoveryCodes(res.recoveryCodes),
  });

  useEffect(() => {
    api<{ secret: string }>('/auth/totp/setup', { method: 'POST' }).then(setData).catch(setLoadError);
  }, []);

  const cancel = () => { void api('/auth/totp/cancel', { method: 'POST' }).catch(() => undefined); onCancel(); };

  if (recoveryCodes) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-danger">Save these recovery codes now — they are shown only once. Each works once if you lose your phone.</p>
        <Textarea label="Recovery codes" rows={4} readOnly value={recoveryCodes.join('\n')} onFocus={(e) => e.currentTarget.select()} />
        <Button className="w-full" onClick={onDone}>I&apos;ve saved these codes</Button>
      </div>
    );
  }

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (code.trim().length >= 6) confirm.mutate(); }}>
      {!data && !loadError && <Spinner small />}
      <ErrorNote error={loadError} />
      {data && (
        <>
          <p className="text-sm text-muted">Open your authenticator app (Google Authenticator, Authy, and the like), add an account, and enter this key by hand:</p>
          <div className="rounded-lg border border-line p-3">
            <div className="select-all break-all font-mono text-sm font-semibold">{data.secret}</div>
          </div>
          <Input label="6-digit code from the app" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          <ErrorNote error={confirm.error} />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={cancel}>Cancel</Button>
            <Button type="submit" loading={confirm.isPending} disabled={code.trim().length < 6}>Confirm and turn on</Button>
          </div>
        </>
      )}
    </form>
  );
};

const DisableTwoFactor = ({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) => {
  const [password, setPassword] = useState('');
  const save = useMutation({ mutationFn: () => api('/auth/totp/disable', { method: 'POST', body: { password } }), onSuccess: onDone });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (password) save.mutate(); }}>
      <p className="text-sm text-muted">Confirm with your password to turn the authenticator app off.</p>
      <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      <ErrorNote error={save.error} />
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="danger" loading={save.isPending} disabled={!password}>Turn off</Button>
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
      {view === 'totpSetup' && <TwoFactorSetup onCancel={() => setView('home')} onDone={() => void changed('Authenticator app is on')} />}
      {view === 'totpDisable' && <DisableTwoFactor onCancel={() => setView('home')} onDone={() => void changed('Authenticator app is off')} />}
      {view === 'home' && (
        <div className="space-y-6">
          <section>
            <h3 className="mb-1 font-semibold">Password</h3>
            {can('user:manage')
              ? <Button variant="secondary" onClick={() => setView('password')}>Change password</Button>
              : <p className="text-sm text-muted">To change your password, ask your manager. They can reset it for you.</p>}
          </section>
          <section>
            <h3 className="mb-1 flex items-center gap-2 font-semibold">Authenticator app {session?.twoFactor.enabled ? <Badge tone="good">On</Badge> : <Badge tone="warn">Off</Badge>}</h3>
            <p className="mb-2 text-sm text-muted">After your password, you enter a 6-digit code from an app on your phone — works even without internet or email.</p>
            <Button variant="secondary" onClick={() => setView(session?.twoFactor.enabled ? 'totpDisable' : 'totpSetup')}>{session?.twoFactor.enabled ? 'Turn off' : 'Set up'}</Button>
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
