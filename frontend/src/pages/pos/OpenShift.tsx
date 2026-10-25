import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, ErrorNote, Input, Loading, Panel, Select } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { Page, Register } from '../../lib/types';
import { currencyCode, typed } from '../../lib/format';

export const OpenShift = () => {
  const client = useQueryClient();
  const { can } = useAuth();
  const registers = useQuery({ queryKey: ['registers'], queryFn: () => api<Page<Register>>('/registers', { query: { isActive: true, pageSize: 50 } }) });
  const [registerId, setRegisterId] = useState('');
  const [cash, setCash] = useState('');
  const open = useMutation({
    mutationFn: () => api('/sessions', { method: 'POST', body: { registerId: registerId || registers.data?.data[0]?.id, openingCash: cash.trim() === '' ? 0 : typed(cash) } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['session'] }),
  });

  if (registers.isLoading) return <Loading />;
  return (
    <div className="grid h-full place-items-center p-4">
      <Panel title="Start your shift" className="w-full max-w-sm">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); open.mutate(); }}>
          <Select label="Register" value={registerId} onChange={(e) => setRegisterId(e.target.value)}>
            {registers.data?.data.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
          <Input label={`Opening cash in drawer (${currencyCode()})`} inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0" autoFocus error={cash.trim() !== '' && Number.isNaN(typed(cash)) ? 'Enter numbers only, e.g. 50000' : undefined} />
          <ErrorNote error={open.error} />
          <Button type="submit" size="lg" className="w-full" loading={open.isPending} disabled={!registers.data?.data.length || (cash.trim() !== '' && Number.isNaN(typed(cash)))}>Open shift</Button>
          {can('dashboard:read') && <Link to="/" className="block rounded-field border border-line px-3 py-2.5 text-center text-sm font-semibold hover:bg-paper">Back to home</Link>}
          {!registers.data?.data.length && <p className="text-sm text-muted">No registers exist for this branch. Ask a manager to add one under Settings.</p>}
        </form>
      </Panel>
    </div>
  );
};
