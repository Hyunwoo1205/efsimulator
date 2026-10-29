import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleCatalogRequest } from '../lib/catalog-api.mjs';
import { generatePublication, PLAYER_FIELDS } from '../scripts/lifecycle/publication.mjs';
import { createDrawOptions } from '../lib/catalog-contract.mjs';

const NOW = '2026-10-27T00:00:00.000Z';
const player = (id, name) => ({ id, name, slug: `player-${id}`, position: 'CF', overallRating: 85, playingStyle: null, playingStyleDefensive: null, imageUrl: `https://efimg.com/${id}.png` });
function state() {
  const players = [player('1', '100% Player'), player('2', "O'Brien"), player('999999999999999999999999999', 'Huge ID Player')];
  const packs = [
    { saleId: 'sale-1', name: 'Known pack', slug: 'known-pack', date: '2026-10-26', playerCount: 2, sourceReportedPlayerCount: 1, totalPlayerCount: 150, standardPlayerCount: 148, endsAt: '2026-10-29T01:59:59.000Z', officialTitle: 'Official known', members: players.slice(0, 2).map(({ id, name }) => ({ id, name })), countCorrection: { source: 1, effective: 2, status: 'user_confirmed', reason: 'Synthetic reviewed source count discrepancy' }, provenance: { official: 'hash1', efhub: 'hash2' } },
    { saleId: 'sale-2', name: 'Expired pack', slug: 'expired-pack', date: '2026-10-22', playerCount: 1, sourceReportedPlayerCount: 1, totalPlayerCount: 11, standardPlayerCount: 10, endsAt: '2026-10-26T01:59:59.000Z', officialTitle: 'Official expired', members: players.slice(2).map(({ id, name }) => ({ id, name })), countCorrection: null, provenance: { official: 'hash3', efhub: 'hash4' } },
  ];
  return { players, packs, active: packs.map(pack => ({ ...pack, players: pack.members.map(member => players.find(item => item.id === member.id)) })), archive: [] };
}
function fixture({ initialize = true, populated = true, value = state() } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  if (initialize) {
    sqlite.exec(readFileSync(new URL('../drizzle/0000_productive_khan.sql', import.meta.url), 'utf8'));
    sqlite.exec(readFileSync(new URL('../drizzle/0001_api_publications.sql', import.meta.url), 'utf8'));
  }
  const queries = [];
  let afterPointer = null;
  const DB = { prepare(sql) {
    queries.push(sql);
    assert.match(sql.trim(), /^SELECT\b/i, 'HTTP reads must issue SELECT only');
    assert.doesNotMatch(sql, /\b(?:catalog_entities|entity_revisions|source_snapshots|pack_memberships|quarantine)\b/i, 'Public HTTP reads must never use raw or legacy whole-catalog storage');
    const statement = sqlite.prepare(sql);
    return { bind(...values) { return {
      async first() { const result = statement.get(...values) ?? null; if (/FROM api_current/.test(sql) && afterPointer) { const callback = afterPointer; afterPointer = null; callback(); } return result; },
      async all() { return { success: true, results: statement.all(...values) }; },
    }; } };
  } };
  function load(next = value, activate = true) {
    const expectedVersionId = sqlite.prepare("SELECT version_id FROM api_current WHERE singleton='current'").get()?.version_id ?? null;
    const bundle = generatePublication({ state: next, createdAt: NOW, expectedVersionId });
    for (const chunk of bundle.sqlChunks) sqlite.exec(chunk.sql);
    if (activate) sqlite.exec(bundle.activateSql);
    return bundle;
  }
  if (initialize && populated) load();
  const request = (path, options = {}, env = {}, now = NOW) => handleCatalogRequest(new Request(`https://api.example/api/v1${path}`, options), { DB, ...env }, { now });
  return { sqlite, DB, queries, request, load, value, setAfterPointer: callback => { afterPointer = callback; }, close: () => sqlite.close() };
}

test('missing DB/schema are safe503; empty schema and legacy imports cannot pretend processed readiness', async () => {
  assert.equal((await handleCatalogRequest(new Request('https://api.example/api/v1/health'))).status, 503);
  const absent = fixture({ initialize: false, populated: false });
  try { const response = await absent.request('/health'); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /sqlite|no such table|api_current/); } finally { absent.close(); }
  const f = fixture({ populated: false });
  try {
    f.sqlite.prepare('INSERT INTO source_snapshots VALUES (?,?)').run('old-raw', JSON.stringify({ counts: { cards: 47408 } }));
    f.sqlite.prepare('INSERT INTO catalog_entities VALUES (?,?,?,?)').run('efhub:card:777', 'card', '777', 'legacy-revision');
    const body = await (await f.request('/health')).json();
    assert.equal(body.data.ready, false); assert.equal(body.data.counts.player, 0); assert.equal(body.data.raw_in_runtime, false);
    assert.equal((await f.request('/players')).status, 503); assert.equal((await f.request('/manifest')).status, 404);
  } finally { f.close(); }
});

test('processed details are exactly8fields and manifest contains only safe publication metadata', async () => {
  const f = fixture();
  try {
    const body = await (await f.request('/cards/999999999999999999999999999')).json();
    assert.equal(body.data.id, '999999999999999999999999999');
    assert.deepEqual(Object.keys(body.data).sort(), [...PLAYER_FIELDS].sort());
    assert.equal(body.data._meta, undefined); assert.equal(body.meta.schema_version, 2);
    const pack = await (await f.request('/packs/known-pack')).json();
    assert.equal(pack.data.saleId, 'sale-1'); assert.equal(pack.data.sourceReportedPlayerCount, 1); assert.equal(pack.data.playerCount, 2);
    const manifest = await (await f.request('/manifest')).json();
    assert.equal(manifest.data.raw_in_runtime, false); assert.equal(manifest.data.counts.player, 3); assert.equal(manifest.data.version_id, body.meta.catalog_snapshot_id);
    assert.equal((await f.request('/cards/777')).status, 404); assert.equal((await f.request('/cards/nope')).status, 400);
    assert.equal((await f.request('/packs/bad%2fpath')).status, 400); assert.equal((await f.request('/not-real')).status, 404);
  } finally { f.close(); }
});

test('bounded pagination searches literal values, keeps cardIDs strings, and has collection-specific cursors', async () => {
  const f = fixture();
  try {
    const one = await (await f.request('/players?limit=1')).json();
    assert.equal(one.pagination.next_cursor, 'efhub:card:1');
    const two = await (await f.request(`/cards?limit=1&cursor=${encodeURIComponent(one.pagination.next_cursor)}`)).json();
    assert.equal(two.data[0].id, '2');
    const three = await (await f.request(`/cards?limit=1&cursor=${encodeURIComponent(two.pagination.next_cursor)}`)).json();
    assert.equal(three.pagination.next_cursor, null);
    assert.deepEqual((await (await f.request('/cards?q=100%25')).json()).data.map(item => item.id), ['1']);
    assert.deepEqual((await (await f.request(`/cards?q=${encodeURIComponent("' OR 1=1 --")}`)).json()).data, []);
    for (const query of ['limit=101', 'limit=0', 'limit=1.5', 'limit=1&limit=2', 'cursor=pack:sale-1', 'unexpected=yes']) assert.equal((await f.request(`/cards?${query}`)).status, 400);
  } finally { f.close(); }
});

test('live and archive materialize complete nested copies and expire atUTCend even without an hourly write', async () => {
  const f = fixture();
  try {
    const live = await (await f.request('/live')).json();
    const archive = await (await f.request('/archive')).json();
    assert.deepEqual(live.data.map(item => item.saleId), ['sale-1']);
    assert.deepEqual(archive.data.map(item => item.saleId), ['sale-2']);
    assert.equal(archive.data[0].archivePersisted, false);
    assert.equal(archive.data[0].players[0].id, '999999999999999999999999999');
    for (const [key, value] of Object.entries(f.value.packs[0])) assert.deepEqual(live.data[0][key], value);
    assert.deepEqual(live.data[0].players, f.value.players.slice(0, 2));
    assert.equal((await f.request('/live/sale-2')).status, 404);
    assert.equal((await f.request('/archive/sale-2')).status, 200);
    assert.equal((await f.request('/live/sale-1', {}, {}, '2026-10-29T01:59:59.000Z')).status, 404);
    assert.equal((await f.request('/archive/sale-1', {}, {}, '2026-10-29T01:59:59.000Z')).status, 200);
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM api_records WHERE kind='archive'").get().n, 0, 'GET expiry must not mutate publication history');
  } finally { f.close(); }
});

test('packcards read the sameversion membership and all8publicplayerfields', async () => {
  const f = fixture();
  try {
    const body = await (await f.request('/packs/sale-1/cards')).json();
    assert.deepEqual(body.data.map(item => item.id), ['1', '2']);
    assert.ok(body.data.every(item => Object.keys(item).length === 8));
    assert.equal(body.meta.special_player_count, 2); assert.equal(body.meta.total_player_count, 150);
    assert.equal((await f.request('/packs/missing/cards')).status, 404);
    assert.equal((await f.request('/packs/sale-1/cards?q=Player')).status, 400);
  } finally { f.close(); }
});

test('pack list/details and live/archive reads retain identical published draw options', async () => {
  const value = state();
  for (const key of ['packs', 'active']) for (const pack of value[key]) pack.drawOptions = createDrawOptions(pack.totalPlayerCount);
  const f = fixture({ value });
  try {
    const list = await (await f.request('/packs')).json();
    for (const expected of value.packs) {
      const detail = await (await f.request(`/packs/${expected.saleId}`)).json();
      const section = expected.totalPlayerCount === 11 ? 'archive' : 'live';
      const nested = await (await f.request(`/${section}/${expected.saleId}`)).json();
      assert.deepEqual(list.data.find(pack => pack.saleId === expected.saleId).drawOptions, expected.drawOptions);
      assert.deepEqual(detail.data.drawOptions, expected.drawOptions);
      assert.deepEqual(nested.data.drawOptions, expected.drawOptions);
    }
  } finally { f.close(); }
});

test('incompleteloads do not affect activepublication and oneHTTPrequest never mixesversions during activation', async () => {
  const f = fixture();
  try {
    const old = await (await f.request('/manifest')).json();
    const next = structuredClone(f.value); next.players[0].name = 'New name';
    next.packs[0].members[0].name = 'New name'; next.active[0].members[0].name = 'New name'; next.active[0].players[0].name = 'New name';
    const staged = f.load(next, false);
    assert.equal((await (await f.request('/manifest')).json()).data.version_id, old.data.version_id);
    f.setAfterPointer(() => f.sqlite.exec(staged.activateSql));
    const during = await (await f.request('/players/1')).json();
    assert.equal(during.data.name, '100% Player'); assert.equal(during.meta.catalog_snapshot_id, old.data.version_id);
    assert.equal((await (await f.request('/players/1')).json()).data.name, 'New name');
  } finally { f.close(); }
});

test('reissuedpackslug is ambiguous while saleId identifies exactround', async () => {
  const value = state();
  const second = { ...structuredClone(value.packs[0]), saleId: 'reissue' };
  value.packs.push(second); value.active.push({ ...second, players: value.players.slice(0, 2) });
  const f = fixture({ value });
  try { assert.equal((await f.request('/packs/known-pack')).status, 409); assert.equal((await f.request('/packs/reissue')).status, 200); } finally { f.close(); }
});

test('CORS, HEAD and rejectedwrites never fetch sources or expose unauthorizeddata', async () => {
  const f = fixture(); const beforeFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Source fetching is forbidden in reads'); };
  try {
    const before = f.queries.length;
    assert.equal((await f.request('/health', { headers: { Origin: 'https://evil.example' } }, { CORS_ALLOWED_ORIGINS: '*' })).status, 403);
    assert.equal((await f.request('/cards', { method: 'POST', body: '{}' })).status, 405);
    assert.equal(f.queries.length, before);
    const allowed = await f.request('/health', { headers: { Origin: 'https://app.example' } }, { CORS_ALLOWED_ORIGINS: 'https://app.example' });
    assert.equal(allowed.status, 200); assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://app.example');
    const preflight = await f.request('/cards', { method: 'OPTIONS', headers: { Origin: 'https://app.example', 'Access-Control-Request-Method': 'GET' } }, { CORS_ALLOWED_ORIGINS: 'https://app.example' });
    assert.equal(preflight.status, 204);
    assert.equal((await f.request('/cards', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST' } })).status, 405);
    const head = await f.request('/cards/1', { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.equal(head.headers.get('cache-control'), 'no-store');
  } finally { globalThis.fetch = beforeFetch; f.close(); }
});
