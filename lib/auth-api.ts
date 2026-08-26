/**
 * Auth API service — the single place that talks to the backend's auth
 * endpoints (/login, /register, /send-otp, /verify-otp, /reset-password).
 *
 * Screens import these instead of hand-rolling fetch() calls, so headers,
 * URL handling, and error extraction stay consistent.
 */
import { BASE_URL } from '@/lib/api';

/** Error thrown when the server responds with a failure status. */
export class AuthApiError extends Error {
  status: number;
  /** Raw `detail` from the FastAPI body (string, or array for 422 validation). */
  detail: unknown;
  constructor(status: number, detail: unknown, message: string) {
    super(message);
    this.name = 'AuthApiError';
    this.status = status;
    this.detail = detail;
  }
}

/** One entry of FastAPI's 422 `detail` array. */
export interface FastApiValidationError {
  loc: (string | number)[];
  msg: string;
  type: string;
}

/** True when `detail` is FastAPI's 422 validation-error array. */
export function isValidationErrors(detail: unknown): detail is FastApiValidationError[] {
  return Array.isArray(detail) && detail.every((e) => e && Array.isArray(e.loc) && typeof e.msg === 'string');
}

async function postJson<T>(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
  let data: any = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const message = typeof data?.detail === 'string'
      ? data.detail
      : `Server responded with ${res.status}`;
    throw new AuthApiError(res.status, data?.detail, message);
  }
  return data as T;
}

export interface LoginResponse {
  message?: string;
  access_token?: string;
  user?: { id: number; full_name?: string; email?: string; role?: string };
}

export function loginRequest(identifier: string, password: string, role: 'user' | 'worker') {
  return postJson<LoginResponse>('/login', { identifier, password, role });
}

export interface RegisterPayload {
  full_name: string;
  phone: string;
  email: string;
  password: string;
  role: 'user' | 'worker';
  /**
   * Proof the registrant completed the email OTP challenge. Issued by
   * /verify-otp; the backend rejects registrations without it so accounts
   * can't be created with unverified (or someone else's) email.
   */
  verify_token?: string;
}

export function registerRequest(payload: RegisterPayload) {
  // The proof token travels in the X-Verify-Token header — NOT the URL.
  // Query strings land in server/proxy access logs; headers don't. (The
  // backend still accepts the query-param form for older clients.)
  const { verify_token, ...body } = payload;
  const extraHeaders = verify_token ? { 'X-Verify-Token': verify_token } : undefined;
  return postJson<{ id?: number; full_name?: string; email?: string; role?: string }>('/register', body, extraHeaders);
}

export function sendOtp(email: string) {
  return postJson<{ message?: string }>('/send-otp', { email });
}

export function verifyOtp(email: string, otp: string) {
  return postJson<{ message?: string; reset_token?: string; verify_token?: string; user?: unknown }>('/verify-otp', { email, otp });
}

export function resetPassword(email: string, password: string, otpToken: string) {
  return postJson<{ message?: string }>('/reset-password', { email, password, otp_token: otpToken });
}
