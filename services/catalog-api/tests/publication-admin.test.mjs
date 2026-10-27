import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handlePublicationAdminRequest } from '../lib/publication-admin.mjs';
import { generatePublication } from '../scripts/lifecycle/publication.mjs';

const TOKEN = 'test-only-admin-token-with-at-least-32-characters';
const NOW = '2026-10-28T00:00:00.000Z';
function fixtureState(total = 150) {
  const player = { id: '999999999999999999999', name: "O'Brien", slug: 'obrien', position: 'CF', overallRating: 82, playingStyle: null, playingStyleDefensive: null, imageUrl: 'https://efimg.com/card.png' };
  const pack = { saleId: 'round-1', name: 'Pack', slug: 'pack', date: '2026-10-26', playerCount: 1, sourceReportedPlayerCount: 1, totalPlayerCount: total, standardPlayerCount: total - 1, endsAt: '2026-11-02T01:59:59.000Z', officialTitle: 'Official Pack', members: [{ id: player.id, name: player.name }], countCorrection: null, provenance: { official: 'hash1', efhub: 'hash2' } };
  return { players: [player], packs: [pack], active: [{ ...structuredClone(pack), players: [structuredClone(player)] }], archive: [] };
}
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0001_api_publications.sql', import.meta.url), 'utf8'));
  let calls = 0; let beforePointerWrite;
  const DB = {
    prepare(sql) {
      calls++;
      return { bind(...values) { return {
        sql, values,
        async first() { return sqlite.prepare(sql).get(...values) ?? null; },
        async all() { return { success: true, results: sqlite.prepare(sql).all(...values) }; },
      }; } };
    },
    async batch(statements) {
      if (statements.some(statement => /INSERT INTO api_current/.test(statement.sql)) && beforePointerWrite) {
        const callback = beforePointerWrite; beforePointerWrite = undefined; callback();
      }
      sqlite.exec('BEGIN');
      try {
        const result = statements.map(statement => {
          if (/^\s*SELECT/.test(statement.sql)) return { success: true, results: sqlite.prepare(statement.sql).all(...statement.values) };
          const value = sqlite.prepare(statement.sql).run(...statement.values);
          return { success: true, results: [], meta: { changes: value.changes } };
        });
        sqlite.exec('COMMIT'); return result;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const env = { DB, ADMIN_PUBLISH_TOKEN: TOKEN };
  function request(path, method = 'GET', body, extraEnv = {}, headers = {}) {
    return handlePublicationAdminRequest(new Request(`https://api.example/api/admin${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { ...env, ...extraEnv });
  }
  async function upload(bundle) {
    assert.ok([200, 201].includes((await request('/publications', 'POST', { manifest: bundle.manifest })).status));
    assert.equal((await request(`/publications/${bundle.versionId}/records`, 'PUT', { records: bundle.records })).status, 200);
  }
  const current = () => sqlite.prepare("SELECT version_id FROM api_current WHERE singleton='current'").get()?.version_id ?? null;
  return { sqlite, DB, env, request, upload, current, calls: () => calls, beforePointer: callback => { beforePointerWrite = callback; }, close: () => sqlite.close() };
}
const bundle = total => generatePublication({ state: fixtureState(total), createdAt: NOW });

test('admin authorization is checked before body parsing or DB access, including explicit owner-private service mode', async () => {
  const f = fixture();
  try {
    const unauthorized = await f.request('/publications', 'POST', { sql: 'DROP TABLE api_records' }, {}, { Authorization: 'Bearer wrong' });
    assert.equal(unauthorized.status, 401); assert.equal(f.calls(), 0);
    assert.equal((await f.request('/current', 'GET', undefined, { ADMIN_PUBLISH_TOKEN: undefined })).status, 503);
    assert.equal((await f.request('/current', 'GET', undefined, { PUBLISH_ACCESS_MODE: 'owner-private' }, { Authorization: '' })).status, 401);
    const privateEnv = { PUBLISH_ACCESS_MODE: 'owner-private', ADMIN_PUBLISH_TOKEN: undefined };
    assert.equal((await f.request('/current', 'GET', undefined, privateEnv, { 'X-Catalog-Publisher': '1', Authorization: '' })).status, 200);
    assert.equal((await f.request('/current', 'GET', undefined, privateEnv, { 'X-Catalog-Publisher': '1', Origin: 'https://api.example' })).status, 401);
    assert.equal((await f.request('/current', 'GET', undefined, {}, { Origin: 'https://api.example' })).status, 403);
  } finally { f.close(); }
});

test('fixed-schema upload, pagination, full verification and activation preserve exact records and string IDs', async () => {
  const f = fixture();
  try {
    assert.deepEqual((await (await f.request('/current')).json()).data, { versionId: null, manifest: null });
    const value = bundle(); await f.upload(value);
    assert.equal(f.current(), null);
    const status = await (await f.request(`/publications/${value.versionId}`)).json();
    assert.equal(status.data.complete, true); assert.deepEqual(status.data.storedCounts, value.manifest.counts);
    let offset = 0; const records = [];
    do {
      const page = await (await f.request(`/publications/${value.versionId}/records?offset=${offset}&limit=1`)).json();
      records.push(...page.data); offset = page.pagination.nextOffset;
    } while (offset !== null);
    assert.deepEqual(records.map(record => record.kind).sort(), ['live', 'pack', 'player']);
    assert.equal(records.find(record => record.kind === 'player').payload.id, '999999999999999999999');
    assert.equal((await f.request(`/publications/${value.versionId}/verify`, 'POST', {})).status, 200);
    const activated = await (await f.request(`/publications/${value.versionId}/activate`, 'POST', { expectedVersionId: null })).json();
    assert.equal(activated.data.changed, true); assert.equal(f.current(), value.versionId);
    assert.equal((await f.request(`/publications/${value.versionId}/activate`, 'POST', { expectedVersionId: null })).status, 200);
  } finally { f.close(); }
});

test('incomplete uploads and full-count corrupted content cannot activate and expose no SQL error details', async () => {
  const f = fixture();
  try {
    const value = bundle(); await f.request('/publications', 'POST', { manifest: value.manifest });
    await f.request(`/publications/${value.versionId}/records`, 'PUT', { records: value.records.slice(0, 1) });
    assert.equal((await f.request(`/publications/${value.versionId}/activate`, 'POST', { expectedVersionId: null })).status, 409);
    assert.equal(f.current(), null);
    await f.request(`/publications/${value.versionId}/records`, 'PUT', { records: value.records.slice(1) });
    f.sqlite.prepare("UPDATE api_records SET payload_json=json_set(payload_json,'$.overallRating',83) WHERE kind='player'").run();
    const invalid = await f.request(`/publications/${value.versionId}/activate`, 'POST', { expectedVersionId: null });
    assert.equal(invalid.status, 409); assert.doesNotMatch(await invalid.text(), /SELECT|sqlite|api_records|NOT NULL/); assert.equal(f.current(), null);
  } finally { f.close(); }
});

test('replayed uploads are idempotent; payload conflicts and surplus keys cannot alter complete retained versions', async () => {
  const f = fixture();
  try {
    const value = bundle(); await f.upload(value);
    const before = f.sqlite.prepare('SELECT * FROM api_records ORDER BY 1,2,3').all();
    await f.upload(value);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM api_records ORDER BY 1,2,3').all(), before);
    const modified = structuredClone(value.records[0]); modified.payload.overallRating = 83;
    assert.equal((await f.request(`/publications/${value.versionId}/records`, 'PUT', { records: [modified] })).status, 409);
    const extra = structuredClone(value.records[0]); extra.key = '2'; extra.payload.id = '2';
    assert.equal((await f.request(`/publications/${value.versionId}/records`, 'PUT', { records: [extra] })).status, 409);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM api_records ORDER BY 1,2,3').all(), before);
    const recreated = structuredClone(value.manifest); recreated.created_at = '2026-10-28T01:00:00.000Z';
    const replay = await (await f.request('/publications', 'POST', { manifest: recreated })).json();
    assert.equal(replay.data.manifest.created_at, NOW, 'First immutable manifest timestamp is retained.');
  } finally { f.close(); }
});

test('stale activation and a concurrent pointer change are rejected; rollback verifies retained content and keeps history', async () => {
  const f = fixture();
  try {
    const one = bundle(150); const two = bundle(151); const three = bundle(152);
    for (const value of [one, two, three]) await f.upload(value);
    await f.request(`/publications/${one.versionId}/activate`, 'POST', { expectedVersionId: null });
    assert.equal((await f.request(`/publications/${two.versionId}/activate`, 'POST', { expectedVersionId: '0'.repeat(64) })).status, 409);
    f.beforePointer(() => f.sqlite.prepare("UPDATE api_current SET version_id=? WHERE singleton='current'").run(three.versionId));
    assert.equal((await f.request(`/publications/${two.versionId}/activate`, 'POST', { expectedVersionId: one.versionId })).status, 409);
    assert.equal(f.current(), three.versionId);
    assert.equal((await f.request(`/publications/${one.versionId}/rollback`, 'POST', { expectedVersionId: three.versionId })).status, 200);
    assert.equal(f.current(), one.versionId);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM api_versions').get().n, 3);
    f.sqlite.prepare("UPDATE api_records SET payload_json='{}' WHERE version_id=? AND kind='player'").run(two.versionId);
    assert.equal((await f.request(`/publications/${two.versionId}/rollback`, 'POST', { expectedVersionId: one.versionId })).status, 409);
    assert.equal(f.current(), one.versionId);
  } finally { f.close(); }
});

test('admin rejects arbitrary SQL/raw fields, duplicate keys, bad hashes, oversized batches and query injection', async () => {
  const f = fixture();
  try {
    const value = bundle(); await f.request('/publications', 'POST', { manifest: value.manifest });
    const path = `/publications/${value.versionId}/records`;
    assert.equal((await f.request(path, 'PUT', { sql: 'DROP TABLE api_records' })).status, 400);
    const raw = structuredClone(value.records[0]); raw.payload.nameJa = 'private';
    assert.equal((await f.request(path, 'PUT', { records: [raw] })).status, 400);
    assert.equal((await f.request(path, 'PUT', { records: [value.records[0], value.records[0]] })).status, 400);
    assert.equal((await f.request(path, 'PUT', { records: Array.from({ length: 51 }, () => value.records[0]) })).status, 400);
    assert.equal((await f.request(path, 'PUT', { records: [], padding: 'x'.repeat(2 * 1024 * 1024) })).status, 413);
    assert.equal((await f.request('/publications/not-a-hash')).status, 400);
    for (const query of ['limit=101', 'offset=-1', 'offset=20001', 'limit=1&limit=2', 'sql=SELECT']) assert.equal((await f.request(`${path}?${query}`)).status, 400);
    assert.equal((await f.request('/publications', 'POST', { manifest: { ...value.manifest, counts: { ...value.manifest.counts, pack: 2 } } })).status, 400);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM api_records').get().n, 0);
  } finally { f.close(); }
});
