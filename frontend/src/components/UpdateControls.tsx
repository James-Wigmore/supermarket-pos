import { useState } from 'react';
import type { UpdateStatus } from '../../../desktop/bridge';
import { useUpdateActions } from '../lib/updates';
import { Button, ErrorNote, Modal } from './ui';

/** What to say and do about an update, in the top banner (`compact`) and in Settings. */
export const UpdateControls = ({ status, compact = false }: { status: UpdateStatus; compact?: boolean }) => {
  const { check, download, install } = useUpdateActions();
  const [confirming, setConfirming] = useState(false);
  const { state, version, percent } = status;
  const failure = check.error ?? download.error ?? install.error;

  const text = {
    disabled: status.disabledReason,
    idle: 'You have the latest version.',
    checking: 'Checking for updates…',
    available: `Version ${version} is available. You have ${status.currentVersion}.`,
    downloading: `Downloading version ${version}… ${percent ?? 0}%`,
    downloaded: `Version ${version} is ready to install.`,
    error: status.error,
  }[state];

  return (
    <div className={compact ? 'flex flex-wrap items-center gap-3' : 'space-y-3'}>
      <p className="text-sm font-medium">{install.isPending ? 'Saving a backup, then installing. The app will restart.' : text}</p>
      {state === 'downloading' && (
        <div role="progressbar" aria-label="Download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? 0} className="h-2 w-40 overflow-hidden rounded-full bg-ink/10">
          <div className="h-full bg-brand" style={{ width: `${percent ?? 0}%` }} />
        </div>
      )}
      {state === 'available' && <Button size="sm" onClick={() => download.mutate()} loading={download.isPending}>Download update</Button>}
      {state === 'downloaded' && !install.isPending && <Button size="sm" onClick={() => setConfirming(true)}>Restart and install</Button>}
      {state === 'error' && <Button size="sm" onClick={() => (version ? download.mutate() : check.mutate())} loading={download.isPending || check.isPending}>{version ? 'Try again' : 'Check again'}</Button>}
      {!compact && state === 'idle' && <Button variant="secondary" size="sm" onClick={() => check.mutate()} loading={check.isPending}>Check for updates</Button>}
      <ErrorNote error={failure} />
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Install version ${version}?`}
        width="sm"
        footer={<><Button variant="secondary" onClick={() => setConfirming(false)}>Not now</Button><Button onClick={() => { setConfirming(false); install.mutate(); }}>Restart and install</Button></>}
      >
        <p className="text-sm">The app saves a backup of your data, closes, installs the update and opens again. This takes about a minute and nobody can sell during that time. Finish any sale in progress first.</p>
      </Modal>
    </div>
  );
};
