import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, tokenStore } from './api';
import type { SessionUser } from './types';

interface AuthValue {
  session: SessionUser | null;
  loading: boolean;
  can: (...permissions: string[]) => boolean;
  canAny: (...permissions: string[]) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(Boolean(tokenStore.get()));
  const client = useQueryClient();

  const clear = useCallback(() => {
    tokenStore.clear();
    setSession(null);
    client.clear();
  }, [client]);

  useEffect(() => {
    if (!tokenStore.get()) return;
    api<SessionUser>('/auth/me')
      .then(setSession)
      .catch((err: { isNetwork?: boolean }) => {
        // Keep the token when offline so a cashier can keep selling after a page reload.
        if (!err.isNetwork) clear();
        else setSession(JSON.parse(localStorage.getItem('pos.session') ?? 'null') as SessionUser | null);
      })
      .finally(() => setLoading(false));
  }, [clear]);

  useEffect(() => {
    window.addEventListener('auth:expired', clear);
    return () => window.removeEventListener('auth:expired', clear);
  }, [clear]);

  useEffect(() => {
    if (session) localStorage.setItem('pos.session', JSON.stringify(session));
    else localStorage.removeItem('pos.session');
  }, [session]);

  const value = useMemo<AuthValue>(() => {
    const has = (permission: string) => session?.permissions.includes(permission) ?? false;
    return {
      session,
      loading,
      can: (...permissions) => permissions.every(has),
      canAny: (...permissions) => permissions.some(has),
      login: async (email, password) => {
        const result = await api<SessionUser & { token: string }>('/auth/login', { method: 'POST', body: { email, password } });
        tokenStore.set(result.token);
        setSession(result);
        window.dispatchEvent(new Event('cloud:refresh'));
      },
      logout: async () => {
        await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
        clear();
      },
    };
  }, [session, loading, clear]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
};
