import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../lib/api";

export type Role = "contractor" | "client";

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  created_at: string;
}

type Status = "loading" | "authed" | "anon";

interface AuthState {
  user: User | null;
  token: string | null;
  status: Status;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const TOKEN_KEY = "auth_token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  // Validate the token (and load the user) whenever it changes.
  useEffect(() => {
    if (!token) {
      setUser(null);
      setStatus("anon");
      return;
    }
    let active = true;
    setStatus("loading");
    api<User>("/auth/me", { token })
      .then((u) => {
        if (!active) return;
        setUser(u);
        setStatus("authed");
      })
      .catch(() => {
        if (!active) return;
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
        setStatus("anon");
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function login(email: string, password: string) {
    const res = await api<{ access_token: string }>("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    localStorage.setItem(TOKEN_KEY, res.access_token);
    setToken(res.access_token); // triggers the effect above to load /me
  }

  async function logout() {
    try {
      await api("/auth/logout", { method: "POST", token });
    } catch {
      // stateless logout — ignore network/token errors, we clear locally anyway
    }
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setStatus("anon");
  }

  return (
    <AuthContext.Provider value={{ user, token, status, login, logout }}>
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
