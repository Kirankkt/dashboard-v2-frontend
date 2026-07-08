const BASE = (
  import.meta.env.VITE_API_BASE ??
  "https://dashboard-v2-backend-production.up.railway.app"
).replace(/\/+$/, "");

export interface ApiError {
  status: number;
  message: string;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;

  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message =
      (data && (data.detail || data.message)) || res.statusText || "Request failed";
    throw { status: res.status, message } as ApiError;
  }
  return data as T;
}

export const API_BASE = BASE;
