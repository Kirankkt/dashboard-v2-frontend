import type { ReactElement } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function ProtectedRoute({ children }: { children: ReactElement }) {
  const { status, reconnecting } = useAuth();
  if (status === "loading")
    return <div className="app-loading">{reconnecting ? "Can't reach the server — trying again…" : "Loading…"}</div>;
  if (status === "anon") return <Navigate to="/login" replace />;
  return children;
}
