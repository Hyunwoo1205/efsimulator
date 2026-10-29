import test from 'node:test';
import assert from 'node:assert/strict';
import { verifySites, SITE_ORIGINS } from '../scripts/lifecycle/verify-sites.mjs';

const VERSION = 'a'.repeat(64);
const NOW = '2026-10-29T03:00:00.000Z';
const TOKEN = 'synthetic-site-token-only';
function fixture({ size = 2, dynamicArchive = false, publicApp = false, alter = (_role, _name, body) => body } = {}) {
  const players = Array.from({ length: size }, (_, index) => ({ id: `9007199254740993${String(index).padStart(4, '0')}`, name: `Synthetic ${index}`, slug: `synthetic-${index}`,
    position: 'CF', overallRating: 85, playingStyle: null, playingStyleDefensive: null, imageUrl: 'https://efimg.com/synthetic.png' }));
  const pack = { saleId: 'synthetic-sale', name: 'Synthetic Pack', slug: 'synthetic-pack', date: '2026-10-26', playerCount: size,
    sourceReportedPlayerCount: size, totalPlayerCount: size + 10, standardPlayerCount: 10, endsAt: '2026-11-02T01:59:59.000Z', officialTitle: 'Synthetic Official',
    members: players.map(({ id, name }) => ({ id, name })), countCorrection: null, provenance: { source: 'synthetic' } };
  const data = { players, packs: [pack], live: dynamicArchive ? [] : [{ ...pack, players }], archive: dynamicArchive ? [{ ...pack, players, archivedAt: pack.endsAt, archiveReason: 'end_reached', archivePersisted: false }] : [] };
  const counts = { player: size, pack: 1, live: 1, archive: 0 };
  const input = { expectedVersionId: VERSION, sites: Object.fromEntries(Object.entries(SITE_ORIGINS).map(([role, origin]) => [role, { origin, serviceToken: `${TOKEN}-${role}` }])) };
  if (publicApp) input.sites.app = { origin: SITE_ORIGINS.app, accessMode: 'public' };
  const calls = [];
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url), role = Object.keys(SITE_ORIGINS).find(name => SITE_ORIGINS[name] === parsed.origin);
    assert.ok(role); assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    assert.equal(options.headers['OAI-Sites-Authorization'], publicApp && role === 'app' ? undefined : `Bearer ${TOKEN}-${role}`);
    const name = parsed.pathname.split('/').at(-1); calls.push({ role, name });
    let body;
    if (name === 'health') body = { data: { ready: true, database: 'connected', raw_in_runtime: false, latest_snapshot_id: VERSION, counts } };
    else if (name === 'manifest') body = { data: { version_id: VERSION, raw_in_runtime: false, scope: 'processed_official_products', counts } };
    else {
      const start = Number(parsed.searchParams.get('cursor') ?? 0), values = data[name];
      body = { data: values.slice(start, start + 100), pagination: { limit: 100, next_cursor: values.length > start + 100 ? String(start + 100) : null }, meta: { catalog_snapshot_id: VERSION, evaluated_at: NOW } };
    }
    const transformed = alter(role, name, structuredClone(body));
    return transformed instanceof Response ? transformed : Response.json(transformed);
  };
  return { input, fetchImpl, calls };
}
const verify = f => verifySites(f.input, { fetchImpl: f.fetchImpl, now: () => new Date(NOW) });

test('all three private routes are read completely and produce only a sanitized receipt', async () => {
  const f = fixture({ size: 103 });
  const result = await verify(f);
  assert.equal(result.verified, true); assert.equal(result.publicationVersion, VERSION);
  assert.deepEqual(result.counts, { player: 103, pack: 1, live: 1, archive: 0 });
  assert.equal(result.verifiedAt, NOW); assert.equal(Object.keys(result.collectionSha256).length, 4);
  for (const role of Object.keys(SITE_ORIGINS)) assert.equal(f.calls.filter(call => call.role === role && call.name === 'players').length, 2);
  assert.equal(JSON.stringify(result).includes(TOKEN), false); assert.equal(JSON.stringify(result).includes('Synthetic'), false);
});

test('effective expiry partition may differ from persisted manifest counts without writing', async () => {
  const result = await verify(fixture({ dynamicArchive: true }));
  assert.deepEqual(result.manifestCounts, { player: 2, pack: 1, live: 1, archive: 0 });
  assert.deepEqual(result.counts, { player: 2, pack: 1, live: 0, archive: 1 });
});

test('unknown connection fields and any origin alteration are rejected before requests', async () => {
  const changes = [input => { input.sites.app.origin += '/'; }, input => { input.sites.viewer.origin = 'https://other.chatgpt.site'; }, input => { input.sites.api.token = TOKEN; }, input => { input.extra = true; }, input => { input.expectedVersionId = 'wrong'; }];
  for (const change of changes) {
    const f = fixture(); change(f.input); await assert.rejects(verify(f)); assert.equal(f.calls.length, 0);
  }
});

test('a stale snapshot or a truncated collection cannot be reported verified', async () => {
  for (const alter of [(_role, name, body) => { if (name === 'players') body.meta.catalog_snapshot_id = 'b'.repeat(64); return body; },
    (_role, name, body) => { if (name === 'players') body.data.pop(); return body; },
    (_role, name, body) => { if (name === 'archive') body.data = [{ invalid: true }]; return body; }]) await assert.rejects(verify(fixture({ alter })));
});

test('internally valid but different actual-site content fails the cross-site comparison', async () => {
  const f = fixture({ alter(role, name, body) {
    if (role === 'app' && ['packs', 'live'].includes(name)) for (const pack of body.data) pack.provenance = { source: 'different-synthetic' };
    return body;
  } });
  await assert.rejects(verify(f), /relay content differs/);
});

test('duplicate IDs, overlapping partitions and repeated cursors are rejected', async () => {
  for (const alter of [(_role, name, body) => { if (name === 'players') body.data[1] = body.data[0]; return body; },
    (_role, name, body) => { if (name === 'live') body.data.push(body.data[0]); return body; },
    (_role, name, body) => { if (name === 'players') body.pagination.next_cursor = 'same-cursor'; return body; }]) await assert.rejects(verify(fixture({ alter })));
});

test('redirects, sign-in HTML, excessive body and transport exceptions never disclose credentials', async () => {
  const implementations = [async () => new Response('', { status: 302, headers: { Location: `https://unapproved.test/${TOKEN}` } }),
    async () => new Response(`<html>${TOKEN}</html>`, { headers: { 'Content-Type': 'text/html' } }),
    async () => new Response(' '.repeat(2 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }),
    async () => { throw new Error(`Request failed with ${TOKEN}`); }];
  for (const fetchImpl of implementations) {
    const f = fixture();
    await assert.rejects(verifySites(f.input, { fetchImpl }), error => !error.message.includes(TOKEN));
  }
});

test('public app is verified anonymously while API and viewer remain authenticated', async () => {
  const f = fixture({ publicApp: true });
  assert.equal((await verify(f)).verified, true);
  assert.ok(f.calls.some(call => call.role === 'app'));
});

test('anonymous mode is limited to the exact app and cannot carry a service credential', async () => {
  for (const role of ['api', 'viewer', 'app']) {
    const f = fixture();
    f.input.sites[role].accessMode = 'public';
    if (role !== 'app') delete f.input.sites[role].serviceToken;
    await assert.rejects(verify(f));
    assert.equal(f.calls.length, 0);
  }
});
