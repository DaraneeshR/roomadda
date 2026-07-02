"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SelfUser } from "@roomadda/shared";
import {
  apiFetch,
  onSessionCleared,
  refreshSession,
  setAccessToken,
  type Session,
} from "../../lib/authClient";
import { AuthModal } from "./AuthModal";

type Status = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  user: SelfUser | null;
  status: Status;
  /** Open the login modal. `onSuccess` fires once the user is authenticated. */
  login: (onSuccess?: () => void) => void;
  logout: () => Promise<void>;
  /** Adopt a freshly-issued session (used by the login modal). */
  setSession: (session: Session) => void;
  /** Replace the current user (after a profile update). */
  setUser: (user: SelfUser) => void;
  /** Authenticated same-origin fetch with the 401 refresh-and-retry interceptor. */
  apiFetch: typeof apiFetch;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [user, setUserState] = useState<SelfUser | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [modalOpen, setModalOpen] = useState(false);
  // Callback to run after a successful login (e.g. continue a gated action).
  const onLoginSuccess = useRef<(() => void) | null>(null);

  // Bootstrap: try to rehydrate the session from the httpOnly refresh cookie.
  // Discovery never waits on this — public pages render regardless of the result.
  useEffect(() => {
    let active = true;
    refreshSession().then((session) => {
      if (!active) return;
      if (session) {
        setUserState(session.user);
        setStatus("authenticated");
      } else {
        setStatus("anonymous");
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // If a background refresh fails, the interceptor clears the session — reflect it.
  useEffect(
    () =>
      onSessionCleared(() => {
        setUserState(null);
        setStatus("anonymous");
      }),
    [],
  );

  const setSession = useCallback((session: Session) => {
    setAccessToken(session.accessToken);
    setUserState(session.user);
    setStatus("authenticated");
  }, []);

  const login = useCallback((onSuccess?: () => void) => {
    onLoginSuccess.current = onSuccess ?? null;
    setModalOpen(true);
  }, []);

  const handleAuthenticated = useCallback((session: Session) => {
    setSession(session);
    setModalOpen(false);
    const cb = onLoginSuccess.current;
    onLoginSuccess.current = null;
    cb?.();
  }, [setSession]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setAccessToken(null);
      setUserState(null);
      setStatus("anonymous");
    }
  }, []);

  const setUser = useCallback((next: SelfUser) => setUserState(next), []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, login, logout, setSession, setUser, apiFetch }),
    [user, status, login, logout, setSession, setUser],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      <AuthModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAuthenticated={handleAuthenticated}
      />
    </AuthContext.Provider>
  );
}
