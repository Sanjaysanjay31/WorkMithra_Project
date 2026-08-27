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

import { clearAllWorkMitraStorage, storage } from '@/lib/storage';



// The single source of truth for the backend address.

//

// EXPO_PUBLIC_API_URL is inlined by Expo at build time (it is NOT supplied by

// app.json). When it is set we use it verbatim — that is the deployed backend

// for release builds. When it is unset we fall back to a local dev URL so the

// app still runs during `npm start` without editing source. A release build

// with the variable unset is a misconfiguration: warn loudly instead of

// silently shipping a hardcoded production URL.

const ENV_URL = (process.env.EXPO_PUBLIC_API_URL || '').trim();

const DEV_FALLBACK =

  Platform.OS === 'android'

    ? 'http://10.0.2.2:8000'

    : 'http://127.0.0.1:8000';



export const BASE_URL = ENV_URL || DEV_FALLBACK;



if (ENV_URL && __DEV__ === false) {

  // Release build — the env var is the single source of truth.

} else if (!ENV_URL) {

  console.warn(

    '[workmithra] EXPO_PUBLIC_API_URL is not set — falling back to ' +

      DEV_FALLBACK +

      '. Set it to the deployed backend before building for release.'

  );

}



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

  // The session is dead server-side. Wipe EVERYTHING cached for this account

  // (auth + all screen caches) so nothing leaks into the next login, then let

  // the root layout disconnect the socket and return to /login.

  try { await clearAllWorkMitraStorage(); } catch {}

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

 *

 * Also adds a request timeout (default 30s) so a dead server can't hang a

 * screen forever, and normalizes headers/path so callers can pass any shape.

 */

const DEFAULT_TIMEOUT_MS = 30000;



export async function authFetch(

  path: string,

  init: RequestInit & { json?: unknown; timeoutMs?: number } = {},

): Promise<Response> {

  const { json, timeoutMs, signal: callerSignal, ...rest } = init;



  const token = await getToken();

  const headers = new Headers(init.headers as HeadersInit | undefined);

  if (token) headers.set('Authorization', `Bearer ${token}`);



  let body = rest.body;

  if (json !== undefined) {

    headers.set('Content-Type', 'application/json');

    body = JSON.stringify(json);

  }



  // Paths must start with a single '/'.

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;



  // Abort if the server doesn't respond in time. A caller-provided signal is

  // honored too — whichever fires first aborts the request.

  const controller = new AbortController();

  const timeoutId = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const onCallerAbort = () => controller.abort();

  if (callerSignal) {

    if (callerSignal.aborted) controller.abort();

    else if (typeof callerSignal.addEventListener === 'function') {

      callerSignal.addEventListener('abort', onCallerAbort, { once: true });

    }

  }



  try {

    const response = await fetch(`${BASE_URL}${normalizedPath}`, {

      ...rest,

      headers,

      body,

      signal: controller.signal,

    });

    if (response.status === 401 && token) {

      // Only a 401 on a request we ACTUALLY authenticated means the stored
      // session is dead. A 401 with no token (logged-out visitor touching a
      // protected endpoint, e.g. the AI assistant on the landing page) just
      // means "needs auth" — wiping storage and force-redirecting to /login
      // there would strand/lose any in-progress public screen.

      void handleUnauthorized();

    }

    return response;

  } finally {

    clearTimeout(timeoutId);

    if (callerSignal && typeof callerSignal.removeEventListener === 'function') {

      callerSignal.removeEventListener('abort', onCallerAbort);

    }

  }

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

  // 204 No Content and empty bodies are not JSON — return undefined instead of

  // letting res.json() throw on an empty body.

  if (res.status === 204) return undefined as T;

  const text = await res.text();

  if (!text) return undefined as T;

  try {

    return JSON.parse(text) as T;

  } catch {

    throw new ApiError(res.status, `${fallback}: server returned an invalid response`);

  }

}

