import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime } from '../lib/format';
import { useSync } from '../lib/sync';
import type { CloudStatus } from '../lib/types';

const STYLES = {
  ONLINE: 'bg-brand-soft text-brand-dark',
  OFFLINE: 'bg-danger-soft text-danger',
  SYNCING: 'bg-warn-soft text-warn',
  LOCAL: 'bg-line text-muted',
} as const;

const records = (n: number) => `${n} record${n === 1 ? '' : 's'}`;

const cloudState = (c: CloudStatus) => (!c.configured ? 'LOCAL' : !c.online ? 'OFFLINE' : c.running ? 'SYNCING' : 'ONLINE');

const cloudTitle = (c: CloudStatus) =>
  !c.configured
    ? 'Selling works without internet. Google Sheets is not connected.'
    : [
        c.online ? 'Online' : 'Offline — transactions are being stored locally and will synchronize automatically.',
        `Last synchronized: ${c.lastSyncedAt ? dateTime(c.lastSyncedAt) : 'not yet'}`,
        `Pending: ${records(c.pending)}`,
        `Failed: ${records(c.failed)}`,
        ...(c.conflicts ? [`Conflicts to resolve: ${c.conflicts}`] : []),
        ...(c.lastError ? [c.lastError] : []),
      ].join('\n');

const CloudPill = ({ cloud }: { cloud: CloudStatus }) => {
  const { can } = useAuth();
  const state = cloudState(cloud);
  const syncNow = () => {
    if (can('settings:manage') && cloud.configured) void api('/sync/run', { method: 'POST' }).finally(() => window.dispatchEvent(new Event('cloud:refresh')));
  };
  return (
    <button type="button" onClick={syncNow} title={cloudTitle(cloud)} className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${STYLES[state]}`}>
      <span className={`size-2 rounded-full bg-current ${state === 'SYNCING' ? 'animate-pulse' : ''}`} />
      {state === 'LOCAL' ? 'LOCAL ONLY' : state}
      {cloud.configured && cloud.pending > 0 && <span>· {cloud.pending} pending</span>}
      {cloud.failed > 0 && <span className="text-danger">· {cloud.failed} failed</span>}
      {cloud.conflicts > 0 && <span className="text-danger">· {cloud.conflicts} conflict{cloud.conflicts === 1 ? '' : 's'}</span>}
    </button>
  );
};

export const StatusPill = () => {
  const { state, pending, failed, syncNow, cloud } = useSync();
  if (cloud) return <CloudPill cloud={cloud} />;
  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      title={failed ? `${failed} sale(s) could not sync, see Sales` : 'Click to sync now'}
      className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${STYLES[state]}`}
    >
      <span className={`size-2 rounded-full bg-current ${state === 'SYNCING' ? 'animate-pulse' : ''}`} />
      {state}
      {pending > 0 && <span>· {pending} queued</span>}
      {failed > 0 && <span className="text-danger">· {failed} failed</span>}
    </button>
  );
};
