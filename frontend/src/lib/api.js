// Cliente HTTP. Las cookies HttpOnly viajan solas (mismo origen); el frontend
// nunca ve ni guarda tokens.
export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const NO_REFRESH = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/reset-password', '/auth/forgot-password'];
let refreshing = null;
let onSessionLost = () => {};

export function setSessionLostHandler(fn) {
  onSessionLost = fn;
}

function refreshSession() {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api(path, { method = 'GET', body, retry = true } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Sin conexión con el servidor. Verifique su red.', 'NETWORK');
  }

  if (res.status === 401 && retry && !NO_REFRESH.includes(path)) {
    if (await refreshSession()) return api(path, { method, body, retry: false });
    onSessionLost();
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.message ?? 'Ocurrió un error inesperado', data?.error?.code);
  }
  return data;
}

export const get = (path) => api(path);
export const post = (path, body = {}) => api(path, { method: 'POST', body });
export const put = (path, body) => api(path, { method: 'PUT', body });
export const patch = (path, body) => api(path, { method: 'PATCH', body });
