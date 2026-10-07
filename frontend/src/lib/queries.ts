import { keepPreviousData, useQuery } from '@tanstack/react-query';
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

/** Store settings. Also tells the formatters which currency to show. */
export const loadSettings = async () => {
  const settings = await api<Settings>('/settings');
  setCurrency(settings.currency);
  return settings;
};
