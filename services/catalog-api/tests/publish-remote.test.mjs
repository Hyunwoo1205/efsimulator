import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { publishRemote, rollbackRemote, validatePublishOrigin, createPublicationTransport } from '../scripts/lifecycle/publish-remote.mjs';
import { generatePublication } from '../scripts/lifecycle/publication.mjs';
import { handlePublicationAdminRequest } from '../lib/publication-admin.mjs';
import { handleCatalogRequest } from '../lib/catalog-api.mjs';

const ORIGIN = 'https://catalog-test.example.chatgpt.site';
const TOKEN = 'private-service-token-for-test-only';
const NOW = '2026-10-28T00:00:00.000Z';
function publication(name = 'Pack') {
  const player = { id: '900719925474099312345', name: 'Player', slug: 'player', position: 'CF', overallRating: 85,
    playingStyle: null, playingStyleDefensive: null, imageUrl: 'https://efimg.com/example.png' };
  const pack = { saleId: 'sale-1', name, slug: 'pack', date: '2026-10-26', playerCount: 1, sourceReportedPlayerCount: 1,
    totalPlayerCount: 11, standardPlayerCount: 10, endsAt: '2026-11-02T01:59:59.000Z', officialTitle: 'Official',
    members: [{ id: player.id, name: player.name }], countCorrection: null, provenance: { official: 'hash1', efhub: 'hash2' } };
  return generatePublication({ state: { players: [player], packs: [pack], active: [{ ...structuredClone(pack), players: [player] }], archive: [] }, createdAt: NOW });
}

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0001_api_publications.sql', import.meta.url), 'utf8'));
  t.after(() => sqlite.close());
  function prepared(sql, values = []) {
    return { sql, values, bind(...next) { return prepared(sql, next); },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { return { success: true, results: sqlite.prepare(sql).all(...values) }; } };
  }
  const DB = { prepare: sql => prepared(sql), async batch(statements) {
    sqlite.exec('BEGIN');
    try {
      const result = statements.map(({ sql, values }) => /^SELECT\b/i.test(sql.trim())
        ? { success: true, results: sqlite.prepare(sql).all(...values) }
        : { success: true, results: [], meta: sqlite.prepare(sql).run(...values) });
      sqlite.exec('COMMIT'); return result;
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  const calls = [];
  let alter;
  const fetchImpl = async (url, options) => {
    assert.equal(new URL(url).origin, ORIGIN);
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers['OAI-Sites-Authorization'], `Bearer ${TOKEN}`);
    assert.equal(options.headers['X-Catalog-Publisher'], '1');
    assert.equal(Object.hasOwn(options.headers, 'Origin'), false);
    calls.push({ url, method: options.method });
    const request = new Request(url, options);
    const response = new URL(url).pathname.startsWith('/api/admin/')
      ? await handlePublicationAdminRequest(request, { DB, PUBLISH_ACCESS_MODE: 'owner-private' })
      : await handleCatalogRequest(request, { DB }, { now: Date.parse(NOW) });
    return alter ? await alter(request, response) : response;
  };
  return { sqlite, calls, options: { origin: ORIGIN, serviceToken: TOKEN, fetchImpl }, alter: callback => { alter = callback; } };
}

test('remote client stages and reads back exact rows before activation; a replay performs no writes', async t => {
  const f = fixture(t), bundle = publication();
  const first = await publishRemote({ ...f.options, publication: bundle, expectedVersionId: null });
  assert.equal(first.changed, true); assert.equal(first.verified, true); assert.equal(first.versionId, bundle.versionId);
  assert.equal(JSON.stringify(first).includes(TOKEN), false);
  const readback = f.calls.findIndex(call => /\/records\?/.test(call.url));
  const activate = f.calls.findIndex(call => /\/activate$/.test(call.url));
  assert.ok(readback > -1 && activate > readback);
  const start = f.calls.length;
  const replay = await publishRemote({ ...f.options, publication: bundle, expectedVersionId: null });
  assert.equal(replay.changed, false);
  assert.ok(f.calls.slice(start).every(call => call.method === 'GET'));
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM api_versions').get().n, 1);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM api_records').get().n, bundle.records.length);
});

test('stale expected version fails before uploading a candidate publication', async t => {
  const f = fixture(t);
  await publishRemote({ ...f.options, publication: publication(), expectedVersionId: null });
  const start = f.calls.length;
  await assert.rejects(publishRemote({ ...f.options, publication: publication('Changed'), expectedVersionId: null }), /current version changed/);
  assert.equal(f.calls.slice(start).length, 1);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM api_versions').get().n, 1);
});

test('tampered or incomplete readback never reaches activation', async t => {
  const f = fixture(t), bundle = publication();
  f.alter(async (request, response) => {
    if (!new URL(request.url).pathname.endsWith('/records') || request.method !== 'GET') return response;
    const value = await response.json();
    value.data[0].payload.name = 'Tampered';
    return Response.json(value);
  });
  await assert.rejects(publishRemote({ ...f.options, publication: bundle, expectedVersionId: null }), /do not match/);
  assert.equal(f.calls.some(call => /\/activate$/.test(call.url)), false);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM api_current').get().n, 0);
});

test('retained publication rollback revalidates rows and preserves both immutable versions', async t => {
  const f = fixture(t), first = publication(), next = publication('Next');
  await publishRemote({ ...f.options, publication: first });
  await publishRemote({ ...f.options, publication: next, expectedVersionId: first.versionId });
  const result = await rollbackRemote({ ...f.options, versionId: first.versionId, expectedVersionId: next.versionId });
  assert.equal(result.changed, true); assert.equal(result.versionId, first.versionId);
  assert.equal(f.sqlite.prepare('SELECT version_id FROM api_current').get().version_id, first.versionId);
  assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM api_versions').get().n, 2);
  const replayStart = f.calls.length;
  assert.equal((await rollbackRemote({ ...f.options, versionId: first.versionId })).changed, false);
  assert.ok(f.calls.slice(replayStart).every(call => call.method === 'GET'));
});

test('only exact HTTPS Sites origins are accepted before credentials can leave the process', async () => {
  for (const origin of ['http://a.chatgpt.site', 'https://chatgpt.site', 'https://a.chatgpt.site.evil.test',
    'https://a.chatgpt.site/path', 'https://a.chatgpt.site/', 'https://a.chatgpt.site?token=private', 'https://user:pass@a.chatgpt.site', 'https://a.chatgpt.site:444']) {
    assert.throws(() => validatePublishOrigin(origin));
  }
  assert.equal(validatePublishOrigin(ORIGIN), ORIGIN);
  let fetched = false;
  await assert.rejects(publishRemote({ origin: 'https://evil.test', serviceToken: TOKEN, publication: publication(), fetchImpl: async () => { fetched = true; } }));
  assert.equal(fetched, false);
});

test('redirects, non-JSON sign-in responses, and transport errors are refused without exposing credentials', async () => {
  for (const fetchImpl of [async () => new Response('', { status: 302, headers: { Location: 'https://elsewhere.test' } }),
    async () => new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } }),
    async () => { throw new Error(`Network failure with ${TOKEN}`); }]) {
    const request = createPublicationTransport({ origin: ORIGIN, serviceToken: TOKEN, fetchImpl });
    await assert.rejects(request('/api/admin/current'), error => !error.message.includes(TOKEN));
  }
});

test('malformed local publication cannot create any remote records', async t => {
  const f = fixture(t), bad = publication();
  bad.records[0].payload.privateRaw = { secret: true };
  await assert.rejects(publishRemote({ ...f.options, publication: bad }), /processed player/);
  assert.equal(f.calls.length, 0);
});
