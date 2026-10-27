import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initializeWorkspace, loadWorkspace } from '../scripts/lifecycle/workspace.mjs';
import { runCycle } from '../scripts/lifecycle/run-cycle.mjs';
import { handleCatalogRequest } from '../lib/catalog-api.mjs';
import { fixtureApproval } from './helpers/source-fixture.mjs';

const NOW = '2026-10-27T00:00:00.000Z';
const END = '2026-11-02T01:59:59.000Z';
const ID = '00123456789012345678901234567890';
const originalPlayer = {
  id: ID, name: 'New Player', nameJa: '不要な名前', nameZh: '不需要的名字', slug: 'new-player',
  nationality: '', nationalityCode: '', team: 'Original Team', position: 'CF', overallRating: 85,
  playingStyle: 'Goal Poacher', imageUrl: `https://efimg.com/${ID}.png`, playerType: 5,
};
const originalPack = { name: 'New Pack', slug: 'new-pack', date: '2026-10-26', playerCount: 1 };
const document = body => `<html><head></head><body>${body}</body></html>`;
const flight = value => `<script>self.__next_f.push(${JSON.stringify([1, `a:${JSON.stringify(value)}\n`])})</script>`;
const officialHtml = document('<dl class="probability"><dt>선수 영입 확률</dt><dd><div class="probability_data"><p class="data_title">Official New Pack</p><p>종료 일시(UTC)：2026-11-02 01:59:59</p><p>처음 영입할 때의 선수 수：150</p><p>처음 영입할 때의 영입 확률：0.6667%</p></div><div class="probability_ntc_msg">주의 사항</div></dd></dl>');
const efhubHtml = document(`<h1>New Players</h1><section><h2>New Section</h2><div><a href="/players/${ID}"><p>New Player</p></a></div></section>${flight([{ player: originalPlayer }, { pack: originalPack }])}`);

async function fixture(t) {
  const temporary = await mkdtemp(join(tmpdir(), 'catalog-run-cycle-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = join(temporary, 'workspace');
  const baselinePlayer = { ...originalPlayer, id: '001', name: 'Unrelated old card', slug: 'old-card' };
  const baselinePack = { name: 'Old unused pack', slug: 'old-pack', date: '2026-10-01', playerCount: 1 };
  const playersPath = join(temporary, 'players.json'); const packsPath = join(temporary, 'packs.json');
  const mappingsPath = join(temporary, 'mappings.json'); const dbPath = join(temporary, 'api.sqlite');
  await writeFile(playersPath, JSON.stringify([baselinePlayer]) + '\n');
  await writeFile(packsPath, JSON.stringify([baselinePack]) + '\n');
  const mappingsDocument = { schemaVersion: 1, mappings: [{ saleId: 'new-pack-round-20261026', officialTitle: 'Official New Pack', packSlug: 'new-pack', newPlayersSection: 'New Section', expectedEndsAt: END, expectedTotalPlayerCount: 150, expectedSpecialCount: 1, memberIds: [ID], matchEvidence: { reviewed: 'same round and explicit source IDs' } }] };
  await writeFile(mappingsPath, JSON.stringify(mappingsDocument));
  const initial = await initializeWorkspace({ root, playersPath, packsPath, now: NOW, approval: fixtureApproval(mappingsDocument.mappings) });
  return { temporary, root, mappingsPath, dbPath, baselinePlayer, baselinePack, initial };
}

function htmlFetch(now, { failOfficial = false, failEfhub = false } = {}) {
  const calls = [];
  const fetchHtml = async (url, options) => {
    calls.push(url);
    assert.equal(url.includes('/api/'), false, 'Source API endpoints must never be called');
    assert.equal(options.timeoutMs, 20000);
    if (url === 'https://efootball-web.konami.net/probability_kr.php') {
      if (failOfficial) throw Object.assign(new Error('Official timeout'), { code: 'source_fetch_failed' });
      return { source_url: url, observed_at: now, status: 200, html: officialHtml };
    }
    if (url === 'https://efhub.com/new-players') {
      if (failEfhub) throw Object.assign(new Error('Forbidden'), { code: 'source_denied', status: 403 });
      return { source_url: url, observed_at: now, status: 200, html: efhubHtml };
    }
    throw new Error(`Unexpected network request ${url}`);
  };
  return { calls, fetchHtml };
}

function d1Adapter(db, queries) {
  return { prepare(sql) {
    queries.push(sql);
    return { bind(...values) {
      return {
        async first() { return db.prepare(sql).get(...values) ?? null; },
        async all() { return { success: true, results: db.prepare(sql).all(...values) }; },
      };
    } };
  } };
}
async function apiGet(db, path, now = NOW, queries = []) {
  const response = await handleCatalogRequest(new Request(`https://api.example.test/api/v1/${path}`), { DB: d1Adapter(db, queries) }, { now: Date.parse(now) });
  assert.equal(response.status, 200, await response.clone().text());
  return await response.json();
}
async function jsonLines(path) {
  const bytes = await readFile(path, 'utf8');
  return bytes.trim() ? bytes.trim().split('\n').map(JSON.parse) : [];
}

test('HTML check → original raw append → immutable workspace → SQLite publication → actual processed API', async t => {
  const f = await fixture(t); const source = htmlFetch(NOW);
  const result = await runCycle({ ...f, fetchHtml: source.fetchHtml, now: NOW });
  assert.equal(result.changed, true); assert.deepEqual(result.pending, []);
  assert.equal(result.requestCount, 2); assert.equal(source.calls.length, 2);
  assert.equal(result.publication.locallyActivated, true); assert.equal(result.publication.hostedActivated, false);
  const loaded = await loadWorkspace(f.root);
  assert.equal(loaded.current.version, result.runtimeVersion);
  assert.deepEqual(loaded.rawPlayers, [f.baselinePlayer, originalPlayer]);
  assert.deepEqual(loaded.rawPacks, [f.baselinePack, originalPack]);
  assert.deepEqual(JSON.parse(await readFile(join(f.initial.versionPath, 'raw/players_raw.json'), 'utf8')), [f.baselinePlayer], 'Previous raw generation remains immutable');
  assert.equal(loaded.state.players.length, 1, 'Raw population is not the API population');
  assert.deepEqual(Object.keys(loaded.state.players[0]), ['id', 'name', 'slug', 'position', 'overallRating', 'playingStyle', 'playingStyleDefensive', 'imageUrl']);
  assert.equal(loaded.state.players[0].playingStyleDefensive, null);
  assert.equal(loaded.state.active.length, 1); assert.equal(loaded.state.archive.length, 0);
  assert.deepEqual(loaded.state.active[0].players, loaded.state.players);
  const rawPlayerLog = await jsonLines(join(loaded.versionPath, 'logs/players_raw_updates.jsonl'));
  const rawPackLog = await jsonLines(join(loaded.versionPath, 'logs/packs_raw_updates.jsonl'));
  assert.deepEqual(rawPlayerLog.at(-1).addedRecords, [originalPlayer]);
  assert.equal(rawPlayerLog.at(-1).targetFile, 'raw/players_raw.json');
  assert.deepEqual(rawPackLog.at(-1).addedRecords, [originalPack]);
  assert.equal(rawPackLog.at(-1).targetFile, 'raw/packs_raw.json');
  const apiLog = await jsonLines(join(loaded.versionPath, 'logs/api_updates.jsonl'));
  assert.deepEqual(new Set(apiLog.map(row => row.targetFile)), new Set(['processed/players.json', 'processed/packs.json', 'live.json']));
  const db = new DatabaseSync(f.dbPath); t.after(() => db.close());
  const queries = [];
  const health = await apiGet(db, 'health', NOW, queries);
  assert.equal(health.data.ready, true); assert.equal(health.data.raw_in_runtime, false);
  const players = await apiGet(db, 'players', NOW, queries);
  assert.deepEqual(players.data, loaded.state.players);
  const live = await apiGet(db, 'live', NOW, queries);
  assert.deepEqual(live.data, loaded.state.active);
  assert.equal(live.data[0].totalPlayerCount, 150); assert.equal(live.data[0].playerCount, 1);
  assert.deepEqual(live.data[0].members, [{ id: ID, name: originalPlayer.name }]);
  assert.deepEqual((await apiGet(db, 'packs/new-pack/cards', NOW, queries)).data, loaded.state.players);
  assert.ok(queries.every(sql => !/catalog_entities|entity_revisions|source_snapshots|pack_memberships/.test(sql)), 'Actual API reads only processed publication tables');
  assert.equal(db.prepare('SELECT count(*) AS n FROM source_snapshots').get().n, 0, 'Raw inputs are not imported into runtime data tables');
  assert.equal(db.prepare('SELECT count(*) AS n FROM api_records').get().n, 3);
});

test('unchanged hourly HTML checks replay without duplicate raw records, logs or public versions', async t => {
  const f = await fixture(t);
  const first = await runCycle({ ...f, fetchHtml: htmlFetch(NOW).fetchHtml, now: NOW });
  const afterFirst = await loadWorkspace(f.root);
  const manifestBefore = await readFile(join(first.publication.folder, 'manifest.json'));
  const sqlBefore = await readFile(join(first.publication.folder, 'sql', '0000.sql'));
  const activationBefore = await readFile(join(first.publication.folder, 'activate.sql'));
  const later = '2026-10-27T01:00:00.000Z'; const source = htmlFetch(later);
  const replay = await runCycle({ ...f, fetchHtml: source.fetchHtml, now: later });
  const afterReplay = await loadWorkspace(f.root);
  assert.equal(replay.changed, false); assert.equal(replay.runtimeVersion, first.runtimeVersion);
  assert.equal(replay.publication.versionId, first.publication.versionId);
  assert.equal(afterReplay.state.updates.length, afterFirst.state.updates.length);
  assert.deepEqual(await readFile(join(replay.publication.folder, 'manifest.json')), manifestBefore);
  assert.deepEqual(await readFile(join(replay.publication.folder, 'sql', '0000.sql')), sqlBefore);
  assert.deepEqual(await readFile(join(replay.publication.folder, 'activate.sql')), activationBefore);
  assert.equal(typeof replay.publication.activationFile, 'string');
  assert.equal(afterReplay.state.rawUpdates.players.length, 2); assert.equal(afterReplay.state.rawUpdates.packs.length, 2);
  assert.deepEqual(afterReplay.rawPlayers, afterFirst.rawPlayers);
  assert.deepEqual(afterReplay.rawPacks, afterFirst.rawPacks);
  const db = new DatabaseSync(f.dbPath); t.after(() => db.close());
  assert.equal(db.prepare('SELECT count(*) AS n FROM api_versions').get().n, 1);
  assert.equal((await jsonLines(join(f.root, 'checks.jsonl'))).length, 2);
  assert.equal(source.calls.length, 2);
});

test('source failures preserve the current generation before expiry and move the entire product to archive after expiry', async t => {
  const f = await fixture(t);
  const first = await runCycle({ ...f, fetchHtml: htmlFetch(NOW).fetchHtml, now: NOW });
  const firstState = (await loadWorkspace(f.root)).state;
  const failureTime = '2026-10-27T01:00:00.000Z'; const failed = htmlFetch(failureTime, { failOfficial: true, failEfhub: true });
  const preserved = await runCycle({ ...f, fetchHtml: failed.fetchHtml, now: failureTime });
  assert.equal(preserved.changed, false); assert.equal(preserved.runtimeVersion, first.runtimeVersion);
  assert.equal(preserved.publication.versionId, first.publication.versionId);
  assert.equal(failed.calls.length, 2);
  assert.ok(preserved.sources.some(source => source.http_status === 403));
  const expiredTime = '2026-11-02T02:00:00.000Z'; const expiredSources = htmlFetch(expiredTime, { failOfficial: true, failEfhub: true });
  const expired = await runCycle({ ...f, fetchHtml: expiredSources.fetchHtml, now: expiredTime });
  assert.equal(expired.changed, true); assert.equal(expiredSources.calls.length, 2);
  const after = await loadWorkspace(f.root);
  assert.equal(after.state.active.length, 0); assert.equal(after.state.archive.length, 1);
  assert.deepEqual(after.state.archive[0].players, firstState.active[0].players);
  assert.deepEqual(after.state.players, firstState.players); assert.deepEqual(after.state.packs, firstState.packs);
  assert.deepEqual(after.rawPlayers, [f.baselinePlayer, originalPlayer]);
  assert.deepEqual(after.rawPacks, [f.baselinePack, originalPack]);
  assert.deepEqual(after.state.updates.slice(firstState.updates.length).map(update => update.targetFile), ['live.json', 'archive.json']);
  const db = new DatabaseSync(f.dbPath); t.after(() => db.close());
  assert.deepEqual((await apiGet(db, 'live', expiredTime)).data, []);
  assert.deepEqual((await apiGet(db, 'archive', expiredTime)).data, after.state.archive);
  assert.deepEqual((await apiGet(db, 'players', expiredTime)).data, firstState.players);
  assert.equal(db.prepare('SELECT count(*) AS n FROM api_versions').get().n, 2);
});
