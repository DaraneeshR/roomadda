import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SelfUser } from "@roomadda/shared";
import { api } from "../lib/api";
import { ApiError } from "../lib/apiClient";
import { authApi } from "../api/auth";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  status: AuthStatus;
  user: SelfUser | null;
  login: (phone: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<SelfUser | null>(null);

  // If a refresh fails mid-session, drop to unauthenticated — the guard redirects.
  useEffect(() => {
    api.setOnAuthFailure(() => {
      setUser(null);
      setStatus("unauthenticated");
    });
  }, []);

  // On load the in-memory access token is gone; restore the session via cookie.
  useEffect(() => {
    let active = true;
    void api.refreshSession().then((session) => {
      if (!active) return;
      if (session && session.user.role === "ADMIN") {
        setUser(session.user);
        setStatus("authenticated");
      } else {
        setUser(null);
        setStatus("unauthenticated");
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (phone: string, code: string) => {
    const session = await authApi.verify(phone, code);
    if (session.user.role !== "ADMIN") {
      await authApi.logout();
      throw new ApiError(403, "FORBIDDEN", "This console is for administrators only.");
    }
    setUser(session.user);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, logout }),
    [status, user, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
