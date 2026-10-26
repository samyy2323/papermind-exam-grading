import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { login as apiLogin, register as apiRegister } from '../api';
import { AUTH_KEY } from '../api/client';

const AuthContext = createContext(null);

function readStored() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStored);

  const start = useCallback((u) => {
    setUser(u);
    try {
      localStorage.setItem(AUTH_KEY, JSON.stringify(u));
    } catch {
      /* ignore */
    }
    return u;
  }, []);

  const login = useCallback(async (email, password) => start(await apiLogin(email, password)), [start]);
  const register = useCallback(async (name, email, password) => start(await apiRegister(name, email, password)), [start]);

  const logout = useCallback(() => {
    setUser(null);
    try {
      localStorage.removeItem(AUTH_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(() => ({ user, login, register, logout }), [user, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
