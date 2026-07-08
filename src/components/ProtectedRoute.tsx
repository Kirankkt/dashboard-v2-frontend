import type { ReactElement } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function ProtectedRoute({ children }: { children: ReactElement }) {
  const { status } = useAuth();
  if (status === "loading") return <div className="app-loading">Loading…</div>;
  if (status === "anon") return <Navigate to="/login" replace />;
  return children;
}
