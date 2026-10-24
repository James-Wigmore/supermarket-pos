import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, tokenStore } from './api';
import { isDesktop } from './desktop';
import type { CloudStatus } from './types';
import { QUEUE_EVENT, queue, syncQueue } from './offline';

export type ConnectionState = 'ONLINE' | 'OFFLINE' | 'SYNCING';
interface SyncValue { state: ConnectionState; online: boolean; syncing: boolean; pending: number; failed: number; syncNow: () => Promise<void>; cloud: CloudStatus | null }

const SyncContext = createContext<SyncValue | null>(null);
const HEALTH_INTERVAL_MS = 15_000;

export const SyncProvider = ({ children }: { children: ReactNode }) => {
  const [online, setOnline] = useState(navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const [counts, setCounts] = useState({ pending: 0, failed: 0 });
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const client = useQueryClient();

  const refreshCounts = useCallback(async () => {
    const items = await queue.list();
    setCounts({ pending: items.filter((i) => i.status === 'pending').length, failed: items.filter((i) => i.status === 'failed').length });
  }, []);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const { sent } = await syncQueue();
      if (sent) await client.invalidateQueries();
    } catch {
      setOnline(false);
    } finally {
      setSyncing(false);
      await refreshCounts();
    }
  }, [client, refreshCounts]);

  useEffect(() => {
    const check = async () => {
      try {
        await api('/health');
        setOnline(true);
      } catch {
        setOnline(false);
      }
    };
    // Google Sheets status (desktop app only). It never affects selling: the POS works from its local database.
    const checkCloud = async () => {
      if (!isDesktop() || !tokenStore.get()) return setCloud(null);
      setCloud(await api<CloudStatus>('/sync/status').catch(() => null));
    };
    const goOnline = () => void check();
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    window.addEventListener(QUEUE_EVENT, refreshCounts);
    const timer = setInterval(() => void Promise.all([check(), checkCloud()]), HEALTH_INTERVAL_MS);
    window.addEventListener('cloud:refresh', checkCloud);
    // Initial probe of connectivity and the local queue (external systems), results arrive asynchronously.
    void check();
    void checkCloud();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshCounts();
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener(QUEUE_EVENT, refreshCounts);
      window.removeEventListener('cloud:refresh', checkCloud);
      clearInterval(timer);
    };
  }, [refreshCounts]);

  useEffect(() => {
    // Upload queued sales as soon as the connection is back.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (online && counts.pending > 0 && !syncing) void syncNow();
  }, [online, counts.pending, syncing, syncNow]);

  const value = useMemo<SyncValue>(
    () => ({ state: syncing ? 'SYNCING' : online ? 'ONLINE' : 'OFFLINE', online, syncing, ...counts, syncNow, cloud }) as SyncValue,
    [online, syncing, counts, syncNow, cloud],
  );
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
};

export const useSync = () => {
  const value = useContext(SyncContext);
  if (!value) throw new Error('useSync must be used inside SyncProvider');
  return value;
};
