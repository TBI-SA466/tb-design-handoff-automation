export async function httpJson(url, { method = 'GET', headers = {}, body, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { accept: 'application/json', ...headers },
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    const json = text ? safeJson(text) : null;
    if (!res.ok) {
      const msg = json?.message || json?.errorMessages?.join(', ') || text || `${res.status}`;
      throw new Error(`${method} ${url} -> ${res.status}: ${msg}`);
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}


