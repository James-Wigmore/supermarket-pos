import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import type { Named } from '../lib/types';
import { Button, ErrorNote, Input, Modal, Select, useToast } from './ui';

interface ReferenceSelectProps {
  label: string;
  path: '/categories' | '/suppliers';
  options: Named[];
  value: string;
  onChange: (value: string) => void;
  canAdd: boolean;
  emptyLabel?: string;
}

export const ReferenceSelect = ({ label, path, options, value, onChange, canAdd, emptyLabel = 'None' }: ReferenceSelectProps) => {
  const client = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: () => api<Named>(path, { method: 'POST', body: { name: name.trim() } }),
    onSuccess: async (created) => {
      onChange(created.id);
      setName('');
      setAdding(false);
      toast('success', `${label} added`);
      await client.invalidateQueries({ queryKey: ['ref'] });
      await client.invalidateQueries({ queryKey: [path.slice(1)] });
    },
  });

  return (
    <>
      <div className="flex items-end gap-1">
        <Select label={label} value={value} onChange={(e) => onChange(e.target.value)} className="min-w-0 flex-1">
          <option value="">{emptyLabel}</option>
          {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </Select>
        {canAdd && <Button type="button" variant="secondary" size="sm" className="mb-0.5 shrink-0" onClick={() => setAdding(true)}>Add</Button>}
      </div>
      <Modal open={adding} onClose={() => setAdding(false)} title={`Add ${label.toLowerCase()}`} width="sm"
        footer={<><Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button><Button onClick={() => add.mutate()} loading={add.isPending} disabled={!name.trim()}>Save</Button></>}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate(); }}>
          <Input label={`${label} name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={path === '/categories' ? 100 : 150} autoFocus />
          <ErrorNote error={add.error} />
          <button type="submit" hidden />
        </form>
      </Modal>
    </>
  );
};