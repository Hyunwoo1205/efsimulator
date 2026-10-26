/** Read client. Private Site credentials belong in a server-side fetch adapter. */
export function createCatalogClient({ baseUrl, fetch: fetcher = globalThis.fetch, timeoutMs = 10000 } = {}) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) {
    throw new TypeError('API origin must use HTTPS (HTTP is allowed only on loopback).');
  }
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new TypeError('baseUrl must be an origin without credentials or a path.');
  if (typeof fetcher !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('Invalid fetch or timeout.');
  async function read(path, query = {}) {
    const url = new URL(`/api/v1/${path}`, base);
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    const response = await fetcher(url, { method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.headers.get('content-type')?.includes('application/json')) throw Object.assign(new Error('Expected API JSON; check Site sign-in and service access.'), { code: 'invalid_api_response', status: response.status });
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.error?.message ?? 'API request failed.'), { code: body.error?.code ?? 'api_error', status: response.status });
    return body;
  }
  const segment = (value) => {
    if (typeof value !== 'string' || !value || value === '.' || value === '..') throw new TypeError('A nonempty string identifier is required.');
    return encodeURIComponent(value);
  };
  return Object.freeze({
    health: () => read('health'), manifest: () => read('manifest'),
    cards: (query) => read('cards', query), card: (id) => read(`cards/${segment(id)}`),
    packs: (query) => read('packs', query), pack: (slug) => read(`packs/${segment(slug)}`),
    packCards: (slug, query) => read(`packs/${segment(slug)}/cards`, query),
  });
}
