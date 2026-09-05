/**
 * Multipart file upload that works on native (Android/iOS) AND web.
 *
 * Expo SDK 57's global fetch (winter runtime) only accepts string / Blob /
 * bytes() FormData parts — the classic React Native `{ uri, name, type }`
 * file part throws "Unsupported FormDataPart implementation" on device.
 * XMLHttpRequest still routes through the native networking module, which
 * DOES support uri parts, so every upload in the app goes through XHR here.
 * Do NOT "simplify" call sites back to authFetch/fetch with FormData.
 */
import { BASE_URL, getToken } from '@/lib/api';

export type UploadFilePart = File | { uri: string; name: string; type: string };

export async function uploadMultipart<T = Record<string, unknown>>(
  path: string,
  file: UploadFilePart,
  opts: {
    fieldName?: string;
    fields?: Record<string, string>;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const token = await getToken();
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { xhr.abort(); } catch {}
      reject(new Error('Upload timed out. Check your connection and try again.'));
    }, opts.timeoutMs ?? 60000);
    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { xhr.abort(); } catch {}
      reject(new Error(msg));
    };
    xhr.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let data: Record<string, unknown> = {};
      try { data = xhr.responseText ? JSON.parse(xhr.responseText) as Record<string, unknown> : {}; } catch { data = {}; }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data as T);
        return;
      }
      // Mirror readApiError(): prefer the server's `detail` (string or 422
      // array) so backend validation messages survive the trip.
      const detail = data?.detail;
      const message = typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((e: unknown) => (typeof e === 'object' && e !== null && 'msg' in e
              ? String((e as { msg: unknown }).msg)
              : String(e))).join(', ')
          : `Upload failed (${xhr.status})`;
      reject(new Error(message));
    };
    xhr.onerror = () => fail('Could not reach the server. Check your connection and try again.');
    xhr.ontimeout = () => fail('Upload timed out. Check your connection and try again.');
    try {
      xhr.open('POST', `${BASE_URL}${normalizedPath}`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      // Never set Content-Type manually — XHR generates the multipart
      // boundary itself; a manual value breaks the upload.
      const fd = new FormData();
      // @ts-ignore RN FormData file shape ({ uri, name, type }) on native.
      fd.append(opts.fieldName ?? 'file', file as any);
      for (const [k, v] of Object.entries(opts.fields ?? {})) fd.append(k, v);
      xhr.send(fd);
    } catch (e: unknown) {
      fail(e instanceof Error ? e.message : 'Could not start the upload');
    }
  });
}
