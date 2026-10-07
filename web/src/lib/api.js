export class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export async function api(path, { method = 'GET', body, form, signal } = {}) {
  const init = { method, credentials: 'same-origin', signal, headers: {} };
  if (form) {
    init.body = form;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, init);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'Server tidak bisa dihubungi. Cek apakah laptop server menyala.');
  }
  if (res.status === 204) return null;
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (isJson && data?.error) || `Request gagal (${res.status})`, data);
  return data;
}
