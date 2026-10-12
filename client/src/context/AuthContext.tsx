import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '../api/types';
import { api } from '../api/client';

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (identifier: string, pass: string) => Promise<void>;
  register: (email: string, username: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Silent session restore on app load via HTTP-only cookie
  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      try {
        const freshToken = await api.refreshToken();
        if (freshToken && isMounted) {
          setToken(freshToken);
          const meData = await api.getMe();
          if (isMounted) {
            setUser(meData.user);
          }
        }
      } catch {
        if (isMounted) {
          setUser(null);
          setToken(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    restoreSession();

    return () => {
      isMounted = false;
    };
  }, []);

  // Proactive token refresh every 10 minutes (access token TTL is 15m) to keep active sessions alive
  useEffect(() => {
    if (!token) return;

    const interval = setInterval(async () => {
      try {
        const freshToken = await api.refreshToken();
        if (freshToken) {
          setToken(freshToken);
        }
      } catch {
        // Silent catch; on-demand refresh will retry if needed
      }
    }, 10 * 60 * 1000);

    return () => clearInterval(interval);
  }, [token]);

  const login = async (identifier: string, pass: string) => {
    const data = await api.login(identifier, pass);
    setToken(data.accessToken);
    setUser(data.user);
  };

  const register = async (email: string, username: string, pass: string) => {
    await api.register(email, username, pass);
    // Automatically log in after registration
    await login(email, pass);
  };

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
      setToken(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
