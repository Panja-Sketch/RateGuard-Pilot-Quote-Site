// API client. The bearer token lives in sessionStorage (per-tab convenience; the page works without it).
const KEY = 'pilot.session';
let memory = null;

export function getSession() {
  if (memory) return memory;
  try { const raw = sessionStorage.getItem(KEY); memory = raw ? JSON.parse(raw) : null; } catch { memory = null; }
  return memory;
}
export function setSession(s) {
  memory = s;
  try { s ? sessionStorage.setItem(KEY, JSON.stringify(s)) : sessionStorage.removeItem(KEY); } catch { /* storage unavailable: keep in memory */ }
}

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Request failed (${status})`);
    this.status = status; this.code = body?.error?.code || 'ERROR'; this.details = body?.error?.details;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, url, { body, raw, headers = {}, blob } = {}) {
  const s = getSession();
  const h = { ...headers };
  if (s?.token) h.authorization = `Bearer ${s.token}`;
  if (body !== undefined && !raw) h['content-type'] = 'application/json';
  let res;
  try { res = await fetch(`/api/v1${url}`, { method, headers: h, body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined }); }
  catch { throw new ApiError(0, { error: { code: 'NETWORK', message: 'Cannot reach the server. Is it running?' } }); }
  if (blob && res.ok) return res.blob();
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/login')) onUnauthorized();
    throw new ApiError(res.status, data);
  }
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, body) => request('POST', u, { body: body ?? {} }),
  put: (u, body) => request('PUT', u, { body }),
  del: (u) => request('DELETE', u),
  upload: (u, bytes, filename) => request('POST', u, { body: bytes, raw: true, headers: { 'content-type': 'application/octet-stream', 'x-filename': filename } }),
  blob: (u) => request('GET', u, { blob: true }),
};

export const can = (perm) => !!getSession()?.permissions?.includes(perm);
export const role = () => getSession()?.user?.role;
