import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCatalogRelay } from '../lib/catalog-relay.mjs';

const env = { CATALOG_API_ORIGIN: 'https://private-api.example.test', CATALOG_API_SERVICE_TOKEN: 'test-service-token' };
const request = (path, options) => new Request(`https://review-app.example.test${path}`, options);
const apiJson = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('relay reads the configured exact origin and forwards only its own service access', async () => {
  let captured;
  const response = await handleCatalogRelay(request('/api/v1/players?q=Rodri&limit=10', { headers: { Authorization: 'Bearer visitor-secret', Cookie: 'visitor=cookie', 'X-Forwarded-Host': 'attacker.test' } }), env, {
    fetch: async (url, options) => { captured = { url: String(url), options }; return apiJson({ data: [{ id: '123', name: 'Rodri' }], meta: { catalog_snapshot_id: 'version' } }); },
  });
  assert.equal(response.status, 200);
  assert.equal(captured.url, 'https://private-api.example.test/api/v1/players?q=Rodri&limit=10');
  assert.deepEqual(captured.options.headers, { Accept: 'application/json', 'OAI-Sites-Authorization': 'Bearer test-service-token' });
  assert.equal(captured.options.redirect, 'error');
  assert.equal(captured.options.method, 'GET');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).data[0].name, 'Rodri');
});

test('relay calls fetch with the global receiver required by Worker native bindings', async () => {
  let receiver;
  const response = await handleCatalogRelay(request('/api/v1/health'), env, {
    fetch: function () {
      receiver = this;
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(apiJson({ data: { ready: true } }));
    },
  });
  assert.equal(response.status, 200);
  assert.equal(receiver, globalThis);
  assert.equal((await response.json()).data.ready, true);
});

test('relay never fetches admin, arbitrary paths, invalid queries, methods or encoded separators', async () => {
  let fetched = 0;
  const options = { fetch: async () => { fetched++; return apiJson({ data: [] }); } };
  for (const path of ['/api/admin/current', '/api/v1/admin/current', '/api/v1/packs/a/cards/extra', '/api/v1/players/abc', '/api/v1/packs/a%2fb', '/api/v1/players?limit=101', '/api/v1/players?limit=1&limit=2', '/api/v1/players?url=https://attacker.test', '/api/v1/health?q=x', '/api/v1/packs/a/cards?q=x']) {
    assert.ok((await handleCatalogRelay(request(path), env, options)).status >= 400, path);
  }
  assert.equal((await handleCatalogRelay(request('/api/v1/players', { method: 'POST', body: '{}' }), env, options)).status, 405);
  assert.equal(fetched, 0);
});

test('relay supports nested pack rosters and paginated collection paths', async () => {
  for (const path of ['/api/v1/manifest', '/api/v1/health', '/api/v1/live?limit=100', '/api/v1/archive?cursor=archive%3Aabc', '/api/v1/packs/pack%3A%3A2026/cards?limit=100', '/api/v1/players/123']) {
    assert.equal((await handleCatalogRelay(request(path), env, { fetch: async () => apiJson({ data: [] }) })).status, 200, path);
  }
});

test('misconfigured upstream origins and missing credentials fail before fetching', async () => {
  let fetched = 0;
  const options = { fetch: async () => { fetched++; return apiJson({ data: [] }); } };
  for (const origin of ['', 'http://api.example.test', 'https://name:password@api.example.test', 'https://api.example.test/path', 'https://api.example.test?query=1', 'https://api.example.test#fragment']) {
    assert.equal((await handleCatalogRelay(request('/api/v1/live'), { ...env, CATALOG_API_ORIGIN: origin }, options)).status, 503);
  }
  for (const token of ['', 'invalid\nheader']) assert.equal((await handleCatalogRelay(request('/api/v1/live'), { ...env, CATALOG_API_SERVICE_TOKEN: token }, options)).status, 503);
  assert.equal(fetched, 0);
});

test('upstream authentication, HTML sign-in and redirects fail without exposing details', async () => {
  for (const fetcher of [
    async () => apiJson({ error: { code: 'private', message: 'upstream-private-detail' } }, 403),
    async () => new Response('<html>sign in private detail</html>', { headers: { 'Content-Type': 'text/html' } }),
    async () => new Response(null, { status: 302, headers: { Location: 'https://other.example.test' } }),
    async () => { throw new TypeError('redirect contains test-service-token'); },
  ]) {
    const response = await handleCatalogRelay(request('/api/v1/live'), env, { fetch: fetcher });
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /upstream-private-detail|test-service-token|other\.example|sign in private/);
  }
});

test('valid API errors preserve status but reject malformed or oversized JSON', async () => {
  const missing = await handleCatalogRelay(request('/api/v1/players/123'), env, { fetch: async () => apiJson({ error: { code: 'not_found', message: 'No card.' } }, 404) });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, 'not_found');
  for (const data of [null, [], { unexpected: true }]) assert.equal((await handleCatalogRelay(request('/api/v1/live'), env, { fetch: async () => apiJson(data) })).status, 503);
  const invalidJson = new Response('{broken', { headers: { 'Content-Type': 'application/json' } });
  assert.equal((await handleCatalogRelay(request('/api/v1/live'), env, { fetch: async () => invalidJson })).status, 503);
  const large = apiJson({ data: 'x'.repeat(2 * 1024 * 1024) });
  const tooLarge = await handleCatalogRelay(request('/api/v1/live'), env, { fetch: async () => large });
  assert.equal(tooLarge.status, 503);
  assert.equal((await tooLarge.json()).error.code, 'response_too_large');
});

test('diagnostics reveal only fixed events, status, MIME classification and safe error names', async () => {
  const logs = [];
  const logger = value => logs.push(JSON.parse(value));
  await handleCatalogRelay(request('/api/v1/health'), env, { logger, fetch: async () => new Response('private body test-service-token', { status: 403, headers: { 'Content-Type': 'text/html; private=test-service-token' } }) });
  await handleCatalogRelay(request('/api/v1/health'), env, { logger, fetch: async () => { throw Object.assign(new Error('secret URL https://secret.test test-service-token'), { name: 'private-test-service-token' }); } });
  await handleCatalogRelay(request('/api/v1/health'), env, { logger, fetch: async () => { throw new TypeError('secret URL https://secret.test test-service-token'); } });
  assert.deepEqual(logs, [
    { event: 'catalog_relay_upstream_rejected', status: 403, contentType: 'text/html' },
    { event: 'catalog_relay_fetch_failed', status: 0, contentType: 'missing', errorName: 'UnknownError', errorClass: 'other' },
    { event: 'catalog_relay_fetch_failed', status: 0, contentType: 'missing', errorName: 'TypeError', errorClass: 'other' },
  ]);
  assert.doesNotMatch(JSON.stringify(logs), /test-service-token|secret\.test|private body/);
});

test('fetch diagnostics classify known Worker failures without logging their messages', async () => {
  const logs = [];
  for (const message of ['Illegal invocation: private-test-service-token', 'Error 1042: cannot fetch same worker private-test-service-token', 'Some other error private-test-service-token']) {
    await handleCatalogRelay(request('/api/v1/health'), env, { logger: value => logs.push(JSON.parse(value)), fetch: async () => { throw new TypeError(message); } });
  }
  assert.deepEqual(logs.map(log => log.errorClass), ['illegal_invocation', 'worker_same_zone', 'other']);
  assert.doesNotMatch(JSON.stringify(logs), /private-test-service-token|Illegal invocation|cannot fetch same worker|Some other error/);
});
