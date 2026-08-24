/**
 * Authenticated API helper for WorkMithra.
 *
 * Every protected backend endpoint requires `Authorization: Bearer <token>`.
 * `authFetch` reads the session token from storage and injects it, so call
 * sites don't repeat the boilerplate.
 *
 * BASE_URL is the single source of truth for the backend address. All other
 * modules (socket, ai, screens) must import it from here — never re-derive it.
 */
import { Platform } from 'react-native';
import { storage } from '@/lib/storage';

// Dev-only fallback so the app still works on an emulator/simulator without
// EXPO_PUBLIC_API_URL set. Production builds MUST set EXPO_PUBLIC_API_URL.
const DEV_FALLBACK = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://127.0.0.1:8000';
const _envUrl = process.env.EXPO_PUBLIC_API_URL;

if (!_envUrl && !__DEV__) {
  console.warn(
    '[api] EXPO_PUBLIC_API_URL is not set. Falling back to the local dev URL ' +
    `(${DEV_FALLBACK}), which will not work on a real device or in production. ` +
    'Set EXPO_PUBLIC_API_URL in your .env before building for release.',
  );
}

export const BASE_URL = _envUrl || DEV_FALLBACK;

export type AuthSession = {
  id: string | number;
  phone?: string;
  token?: string;
  role?: 'user' | 'worker';
};

/** Read the persisted session (id + token + role). Returns null when logged out. */
export async function getAuth(): Promise<AuthSession | null> {
  try {
    const raw = await storage.get('workmithra:auth');
    if (!raw) return null;
    const auth = JSON.parse(raw);
    if (!auth?.id) return null;
    return auth as AuthSession;
  } catch {
    return null;
  }
}

/** The current user's id as a string, or '' when logged out. */
export async function getAuthId(): Promise<string> {
  const auth = await getAuth();
  return auth ? String(auth.id) : '';
}

/** The current JWT, or '' when logged out. */
export async function getToken(): Promise<string> {
  const auth = await getAuth();
  return auth?.token || '';
}

// ---------------------------------------------------------------------------
// Stale-session recovery.
//
// If the backend rejects an authenticated request with 401 the stored token is
// no longer valid (expired, or the server's JWT_SECRET was rotated). Without
// handling this the app sits in a broken state — it still believes it's logged
// in, so every screen keeps firing requests that all fail. Instead we clear the
// session and let the root layout redirect to the login screen.
// ---------------------------------------------------------------------------
let _onUnauthorized: (() => void) | null = null;

/** Root layout registers the redirect-to-login callback here. */
export function setOnUnauthorized(cb: (() => void) | null): void {
  _onUnauthorized = cb;
}

let _redirecting = false;
async function handleUnauthorized(): Promise<void> {
  try { await storage.remove('workmithra:auth'); } catch {}
  try { await storage.remove('workmithra:profile'); } catch {}
  const cb = _onUnauthorized;
  if (cb && !_redirecting) {
    _redirecting = true;
    // Let concurrent in-flight requests settle before navigating.
    setTimeout(() => {
      _redirecting = false;
      cb();
    }, 0);
  }
}

/**
 * fetch() with the Authorization header attached.
 * For JSON bodies, pass `json` instead of `body` and headers are set for you.
 */
export async function authFetch(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<Response> {
  const token = await getToken();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let body = init.body;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }

  const response = await fetch(`${BASE_URL}${path}`, { ...init, headers, body });
  if (response.status === 401) {
    void handleUnauthorized();
  }
  return response;
}

/** Error thrown by expectJson() when the server responds with a failure status. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Extract a human-readable message from a FastAPI error body.
 * Handles both `{"detail": "..."}` and validation-style
 * `{"detail": [{"msg": "..."}]}` payloads.
 */
export async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data?.detail === 'string') return data.detail;
    if (Array.isArray(data?.detail) && data.detail[0]?.msg) return String(data.detail[0].msg);
    if (typeof data?.message === 'string') return data.message;
  } catch {
    // non-JSON body — fall through to the fallback
  }
  return fallback;
}

/**
 * Throw ApiError when the response is not ok, otherwise parse and return the
 * JSON body. Use this instead of swallowing failures with empty catch blocks:
 *
 *   const data = await expectJson(await authFetch('/bookings'), 'Could not load bookings');
 */
export async function expectJson<T = unknown>(res: Response, fallback = 'Request failed'): Promise<T> {
  if (!res.ok) {
    throw new ApiError(res.status, await readApiError(res, `${fallback} (${res.status})`));
  }
  return res.json() as Promise<T>;
}
