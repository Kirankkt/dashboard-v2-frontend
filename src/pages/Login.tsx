import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { IconCheck } from "../components/icons";
import type { ApiError } from "../lib/api";

export default function Login() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in? Skip the login screen.
  useEffect(() => {
    if (status === "authed") navigate("/", { replace: true });
  }, [status, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError((err as ApiError)?.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-split">
        <aside className="auth-side" aria-hidden="true">
          <div className="auth-side-brand">
            <div className="auth-logo">R</div>
            <span>Remodel Project</span>
          </div>
          <div className="auth-side-body">
            <h1>Your build,<br />at a glance.</h1>
            <ul>
              <li><IconCheck />Live task &amp; progress tracking</li>
              <li><IconCheck />Full project calendar</li>
              <li><IconCheck />One dashboard for everyone on site</li>
            </ul>
          </div>
          <div className="auth-side-foot">Construction dashboard</div>
        </aside>

        <div className="auth-card">
          <div className="auth-brand">
            <div className="auth-logo" aria-hidden="true">R</div>
            <div>
              <div className="auth-title">Remodel Project</div>
              <div className="auth-sub">Construction dashboard</div>
            </div>
          </div>

          <h2 className="auth-head">Welcome back</h2>
          <p className="auth-lede">Sign in to continue to your dashboard.</p>

          <form className="auth-form" onSubmit={onSubmit}>
            {error && <div className="auth-error" role="alert">{error}</div>}

            <div className="field">
              <label className="label" htmlFor="email">Email</label>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>

            <p className="hint" style={{ textAlign: "center", margin: 0 }}>
              Private workspace — accounts are issued by the project owner.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
