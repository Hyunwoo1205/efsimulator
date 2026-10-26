import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleCatalogRequest } from '../lib/catalog-api.mjs';

const SQL = `
CREATE TABLE source_snapshots(snapshot_id TEXT PRIMARY KEY, manifest_json TEXT NOT NULL);
CREATE TABLE catalog_entities(entity_key TEXT PRIMARY KEY, kind TEXT NOT NULL, source_id TEXT NOT NULL, current_revision_id TEXT NOT NULL);
CREATE TABLE entity_revisions(revision_id TEXT PRIMARY KEY, entity_key TEXT NOT NULL, payload_json TEXT NOT NULL, snapshot_id TEXT NOT NULL);
CREATE TABLE pack_memberships(pack_key TEXT NOT NULL, card_key TEXT NOT NULL, evidence_json TEXT NOT NULL, snapshot_id TEXT NOT NULL, PRIMARY KEY(pack_key, card_key, snapshot_id));
`;

function fixture({ initialize = true, populated = true } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  if (initialize) sqlite.exec(SQL);
  const queries = [];
  const DB = { prepare(sql) {
    queries.push(sql);
    assert.match(sql.trim(), /^SELECT\b/i, 'HTTP reads must issue SELECT statements only');
    const statement = sqlite.prepare(sql);
    return { bind(...values) { return {
      async first() { return statement.get(...values) ?? null; },
      async all() { return { success: true, results: statement.all(...values) }; },
    }; } };
  } };
  function snapshot(id, time) {
    sqlite.prepare('INSERT INTO source_snapshots VALUES (?, ?)').run(id, JSON.stringify({ schema_version: 1, prepared_at: time, counts: { cards: 3, packs: 2 }, private_path: '/private/source/input.json' }));
  }
  function entity(kind, id, payload, version = 's1', revision = `${kind}-${id}`) {
    const key = `efhub:${kind}:${id}`;
    sqlite.prepare('INSERT INTO entity_revisions VALUES (?, ?, ?, ?)').run(revision, key, JSON.stringify(payload), version);
    sqlite.prepare('INSERT INTO catalog_entities VALUES (?, ?, ?, ?) ON CONFLICT(entity_key) DO UPDATE SET current_revision_id=excluded.current_revision_id').run(key, kind, id, revision);
  }
  function member(pack, card, snapshotId) {
    sqlite.prepare('INSERT INTO pack_memberships VALUES (?, ?, ?, ?)').run(`efhub:pack:${pack}`, `efhub:card:${card}`, JSON.stringify({ status: 'user_confirmed_correction' }), snapshotId);
  }
  if (initialize && populated) {
    snapshot('s1', '2026-10-26T01:00:00Z');
    entity('card', '1', { name: '100% Player', source_card_id: '1' });
    entity('card', '2', { name: "O'Brien", source_card_id: '2' });
    entity('card', '999999999999999999999999999', { name: 'Huge ID Player', source_card_id: '999999999999999999999999999' });
    entity('pack', 'known-pack', { name: 'Known pack', source_reported_count: 1, effective_member_count: 2, membership_status: 'user_confirmed_correction' });
    entity('pack', 'unknown-pack', { name: 'Unknown pack', membership_status: 'unknown' });
    member('known-pack', '1', 's1');
  }
  const request = (path, options = {}, env = {}) => handleCatalogRequest(new Request(`https://api.example/api/v1${path}`, options), { DB, ...env });
  return { sqlite, DB, queries, request, snapshot, entity, member, close: () => sqlite.close() };
}

test('missing DB and missing schema return 503 without leaking SQL or internal paths', async () => {
  const missing = await handleCatalogRequest(new Request('https://api.example/api/v1/health'));
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).error.code, 'database_unavailable');
  const f = fixture({ initialize: false, populated: false });
  try {
    const response = await f.request('/health');
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /source_snapshots|no such table|sqlite/i);
  } finally { f.close(); }
});

test('initialized empty database is not represented as an imported catalog', async () => {
  const f = fixture({ populated: false });
  try {
    const health = await f.request('/health');
    assert.equal(health.status, 200);
    const body = await health.json();
    assert.equal(body.data.ready, false);
    assert.equal(body.data.counts.cards, 0);
    assert.equal((await f.request('/cards')).status, 503);
    assert.equal((await f.request('/manifest')).status, 404);
  } finally { f.close(); }
});

test('health and safe manifest expose imported state without upload paths', async () => {
  const f = fixture();
  try {
    const health = await f.request('/health');
    assert.equal((await health.json()).data.ready, true);
    const response = await f.request('/manifest');
    const body = await response.json();
    assert.equal(body.data.snapshot_id, 's1');
    assert.equal(body.data.prepared_at, '2026-10-26T01:00:00Z');
    assert.equal(body.data.counts.cards, 3);
    assert.equal(JSON.stringify(body).includes('/private/'), false);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally { f.close(); }
});

test('card and pack details preserve string IDs, correction values and 404 semantics', async () => {
  const f = fixture();
  try {
    const response = await f.request('/cards/999999999999999999999999999');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.source_card_id, '999999999999999999999999999');
    assert.equal(body.data._meta.entity_key, 'efhub:card:999999999999999999999999999');
    assert.equal(body.data._meta.source_snapshot_id, 's1');
    const pack = await (await f.request('/packs/known-pack')).json();
    assert.equal(pack.data.source_reported_count, 1);
    assert.equal(pack.data.effective_member_count, 2);
    assert.equal((await f.request('/cards/123456')).status, 404);
    assert.equal((await f.request('/packs/missing')).status, 404);
    assert.equal((await f.request('/cards/not-a-card')).status, 400);
    assert.equal((await f.request('/packs/bad%2fpath')).status, 400);
    assert.equal((await f.request('/not-real')).status, 404);
  } finally { f.close(); }
});

test('bounded keyset pagination returns each card once and keeps search values parameterized', async () => {
  const f = fixture();
  try {
    const one = await (await f.request('/cards?limit=1')).json();
    assert.equal(one.data.length, 1);
    assert.equal(one.pagination.next_cursor, 'efhub:card:1');
    const two = await (await f.request(`/cards?limit=1&cursor=${encodeURIComponent(one.pagination.next_cursor)}`)).json();
    assert.equal(two.data[0].source_card_id, '2');
    assert.equal(two.pagination.next_cursor, 'efhub:card:2');
    const three = await (await f.request(`/cards?limit=1&cursor=${encodeURIComponent(two.pagination.next_cursor)}`)).json();
    assert.equal(three.pagination.next_cursor, null);
    const literal = await (await f.request('/cards?q=100%25')).json();
    assert.deepEqual(literal.data.map(item => item.source_card_id), ['1']);
    const injection = await (await f.request(`/cards?q=${encodeURIComponent("' OR 1=1 --")}`)).json();
    assert.deepEqual(injection.data, []);
    assert.equal((await f.request('/cards?limit=101')).status, 400);
    assert.equal((await f.request('/cards?limit=1.5')).status, 400);
    assert.equal((await f.request('/cards?limit=1&limit=2')).status, 400);
    assert.equal((await f.request('/cards?cursor=efhub:pack:known-pack')).status, 400);
    assert.equal((await f.request('/cards?limit=0')).status, 400);
    assert.equal((await f.request('/cards?unexpected=yes')).status, 400);
  } finally { f.close(); }
});

test('membership reads newest known set once and preserves it when a later snapshot omits the pack', async () => {
  const f = fixture();
  try {
    f.snapshot('s2', '2026-10-26T02:00:00Z');
    f.member('known-pack', '1', 's2');
    f.member('known-pack', '2', 's2');
    f.snapshot('s3', '2026-10-26T03:00:00Z');
    const body = await (await f.request('/packs/known-pack/cards')).json();
    assert.deepEqual(body.data.map(item => item.source_card_id), ['1', '2']);
    assert.equal(body.meta.catalog_snapshot_id, 's3');
    assert.equal(body.meta.membership_status, 'user_confirmed_correction');
    assert.ok(body.data.every(item => item.membership.source_snapshot_id === 's2'));
    const unknown = await (await f.request('/packs/unknown-pack/cards')).json();
    assert.deepEqual(unknown.data, []);
    assert.equal(unknown.meta.membership_status, 'unknown');
    assert.equal((await f.request('/packs/missing/cards')).status, 404);
    assert.equal((await f.request('/packs/known-pack/cards?q=Player')).status, 400);
  } finally { f.close(); }
});

test('CORS rejects unlisted origins, allows exact origins, and does not interpret wildcard as public access', async () => {
  const f = fixture();
  try {
    const before = f.queries.length;
    const denied = await f.request('/health', { headers: { Origin: 'https://evil.example' } });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
    assert.equal(f.queries.length, before);
    assert.equal((await f.request('/health', { headers: { Origin: 'https://evil.example' } }, { CORS_ALLOWED_ORIGINS: '*' })).status, 403);
    const allowed = await f.request('/health', { headers: { Origin: 'https://app.example' } }, { CORS_ALLOWED_ORIGINS: 'https://app.example' });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://app.example');
    assert.equal(allowed.headers.get('vary'), 'Origin');
    const same = await f.request('/health', { headers: { Origin: 'https://api.example' } });
    assert.equal(same.status, 200);
    const preflight = await f.request('/cards', { method: 'OPTIONS', headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'GET' } }, { CORS_ALLOWED_ORIGINS: 'https://app.example' });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, HEAD');
    const write = await f.request('/cards', { method: 'OPTIONS', headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'POST' } }, { CORS_ALLOWED_ORIGINS: 'https://app.example' });
    assert.equal(write.status, 405);
  } finally { f.close(); }
});

test('GET and HEAD never write or fetch sources; unsupported writes are rejected before querying', async () => {
  const f = fixture();
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Source fetching is forbidden in reads.'); };
  try {
    const rowsBefore = f.sqlite.prepare('SELECT count(*) AS n FROM catalog_entities').get().n;
    const queriesBefore = f.queries.length;
    const write = await f.request('/cards', { method: 'POST', body: '{}' });
    assert.equal(write.status, 405);
    assert.equal(write.headers.get('allow'), 'GET, HEAD, OPTIONS');
    assert.equal(f.queries.length, queriesBefore);
    const response = await f.request('/cards/1', { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal((await f.request('/cards')).status, 200);
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM catalog_entities').get().n, rowsBefore);
  } finally { globalThis.fetch = fetchBefore; f.close(); }
});
