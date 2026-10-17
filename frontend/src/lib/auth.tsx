import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, tokenStore } from './api';
import type { SessionUser } from './types';

export type SessionResult = SessionUser & { token: string };
export type ApprovalState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED' | 'COMPLETED' | 'FAILED';
export type LoginStep = { kind: 'done' } | { kind: 'emailApproval'; requestToken: string; secondsLeft: number; emailHint: string };

type LoginResponse = SessionResult | { nextStep: 'emailApproval'; requestToken: string; secondsLeft: number; emailHint: string };

interface AuthValue {
  session: SessionUser | null;
  loading: boolean;
  can: (...permissions: string[]) => boolean;
  canAny: (...permissions: string[]) => boolean;
  login: (email: string, password: string) => Promise<LoginStep>;
  /** Asks the server about a pending sign-in. Once it was approved, collects the session and signs in. */
  checkApproval: (requestToken: string) => Promise<{ status: ApprovalState; secondsLeft: number }>;
  cancelApproval: (requestToken: string) => Promise<void>;
  startSession: (result: SessionResult) => void;
  reloadSession: () => Promise<void>;
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
        // Keep the session while offline so cashiers can carry on selling.
        if (!err.isNetwork) clear();
        else {
          try { setSession(JSON.parse(localStorage.getItem('pos.session') ?? 'null') as SessionUser | null); } catch { setSession(null); }
        }
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
    const startSession = (result: SessionResult) => {
      tokenStore.set(result.token);
      setSession(result);
      window.dispatchEvent(new Event('cloud:refresh'));
    };
    return {
      session,
      loading,
      startSession,
      can: (...permissions) => permissions.every(has),
      canAny: (...permissions) => permissions.some(has),
      login: async (email, password) => {
        const result = await api<LoginResponse>('/auth/login', { method: 'POST', body: { email, password } });
        if ('nextStep' in result) return { kind: 'emailApproval', requestToken: result.requestToken, secondsLeft: result.secondsLeft, emailHint: result.emailHint };
        startSession(result);
        return { kind: 'done' };
      },
      checkApproval: async (requestToken) => {
        const state = await api<{ status: ApprovalState; secondsLeft: number }>('/auth/login/approval/status', { method: 'POST', body: { requestToken } });
        if (state.status !== 'APPROVED') return state;
        startSession(await api<SessionResult>('/auth/login/approval/complete', { method: 'POST', body: { requestToken } }));
        return { status: 'COMPLETED', secondsLeft: 0 };
      },
      cancelApproval: async (requestToken) => {
        await api('/auth/login/approval/cancel', { method: 'POST', body: { requestToken } });
      },
      reloadSession: async () => { setSession(await api<SessionUser>('/auth/me')); },
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
