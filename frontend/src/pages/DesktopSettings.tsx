import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EditableDesktopSettings } from '../../../desktop/bridge';
import { Button, ErrorNote, Loading, Panel, Select, useToast } from '../components/ui';
import { tokenStore } from '../lib/api';
import { ipc } from '../lib/desktop';
import { dateTime } from '../lib/format';

const bridge = () => window.pos!;
const token = () => tokenStore.get() ?? '';

/** Printer and backup options of the Windows app (only shown there). */
export const DesktopSettings = () => {
  const client = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: ['desktop-settings'], queryFn: () => ipc(bridge().getSettings(token())) });
  const printers = useQuery({ queryKey: ['printers'], queryFn: () => ipc(bridge().printers()) });
  const refresh = () => void client.invalidateQueries({ queryKey: ['desktop-settings'] });

  const save = useMutation({ mutationFn: (patch: EditableDesktopSettings) => ipc(bridge().saveSettings(token(), patch)), onSuccess: refresh });
  const chooseFolder = useMutation({ mutationFn: () => ipc(bridge().chooseBackupFolder(token())), onSuccess: refresh });
  const backup = useMutation({
    mutationFn: () => ipc(bridge().backupNow(token())),
    onSuccess: (file) => { toast('success', `Backup saved to ${file}`); refresh(); },
  });
  const restore = useMutation({ mutationFn: () => ipc(bridge().restore(token())) });

  const s = settings.data;
  if (!s) return <Loading />;
  return (
    <div className="space-y-5">
      <Panel title="Receipt printer">
        <Select label="Printer" value={s.printer} onChange={(e) => save.mutate({ printer: e.target.value })}>
          <option value="">Windows default printer</option>
          {printers.data?.map((p) => <option key={p.name} value={p.name}>{p.name}{p.isDefault ? ' (default)' : ''}</option>)}
        </Select>
        <label className="mt-3 flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={s.silentPrint} onChange={(e) => save.mutate({ silentPrint: e.target.checked })} />
          Print receipts straight to this printer without showing the print window
        </label>
        <p className="mt-2 text-sm text-muted">For thermal printers, set the paper size (for example 80 mm) in the printer’s Windows settings.</p>
      </Panel>
      <Panel title="Backups">
        <p className="text-sm">Saved in <b>{s.backupDir}</b></p>
        <p className="text-sm text-muted">Last backup: {s.lastBackupAt ? dateTime(s.lastBackupAt) : 'never'}</p>
        <label className="mt-3 flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={s.autoBackup} onChange={(e) => save.mutate({ autoBackup: e.target.checked })} />
          Back up automatically once a day (the last 14 are kept)
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => backup.mutate()} loading={backup.isPending}>Back up now</Button>
          <Button variant="secondary" onClick={() => chooseFolder.mutate()}>Change folder</Button>
          <Button variant="danger" onClick={() => restore.mutate()} loading={restore.isPending}>Restore from a backup…</Button>
        </div>
        <p className="mt-2 text-sm text-muted">Restoring replaces all current data and restarts the app. A safety copy is saved first.</p>
      </Panel>
      <ErrorNote error={save.error ?? chooseFolder.error ?? backup.error ?? restore.error} />
    </div>
  );
};
