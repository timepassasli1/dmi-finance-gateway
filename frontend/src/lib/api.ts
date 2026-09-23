export const API_URL = process.env.NEXT_PUBLIC_API_URL || "/gw";

export class APIError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function redirectToLogin() {
  if (typeof window === "undefined") return;
  const path = window.location.pathname || "";
  if (path.startsWith("/auth/")) return;
  clearToken();
  const next = encodeURIComponent(path + window.location.search);
  window.location.href = `/auth/login?next=${next}`;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: { message?: string; code?: string } }).error || {};
    const message = err.message || "Request failed";
    if (
      res.status === 401 &&
      !path.startsWith("/v1/auth/login") &&
      !path.startsWith("/v1/auth/register")
    ) {
      redirectToLogin();
    }
    throw new APIError(message, err.code || "UNKNOWN", res.status);
  }
  return data as T;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("gateway_token");
}

export function setToken(token: string) {
  localStorage.setItem("gateway_token", token);
}

export function clearToken() {
  localStorage.removeItem("gateway_token");
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }, getToken() || undefined),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }, getToken() || undefined),
  postWithKey: <T>(path: string, body: unknown, apiKey: string) =>
    request<T>(path, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { Authorization: `Bearer ${apiKey}` },
    }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }, getToken() || undefined),
  delete: <T>(path: string) =>
    request<T>(path, { method: "DELETE" }, getToken() || undefined),
  upload: async <T>(path: string, form: FormData): Promise<T> => {
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${API_URL}${path}`, { method: "POST", headers, body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = (data as { error?: { message?: string; code?: string } }).error || {};
      if (res.status === 401) redirectToLogin();
      throw new APIError(err.message || "Upload failed", err.code || "UNKNOWN", res.status);
    }
    return data as T;
  },
};
