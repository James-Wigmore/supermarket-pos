import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, ErrorNote, Input, Loading, Panel, useToast } from '../components/ui';
import { api, tokenStore } from '../lib/api';
import { ipc } from '../lib/desktop';
import { dateTime } from '../lib/format';
import type { CloudStatus } from '../lib/types';

interface Conflict {
  id: string;
  message: string;
  local: Record<string, unknown>;
  sheet: Record<string, unknown>;
}
interface LogEntry {
  id: string;
  level: 'INFO' | 'ERROR' | 'CONFLICT';
  message: string;
  createdAt: string;
}

const token = () => tokenStore.get() ?? '';
const shown = (value: unknown) => (value === '' || value === null || value === undefined ? '(empty)' : String(value));

const Step = ({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) => (
  <div className="flex gap-3 border-b border-line py-4 last:border-0">
    <span className={`grid size-7 shrink-0 place-items-center rounded-full text-sm font-bold ${done ? 'bg-brand text-white' : 'bg-line text-muted'}`}>{done ? '✓' : n}</span>
    <div className="min-w-0 flex-1 space-y-2">
      <h3 className="font-semibold">{title}</h3>
      {children}
    </div>
  </div>
);

/** Administrator set-up and monitoring of the Google Sheets synchronisation (Windows app only). */
export const SheetsSettings = () => {
  const client = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('Supermarket POS');
  const [url, setUrl] = useState('');
  const bridge = window.pos!;

  const google = useQuery({ queryKey: ['google-status'], queryFn: () => ipc(bridge.googleStatus(token())) });
  const status = useQuery({ queryKey: ['sync-status'], queryFn: () => api<CloudStatus>('/sync/status'), refetchInterval: 5000 });
  const conflicts = useQuery({ queryKey: ['sync-conflicts'], queryFn: () => api<{ data: Conflict[] }>('/sync/conflicts'), refetchInterval: 15_000 });
  const log = useQuery({ queryKey: ['sync-log'], queryFn: () => api<{ data: LogEntry[] }>('/sync/log'), refetchInterval: 15_000 });

  const refresh = () => {
    for (const key of ['google-status', 'sync-status', 'sync-conflicts', 'sync-log']) void client.invalidateQueries({ queryKey: [key] });
    window.dispatchEvent(new Event('cloud:refresh'));
  };
  const useAction = <T,>(fn: (input: T) => Promise<unknown>, message?: string) =>
    useMutation({ mutationFn: fn, onSuccess: () => { if (message) toast('success', message); refresh(); } });

  const importFile = useAction(() => ipc(bridge.googleImportCredentials(token())));
  const connect = useAction(() => ipc(bridge.googleConnect(token())), 'Google account connected');
  const disconnect = useAction(() => ipc(bridge.googleDisconnect(token())));
  const link = useAction((body: object) => api('/sync/spreadsheet', { method: 'POST', body }), 'Spreadsheet connected. The first synchronisation has started.');
  const run = useAction(() => api('/sync/run', { method: 'POST' }));
  const resend = useAction(() => api('/sync/resend', { method: 'POST' }), 'All data will be sent again.');
  const resolve = useAction(({ id, use }: { id: string; use: 'SHEET' | 'LOCAL' }) => api(`/sync/conflicts/${id}/resolve`, { method: 'POST', body: { use } }));

  const s = status.data;
  const g = google.data;
  if (!s || !g) return <Loading />;
  const errors = [importFile, connect, disconnect, link, run, resend, resolve].find((m) => m.error)?.error;

  return (
    <div className="space-y-5">
      <Panel title="Connect Google Sheets">
        <p className="text-sm text-muted">Selling never waits for Google. Your data stays on this computer and a copy is sent to a spreadsheet you own whenever the internet is available.</p>
        <Step n={1} title="Add your Google credentials" done={g.hasCredentials}>
          {g.hasCredentials ? <p className="text-sm">Credentials saved securely on this computer.</p> : (
            <>
              <p className="text-sm text-muted">In Google Cloud Console: create a project, enable the <b>Google Sheets API</b>, then create an <b>OAuth client ID</b> of type <b>Desktop app</b> and download its JSON file. (Step-by-step instructions are in the README.)</p>
              <Button onClick={() => importFile.mutate(undefined)} loading={importFile.isPending}>Choose credentials file…</Button>
            </>
          )}
        </Step>
        <Step n={2} title="Sign in with Google" done={g.connected}>
          {g.connected ? <Button variant="secondary" size="sm" onClick={() => disconnect.mutate(undefined)}>Disconnect Google</Button> : (
            <>
              <Button onClick={() => connect.mutate(undefined)} loading={connect.isPending} disabled={!g.hasCredentials}>Connect Google account</Button>
              {connect.isPending && <p className="text-sm text-muted">Finish signing in in your web browser, then come back here.</p>}
            </>
          )}
        </Step>
        <Step n={3} title="Choose the spreadsheet" done={s.configured}>
          {s.configured ? (
            <p className="text-sm">Using <a className="font-semibold text-brand underline" href={s.spreadsheetUrl ?? '#'} target="_blank" rel="noreferrer">{s.spreadsheetTitle ?? 'spreadsheet'}</a>. To switch, choose another below (all data is sent to it again).</p>
          ) : <p className="text-sm text-muted">Create a new spreadsheet, or paste the link of an empty one you already made.</p>}
          {g.connected && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Input label="New spreadsheet name" value={title} onChange={(e) => setTitle(e.target.value)} />
                <Button onClick={() => link.mutate({ mode: 'create', title })} loading={link.isPending}>Create spreadsheet</Button>
              </div>
              <div className="space-y-2">
                <Input label="Or paste a spreadsheet link" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
                <Button variant="secondary" onClick={() => link.mutate({ mode: 'existing', url })} loading={link.isPending} disabled={!url.trim()}>Use this spreadsheet</Button>
              </div>
            </div>
          )}
        </Step>
      </Panel>

      {s.configured && (
        <Panel title="Synchronisation" actions={<Badge tone={!s.online ? 'bad' : s.failed || s.conflicts ? 'warn' : 'good'}>{!s.online ? 'Offline' : s.running ? 'Syncing…' : 'Online'}</Badge>}>
          <dl className="grid gap-2 text-sm sm:grid-cols-4">
            <div><dt className="text-muted">Last synchronized</dt><dd className="font-semibold">{s.lastSyncedAt ? dateTime(s.lastSyncedAt) : 'Not yet'}</dd></div>
            <div><dt className="text-muted">Pending</dt><dd className="font-semibold">{s.pending} records</dd></div>
            <div><dt className="text-muted">Failed</dt><dd className="font-semibold">{s.failed} records</dd></div>
            <div><dt className="text-muted">Conflicts</dt><dd className="font-semibold">{s.conflicts}</dd></div>
          </dl>
          {!s.online && <p className="mt-2 text-sm text-danger">Offline — transactions are being stored locally and will synchronize automatically.</p>}
          {s.lastError && <p className="mt-2 text-sm text-danger">{s.lastError}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => run.mutate(undefined)} loading={run.isPending || s.running}>Sync now</Button>
            <Button variant="secondary" onClick={() => window.confirm('Send all data to the spreadsheet again? Existing rows are updated, not duplicated.') && resend.mutate(undefined)}>Re-send all data</Button>
          </div>
        </Panel>
      )}

      {(conflicts.data?.data.length ?? 0) > 0 && (
        <Panel title="Changes to review">
          <p className="mb-3 text-sm text-muted">These were changed both in the POS and in Google Sheets. Nothing was overwritten. Choose which version to keep.</p>
          <div className="space-y-4">
            {conflicts.data!.data.map((c) => (
              <div key={c.id} className="rounded-field border border-line p-3">
                <p className="mb-2 text-sm font-semibold">{c.message}</p>
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-muted"><th>Field</th><th>In the POS</th><th>In Google Sheets</th></tr></thead>
                  <tbody>
                    {Object.keys(c.local).filter((k) => shown(c.local[k]) !== shown(c.sheet[k])).map((k) => (
                      <tr key={k}><td className="pr-3 font-medium">{k}</td><td className="pr-3">{shown(c.local[k])}</td><td>{shown(c.sheet[k])}</td></tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => resolve.mutate({ id: c.id, use: 'LOCAL' })}>Keep the POS version</Button>
                  <Button size="sm" variant="secondary" onClick={() => resolve.mutate({ id: c.id, use: 'SHEET' })}>Use the sheet version</Button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {s.configured && (log.data?.data.length ?? 0) > 0 && (
        <Panel title="Recent activity">
          <ul className="space-y-1 text-sm">
            {log.data!.data.slice(0, 10).map((l) => (
              <li key={l.id} className="flex gap-2"><span className="shrink-0 text-muted">{dateTime(l.createdAt)}</span><span className={l.level === 'ERROR' ? 'text-danger' : ''}>{l.message}</span></li>
            ))}
          </ul>
        </Panel>
      )}
      <ErrorNote error={errors} />
    </div>
  );
};
