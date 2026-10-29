import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { assertProcessedPlayer, PLAYER_FIELDS } from '../lib/catalog-contract.mjs';
import { reconcileCatalog, enrichPlayerTypes, projectPlayer } from '../lib/catalog-lifecycle.mjs';
import { generatePublication } from '../scripts/lifecycle/publication.mjs';
import { handleCatalogRequest } from '../lib/catalog-api.mjs';

const NOW = '2026-10-30T00:00:00.000Z';
const END = '2026-11-02T01:59:59.000Z';
const rawPlayer = (id, type) => ({ id, name: `Player ${id}`, slug: `player-${id}`, position: 'CF', overallRating: 88, imageUrl: `https://efimg.com/${id}.png`, playerType: type });
function fixture() {
  const rawPlayers = [rawPlayer('1', 5), rawPlayer('2', 6), rawPlayer('3', 8), rawPlayer('4', 3)];
  const rawPacks = [{ name: 'Mixed source pack', slug: 'mixed-pack', date: '2026-10-29', playerCount: rawPlayers.length }];
  const candidate = { saleId: 'mixed-sale', packSlug: rawPacks[0].slug, officialTitle: 'Epic: Mixed source pack', totalPlayerCount: 150, endsAt: END, memberIds: rawPlayers.map(p => p.id), expectedSpecialCount: rawPlayers.length, membershipComplete: true, matchVerified: true, evidence: { source: 'synthetic-type-regression' } };
  return { rawPlayers, rawPacks, candidates: [candidate], officialObservation: { status: 'ok', complete: true, observedAt: NOW, rows: [{ title: candidate.officialTitle, totalPlayerCount: 150, endsAt: END }] }, now: NOW };
}

test('new materialization preserves exact source types, including future numeric codes, without pack-grade inference', () => {
  const f = fixture(); const before = structuredClone(f);
  const result = reconcileCatalog(f);
  assert.deepEqual(result.state.players.map(p => p.playerType), [5, 6, 8, 3]);
  assert.deepEqual(result.state.active[0].players, result.state.players);
  assert.deepEqual(Object.keys(result.state.players[0]), PLAYER_FIELDS);
  assert.equal(projectPlayer(rawPlayer('5', 99)).playerType, 99, 'unknown positive source codes are retained, never relabeled');
  assert.deepEqual(f, before);
});

test('missing or malformed source type cannot enter a new processed generation', () => {
  for (const type of [undefined, null, 0, -1, 5.1, '5', NaN]) {
    const source = rawPlayer('1', type);
    assert.throws(() => projectPlayer(source), /player type/);
    const f = fixture(); f.rawPlayers[0] = source;
    const result = reconcileCatalog(f);
    assert.equal(result.state.players.length, 0);
    assert.match(result.pending[0].reason, /invalid_raw_player/);
  }
  for (const type of [null, '5', 0, -1, 1.5]) {
    const player = projectPlayer(rawPlayer('1', 5)); player.playerType = type;
    assert.throws(() => assertProcessedPlayer(player), /player type/);
  }
});

test('explicit legacy migration enriches current and archived players together and preserves every pack/archive field', () => {
  const f = fixture();
  const first = reconcileCatalog(f).state;
  const ended = reconcileCatalog({ ...f, state: first, candidates: [], officialObservation: null, now: '2026-11-02T02:00:00.000Z' }).state;
  for (const p of ended.players) delete p.playerType;
  for (const pack of ended.archive) for (const p of pack.players) delete p.playerType;
  const original = structuredClone(ended);
  assert.doesNotThrow(() => generatePublication({ state: ended }), 'eight-field immutable legacy publications remain readable');
  const next = enrichPlayerTypes(ended, f.rawPlayers, '2026-11-02T03:00:00.000Z');
  assert.equal(next.changed, true);
  assert.deepEqual(next.state.packs, original.packs);
  assert.deepEqual(next.state.rawUpdates, original.rawUpdates);
  assert.deepEqual(next.state.observations, original.observations);
  const { players: _oldPlayers, ...oldPack } = original.archive[0];
  const { players: _newPlayers, ...newPack } = next.state.archive[0];
  assert.deepEqual(newPack, oldPack, 'archive timestamps, membership, counts, draw options and provenance stay exact');
  assert.deepEqual(next.state.archive[0].players, next.state.players);
  assert.deepEqual(next.changes.map(c => c.targetFile), ['processed/players.json', 'archive.json']);
  assert.deepEqual(ended, original);
  const replay = enrichPlayerTypes(next.state, f.rawPlayers, '2026-11-02T04:00:00.000Z');
  assert.equal(replay.changed, false); assert.deepEqual(replay.state, next.state);
  assert.throws(() => enrichPlayerTypes(ended, f.rawPlayers.slice(1), NOW), /source is missing/);
  assert.throws(() => enrichPlayerTypes(next.state, [rawPlayer('1', 8), ...f.rawPlayers.slice(1)], NOW), /conflicts with source/);
});

test('typed players survive player list/detail, pack membership and nested live/archive API responses', async () => {
  const f = fixture(); const value = reconcileCatalog(f).state;
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../drizzle/0001_api_publications.sql', import.meta.url), 'utf8'));
  const bundle = generatePublication({ state: value, createdAt: NOW });
  for (const chunk of bundle.sqlChunks) db.exec(chunk.sql);
  db.exec(bundle.activateSql);
  const DB = { prepare(sql) { const q = db.prepare(sql); return { bind(...args) { return { async first() { return q.get(...args) ?? null; }, async all() { return { success: true, results: q.all(...args) }; } }; } }; } };
  const read = async path => (await handleCatalogRequest(new Request(`https://api.example/api/v1${path}`), { DB }, { now: NOW })).json();
  try {
    const expected = value.players.map(p => p.playerType);
    assert.deepEqual((await read('/players')).data.map(p => p.playerType), expected);
    assert.equal((await read('/players/2')).data.playerType, 6);
    assert.deepEqual((await read('/packs/mixed-sale/players')).data.map(p => p.playerType), expected);
    assert.deepEqual((await read('/live')).data[0].players.map(p => p.playerType), expected);
    const ended = reconcileCatalog({ ...f, state: value, candidates: [], officialObservation: null, now: '2026-11-02T02:00:00.000Z' }).state;
    const archiveBundle = generatePublication({ state: ended, createdAt: NOW, expectedVersionId: bundle.versionId });
    for (const chunk of archiveBundle.sqlChunks) db.exec(chunk.sql);
    db.exec(archiveBundle.activateSql);
    assert.deepEqual((await read('/archive')).data[0].players.map(p => p.playerType), expected);
  } finally { db.close(); }
});
