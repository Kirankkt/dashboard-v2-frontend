const BASE = (
  import.meta.env.VITE_API_BASE ??
  "https://dashboard-v2-backend-production.up.railway.app"
).replace(/\/+$/, "");

export type ErrorKind = "offline" | "timeout" | "server" | "auth" | "http";

export interface ApiError {
  /** 0 when the request never reached the server. */
  status: number;
  message: string;
  kind: ErrorKind;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
  /** Override the per-request timeout (ms). */
  timeoutMs?: number;
}

// A phone on site drops to one bar and comes back; a request that is going to
// fail should fail quickly enough to retry, and retry quietly before bothering
// the user. Anything still failing after this is shown to them.
const TIMEOUT_MS = 20000;
const RETRY_DELAYS = [400, 1500];

let onAuthLost: (() => void) | null = null;
/** The auth layer registers here so an expired token logs the user out once,
 *  instead of every save failing with a confusing error. */
export function setAuthLostHandler(fn: (() => void) | null) {
  onAuthLost = fn;
}

function fail(status: number, message: string, kind: ErrorKind): ApiError {
  return { status, message, kind };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** FastAPI sends `detail` as a string, or as a list of objects for validation
 *  errors — never show the user "[object Object]". */
function detailOf(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = (data as { detail?: unknown; message?: unknown }).detail ?? (data as { message?: unknown }).message;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    const first = d[0] as { msg?: unknown; loc?: unknown } | undefined;
    if (first && typeof first.msg === "string") {
      const field = Array.isArray(first.loc) ? String(first.loc[first.loc.length - 1]) : "";
      return field ? `${field}: ${first.msg}` : first.msg;
    }
  }
  return null;
}

async function attempt<T>(path: string, opts: RequestOptions, method: string, retrying: boolean): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    if (ctrl.signal.aborted) throw fail(0, "The server didn't answer in time.", "timeout");
    throw fail(0, navigator.onLine === false ? "You're offline." : "Couldn't reach the server.", "offline");
  } finally {
    clearTimeout(timer);
  }

  // A 502 page from the host is HTML, not JSON — parsing it must not become
  // the error the user sees.
  const text = await res.text().catch(() => "");
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    // A retried DELETE that actually went through the first time comes back
    // 404 — that's the outcome we wanted, not a failure.
    if (res.status === 404 && method === "DELETE" && retrying) return null as T;
    if (res.status === 401 && opts.token) {
      onAuthLost?.();
      throw fail(401, "Your session has ended — sign in again.", "auth");
    }
    if (res.status >= 500) throw fail(res.status, "The server had a problem.", "server");
    throw fail(res.status, detailOf(data) || res.statusText || "Request failed", "http");
  }
  return data as T;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = (opts.method ?? "GET").toUpperCase();
  // A POST creates something: repeating one whose reply was lost would add the
  // row twice. GET/PATCH/DELETE all land on the same state however often they
  // run, so those are safe to repeat through a bad connection.
  const repeatable = method !== "POST";
  for (let i = 0; ; i++) {
    try {
      return await attempt<T>(path, opts, method, i > 0);
    } catch (e) {
      const err = e as ApiError;
      const worthRetrying = err.kind === "offline" || err.kind === "timeout" || err.kind === "server";
      if (!repeatable || !worthRetrying || i >= RETRY_DELAYS.length) throw err;
      await sleep(RETRY_DELAYS[i]);
    }
  }
}

/** One sentence to show the user when a save didn't go through. */
export function saveError(e: unknown, what: string): string {
  const err = e as ApiError | undefined;
  const why = err?.message ?? "Something went wrong.";
  if (err?.kind === "auth") return why;
  return `${what} wasn't saved — ${why.charAt(0).toLowerCase()}${why.slice(1)}`;
}

export const API_BASE = BASE;
