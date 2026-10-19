import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api, setAuthLostHandler } from "../lib/api";
import type { ApiError } from "../lib/api";

export type Role = "contractor" | "client";

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  created_at: string;
  /** Server-granted: may do everything the contractor can. */
  full_access?: boolean;
}

// eslint-disable-next-line react-refresh/only-export-components
/** Whether the user may create, edit and delete — mirrors the API's rule. */
export function canEdit(user: User | null): boolean {
  return user?.role === "contractor" || !!user?.full_access;
}

type Status = "loading" | "authed" | "anon";

interface AuthState {
  user: User | null;
  token: string | null;
  status: Status;
  /** The session ended on its own (expired or revoked), rather than by signing
   *  out — the login screen says so instead of leaving the user guessing. */
  expired: boolean;
  /** Holding a valid session open while the server is unreachable. */
  reconnecting: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const TOKEN_KEY = "auth_token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [expired, setExpired] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [retry, setRetry] = useState(0);

  // Any request rejected for a dead token ends the session once, here, so a
  // contractor mid-update gets sent to the login screen with a reason instead
  // of a save that quietly fails.
  useEffect(() => {
    setAuthLostHandler(() => {
      if (!localStorage.getItem(TOKEN_KEY)) return;
      localStorage.removeItem(TOKEN_KEY);
      setExpired(true);
      setToken(null);
      setUser(null);
      setStatus("anon");
    });
    return () => setAuthLostHandler(null);
  }, []);

  // Validate the token (and load the user) whenever it changes.
  useEffect(() => {
    if (!token) {
      setUser(null);
      setStatus("anon");
      return;
    }
    let active = true;
    let timer = 0;
    setStatus((s) => (s === "authed" ? s : "loading"));
    api<User>("/auth/me", { token })
      .then((u) => {
        if (!active) return;
        setUser(u);
        setStatus("authed");
        setReconnecting(false);
      })
      .catch((e) => {
        if (!active) return;
        if ((e as ApiError)?.status === 401) {
          // Handled by the auth-lost handler above; nothing to keep.
          setStatus("anon");
          return;
        }
        // The server was unreachable, which is not a reason to throw away a
        // working session — a site with one bar would log the contractor out
        // every time the app reloaded. Hold it and keep trying.
        setReconnecting(true);
        timer = window.setTimeout(() => setRetry((n) => n + 1), 5000);
      });
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [token, retry]);

  async function login(email: string, password: string) {
    const res = await api<{ access_token: string }>("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    localStorage.setItem(TOKEN_KEY, res.access_token);
    setExpired(false);
    setToken(res.access_token); // triggers the effect above to load /me
  }

  async function logout() {
    try {
      await api("/auth/logout", { method: "POST", token });
    } catch {
      // stateless logout — ignore network/token errors, we clear locally anyway
    }
    localStorage.removeItem(TOKEN_KEY);
    setExpired(false);
    setToken(null);
    setUser(null);
    setStatus("anon");
  }

  return (
    <AuthContext.Provider value={{ user, token, status, expired, reconnecting, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
