import type { SelfUser } from "@roomadda/shared";

/** Error carrying the HTTP status + the backend's stable error code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RefreshResult {
  accessToken: string;
  user: SelfUser;
}

export interface ApiClient {
  setAccessToken(token: string | null): void;
  getAccessToken(): string | null;
  setOnAuthFailure(cb: () => void): void;
  /** Restore/rotate the session via the httpOnly refresh cookie. */
  refreshSession(): Promise<RefreshResult | null>;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
}

async function toApiError(res: Response): Promise<ApiError> {
  let code = "ERROR";
  let message = res.statusText || "Request failed";
  try {
    const data = (await res.json()) as { error?: { code?: string; message?: string } };
    if (data.error) {
      code = data.error.code ?? code;
      message = data.error.message ?? message;
    }
  } catch {
    // non-JSON body
  }
  return new ApiError(res.status, code, message);
}

/**
 * Fetch wrapper. The access token lives in memory only (never localStorage).
 * On a 401 it transparently refreshes (single-flight) using the httpOnly cookie
 * and retries once; if the refresh also fails it clears the token and signals
 * the app (onAuthFailure) to redirect to login.
 */
export function createApiClient(baseUrl: string): ApiClient {
  let accessToken: string | null = null;
  let onAuthFailure: (() => void) | null = null;
  let refreshing: Promise<RefreshResult | null> | null = null;

  function rawFetch(path: string, init: RequestInit, withAuth: boolean): Promise<Response> {
    const headers = new Headers(init.headers);
    if (withAuth && accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    if (init.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    // credentials:include => send/receive the refresh cookie cross-origin.
    return fetch(`${baseUrl}${path}`, { ...init, headers, credentials: "include" });
  }

  function refreshSession(): Promise<RefreshResult | null> {
    refreshing ??= (async () => {
      try {
        const res = await rawFetch(
          "/v1/auth/refresh",
          { method: "POST", body: JSON.stringify({ client: "web" }) },
          false,
        );
        if (!res.ok) {
          accessToken = null;
          return null;
        }
        const data = (await res.json()) as RefreshResult;
        accessToken = data.accessToken;
        return data;
      } catch {
        return null;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function request<T>(path: string, init: RequestInit): Promise<T> {
    let res = await rawFetch(path, init, true);

    if (res.status === 401) {
      const refreshed = await refreshSession();
      if (refreshed) {
        res = await rawFetch(path, init, true);
      }
      if (res.status === 401) {
        accessToken = null;
        onAuthFailure?.();
        throw await toApiError(res);
      }
    }

    if (!res.ok) throw await toApiError(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  const serialize = (b: unknown): string | undefined => (b !== undefined ? JSON.stringify(b) : undefined);

  return {
    setAccessToken: (token) => {
      accessToken = token;
    },
    getAccessToken: () => accessToken,
    setOnAuthFailure: (cb) => {
      onAuthFailure = cb;
    },
    refreshSession,
    get: <T>(path: string) => request<T>(path, { method: "GET" }),
    post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: serialize(body) }),
    patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body: serialize(body) }),
    put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body: serialize(body) }),
  };
}
