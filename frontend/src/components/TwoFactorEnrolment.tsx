import { useMutation, useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { SessionResult } from '../lib/auth';
import { uuid } from '../lib/format';
import { Button, ErrorNote, Input, Loading } from './ui';

export interface EnrolmentResult { recoveryCodes: string[]; session?: SessionResult }
type Confirmed = { recoveryCodes: string[] } & Partial<SessionResult>;

interface Props {
  /** Present when the user is being forced to enrol at sign-in (they have no session yet). */
  setupToken?: string;
  onDone: (result: EnrolmentResult) => void;
  onCancel?: () => void;
}

/** Scan a QR code, prove it works with a first code, then keep the one-time recovery codes safe. */
export const TwoFactorEnrolment = ({ setupToken, onDone, onCancel }: Props) => {
  const [instance] = useState(uuid); // one secret per enrolment, even if the screen re-renders
  const start = useQuery({
    queryKey: ['2fa-setup', instance],
    queryFn: () => api<{ secret: string; otpauthUrl: string }>('/auth/2fa/setup', { method: 'POST', body: { setupToken } }),
    staleTime: Infinity, gcTime: 0, retry: false, refetchOnWindowFocus: false,
  });
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const [saved, setSaved] = useState(false);
  const confirm = useMutation({
    mutationFn: () => api<Confirmed>('/auth/2fa/confirm', { method: 'POST', body: { code, setupToken } }),
    onSuccess: setConfirmed,
  });

  useEffect(() => {
    if (start.data) void QRCode.toString(start.data.otpauthUrl, { type: 'svg', margin: 1 }).then((svg) => setQr(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`));
  }, [start.data]);

  if (confirmed) {
    const { recoveryCodes, ...session } = confirmed;
    return (
      <div className="space-y-4">
        <p className="text-sm">Two-factor authentication is on. <b>Save these recovery codes now.</b> Each works once if you lose your phone, and they will not be shown again.</p>
        <ul className="grid grid-cols-2 gap-2 rounded-field bg-paper p-3 font-mono text-sm" aria-label="Recovery codes">
          {recoveryCodes.map((c) => <li key={c}>{c}</li>)}
        </ul>
        <Button variant="secondary" size="sm" onClick={() => void navigator.clipboard?.writeText(recoveryCodes.join('\n'))}>Copy codes</Button>
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved these codes somewhere safe</label>
        <Button className="w-full" disabled={!saved} onClick={() => onDone({ recoveryCodes, session: session.token ? (session as SessionResult) : undefined })}>Continue</Button>
      </div>
    );
  }

  if (start.isLoading) return <Loading />;
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (code.trim().length >= 6) confirm.mutate(); }}>
      <ErrorNote error={start.error} />
      {start.data && (
        <>
          <p className="text-sm text-muted">Scan this QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy), then enter the 6-digit code it shows.</p>
          {qr && <img src={qr} alt="QR code for your authenticator app" className="mx-auto size-48 rounded-field border border-line bg-white p-1" />}
          <p className="break-all text-center font-mono text-xs text-muted">Can’t scan? Enter this key: <b className="text-ink">{start.data.secret.match(/.{1,4}/g)?.join(' ')}</b></p>
          <Input label="6-digit code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          <ErrorNote error={confirm.error} />
          <div className="flex gap-2">
            {onCancel && <Button variant="secondary" onClick={onCancel}>Cancel</Button>}
            <Button type="submit" className="flex-1" loading={confirm.isPending} disabled={code.trim().length < 6}>Turn on two-factor</Button>
          </div>
        </>
      )}
    </form>
  );
};
