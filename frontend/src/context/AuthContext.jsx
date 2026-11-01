import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get, post, setSessionLostHandler } from '../lib/api.js';
import { clearDataCache } from '../pwa.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const endSession = useCallback(async () => {
    setUser(null);
    await clearDataCache();
  }, []);

  useEffect(() => {
    setSessionLostHandler(() => endSession());
    get('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [endSession]);

  const login = useCallback(async (email, password) => {
    const d = await post('/auth/login', { email, password });
    setUser(d.user);
    return d.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await post('/auth/logout');
    } finally {
      await endSession();
    }
  }, [endSession]);

  const refreshMe = useCallback(async () => {
    const d = await get('/auth/me');
    setUser(d.user);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      logout,
      endSession,
      refreshMe,
      can: (...perms) => Boolean(user && perms.some((p) => user.permissions.includes(p))),
    }),
    [user, loading, login, logout, endSession, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
