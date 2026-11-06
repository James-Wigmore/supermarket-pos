import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ipc, isDesktop } from '../lib/desktop';
import { Button, ErrorNote, Textarea } from './ui';

const KEY = ['license'];

/** In the Windows app: keeps the app locked until an activation key for this PC is entered. Browsers and activated apps pass straight through. */
export const LicenseGate = ({ children }: { children: ReactNode }) => {
  const client = useQueryClient();
  const [key, setKey] = useState('');
  const status = useQuery({ queryKey: KEY, enabled: isDesktop(), queryFn: () => ipc(window.pos!.licenseStatus()), staleTime: 60_000 });
  const activate = useMutation({
    mutationFn: () => ipc(window.pos!.licenseActivate(key)),
    onSuccess: (next) => client.setQueryData(KEY, next),
  });

  if (!isDesktop()) return <>{children}</>;
  if (!status.data) return status.isError ? <p className="p-8 text-sm text-danger">Could not check the activation of this copy.</p> : null;
  const s = status.data;
  if (s.state !== 'required') {
    return (
      <>
        {s.state === 'grace' && (
          <div role="status" className="bg-warn-soft px-4 py-2 text-center text-sm text-warn">
            Activate this copy within {s.graceDaysLeft} day{s.graceDaysLeft === 1 ? '' : 's'}: Settings is unaffected, but the app will lock after that. Your PC code is <b>{s.machineCode}</b>.
          </div>
        )}
        {children}
      </>
    );
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Activate Supermarket POS</h1>
      <p className="text-sm text-muted">This copy needs an activation key made for this computer. Send the code below to your supplier, then paste the key you receive.</p>
      <div className="rounded-lg border border-line bg-white p-4">
        <div className="text-xs uppercase tracking-wide text-muted">This computer&apos;s code</div>
        <div className="mt-1 select-all font-mono text-xl font-semibold">{s.machineCode}</div>
      </div>
      <Textarea label="Activation key" rows={4} value={key} onChange={(e) => setKey(e.target.value)} />
      <ErrorNote error={activate.error} />
      <Button onClick={() => activate.mutate()} loading={activate.isPending} disabled={key.trim().length < 20}>Activate</Button>
    </main>
  );
};
