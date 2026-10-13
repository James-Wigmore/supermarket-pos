import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from './auth';
import { api } from './api';
import { setCurrency } from './format';
import type { Page, Settings } from './types';

type Query = Record<string, string | number | boolean | undefined | null>;

export const usePage = <T,>(key: string, path: string, query: Query = {}, enabled = true) =>
  useQuery({ queryKey: [key, path, query], queryFn: () => api<Page<T>>(path, { query }), placeholderData: keepPreviousData, enabled });

/** Small reference lists (categories, suppliers...) cached for a minute. */
export const useRefList = <T,>(path: string, enabled = true) =>
  useQuery({ queryKey: ['ref', path], queryFn: async () => (await api<Page<T>>(path, { query: { pageSize: 200 } })).data, staleTime: 60_000, enabled });

export const useBranches = (enabled = true) =>
  useQuery({ queryKey: ['ref', '/branches'], queryFn: () => api<import('./types').Branch[]>('/branches'), staleTime: 60_000, enabled });

/**
 * Branch to act on. Branch users always use their own (nothing to send); super admins must pick one,
 * and it is preselected when the store has a single active branch.
 */
export const useBranchChoice = () => {
  const isAdmin = useAuth().session?.user.role === 'SUPER_ADMIN';
  const branches = useBranches(isAdmin);
  const [chosen, setChosen] = useState('');
  const active = branches.data?.filter((b) => b.isActive) ?? [];
  const branchId = chosen || (active.length === 1 ? active[0]!.id : '');
  return { isAdmin, branches: active, branchId, name: active.find((b) => b.id === branchId)?.name, setBranchId: setChosen, missing: isAdmin && !branchId };
};
export type BranchChoice = ReturnType<typeof useBranchChoice>;

/** Store settings. Also tells the formatters which currency to show. */
export const loadSettings = async () => {
  const settings = await api<Settings>('/settings');
  setCurrency(settings.currency);
  return settings;
};
