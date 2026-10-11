import { io } from 'socket.io-client';

// Access token lives in memory only. The refresh token is the httpOnly cookie.
let token = null;
let refreshing = null;
let authLost = () => {};
const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };

export const setToken = (t) => (token = t);
export const setAuthLost = (f) => (authLost = f);

export class ApiError extends Error {
  constructor(status, e) {
    super(e?.message || 'Something went wrong');
    this.status = status;
    this.code = e?.code;
  }
}

// One refresh at a time, so token rotation never races.
export function refresh() {
  refreshing ||= fetch('/api/auth/refresh', { method: 'POST', credentials: 'include', headers: CSRF })
    .then(async (r) => {
      if (!r.ok) throw new ApiError(r.status);
      const d = await r.json();
      token = d.accessToken;
      return d;
    })
    .finally(() => (refreshing = null));
  return refreshing;
}

export async function api(path, { method = 'GET', body, form, raw, retry = true } = {}) {
  const isPublic = path.startsWith('/s/'); // public share routes never use the login token
  const headers = { ...CSRF };
  if (token && !isPublic) headers.Authorization = 'Bearer ' + token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch('/api' + path, {
    method,
    headers,
    credentials: 'include',
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  if (r.status === 401 && retry && token && !isPublic) {
    try {
      await refresh();
    } catch {
      token = null;
      authLost();
      throw new ApiError(401, { message: 'Session expired. Please sign in again.' });
    }
    return api(path, { method, body, form, raw, retry: false });
  }
  if (!r.ok) throw new ApiError(r.status, (await r.json().catch(() => ({}))).error);
  if (raw) return r;
  return r.status === 204 ? null : r.json().catch(() => null);
}

export async function saveBlob(res, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Multipart upload with progress (fetch has no upload progress events).
export function upload(roomId, file, onProgress, retry = true) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', `/api/rooms/${roomId}/files`);
    x.withCredentials = true;
    x.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    if (token) x.setRequestHeader('Authorization', 'Bearer ' + token);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    x.onerror = () => reject(new ApiError(0, { message: 'Network error' }));
    x.onload = async () => {
      if (x.status === 401 && retry) {
        try {
          await refresh();
          return resolve(upload(roomId, file, onProgress, false));
        } catch {
          return reject(new ApiError(401, { message: 'Session expired' }));
        }
      }
      let d = null;
      try { d = JSON.parse(x.responseText); } catch {}
      x.status < 300 ? resolve(d) : reject(new ApiError(x.status, d?.error));
    };
    const fd = new FormData();
    fd.append('file', file);
    x.send(fd);
  });
}

// Token goes in the handshake `auth` (never the URL); the function form re-reads it on reconnect.
export function openSocket() {
  const s = io({ auth: (cb) => cb({ token }) });
  s.on('connect_error', () => refresh().catch(() => {}));
  return s;
}
