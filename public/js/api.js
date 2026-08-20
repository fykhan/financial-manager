// api.js — fetch wrapper for the FastAPI backend

async function request(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  if (res.status === 401) {
    location.href = '/login.html';
    throw new Error('unauthenticated');
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      // FastAPI sends 422 `detail` as an array of {loc, msg} objects, which
      // would stringify to "[object Object]" — flatten it to "field: reason".
      detail = Array.isArray(body.detail)
        ? body.detail.map(e => {
            const field = Array.isArray(e.loc) ? e.loc.slice(1).join('.') : '';
            return field ? `${field}: ${e.msg}` : e.msg;
          }).join('; ')
        : body.detail || detail;
    } catch { /* not JSON */ }
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const get = (path) => request(path);
export const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
export const patch = (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body) });
export const del = (path) => request(path, { method: 'DELETE' });
