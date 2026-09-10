'use client';
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { Identity } from '@nau/domain';
import { api, post } from '../lib/api';
type Health = {
  llmProvider: string;
  demoLogin: boolean;
  demoPasswordPreset: boolean;
  retentionDays: number;
  ssoConfigured: boolean;
  dataMode: string;
};
const AppContext = createContext<{
  identity: Identity | null;
  health: Health | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}>({
  identity: null,
  health: null,
  loading: true,
  error: '',
  refresh: async () => {},
  logout: async () => {},
});
export function AppProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null),
    [health, setHealth] = useState<Health | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const [s, h] = await Promise.all([api('/auth/session'), api('/health')]);
      setIdentity(s.identity);
      setHealth(h);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function logout() {
    await post('/auth/logout');
    setIdentity(null);
    window.location.assign('/');
  }
  return (
    <AppContext.Provider value={{ identity, health, loading, error, refresh, logout }}>
      {children}
    </AppContext.Provider>
  );
}
export const useApp = () => useContext(AppContext);
