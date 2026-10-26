import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { VERSION_FILES, initializeWorkspace, loadWorkspace, applyCycle } from '../scripts/lifecycle/workspace.mjs';

const NOW = '2026-10-27T01:00:00.000Z';
const END = '2026-11-02T01:59:59.000Z';
const hash = value => createHash('sha256').update(value).digest('hex');
const player = id => ({ id, name: `Player ${id}`, slug: `player-${id}`, position: 'CF', overallRating: 85, imageUrl: `https://example.com/${id}.png`, nameJa: '', nameZh: '', playerType: 5 });

async function fixture(t) {
  const temporary = await mkdtemp(join(tmpdir(), 'catalog-lifecycle-workspace-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const root = join(temporary, 'workspace');
  const rawPlayers = [player('88046292831684'), player('105896445274201')];
  const rawPacks = [{ name: 'Italian attackers', slug: 'italian-attackers', date: '2026-10-26', playerCount: 2 }];
  // Deliberately noncanonical input bytes: initialization/unchanged cycles must
  // preserve the supplied documents rather than silently reserialize them.
  const playerBytes = Buffer.from(` [\n ${rawPlayers.map(value => JSON.stringify(value)).join(',\n ')}\n ] \n`);
  const packBytes = Buffer.from(`${JSON.stringify(rawPacks)}\n\n`);
  const playersPath = join(temporary, 'players.json'); const packsPath = join(temporary, 'packs.json');
  await writeFile(playersPath, playerBytes); await writeFile(packsPath, packBytes);
  const candidate = {
    saleId: 'italian-attackers-20261026', packSlug: 'italian-attackers', officialTitle: 'Epic: Italian League Attackers',
    totalPlayerCount: 150, endsAt: END, memberIds: rawPlayers.map(value => value.id), expectedSpecialCount: 2,
    membershipComplete: true, matchVerified: true, evidence: { efhubHtmlSha256: 'html-hash' },
  };
  const officialObservation = { status: 'ok', complete: true, observedAt: NOW, sha256: 'official-hash', rows: [{ title: candidate.officialTitle, totalPlayerCount: 150, endsAt: END }] };
  const initialized = await initializeWorkspace({ root, playersPath, packsPath, now: NOW });
  return { root, temporary, playersPath, packsPath, playerBytes, packBytes, rawPlayers, rawPacks, candidate, candidates: [candidate], officialObservation, now: NOW, initialized };
}
async function lines(path) {
  const text = await readFile(path, 'utf8');
  return text.trim() ? text.trim().split('\n').map(line => JSON.parse(line)) : [];
}

test('initial immutable generation hashes every output and preserves exact raw source bytes', async t => {
  const f = await fixture(t); const loaded = await loadWorkspace(f.root);
  assert.equal(loaded.current.version, f.initialized.current.version);
  assert.deepEqual(await readFile(join(loaded.versionPath, 'raw/players_raw.json')), f.playerBytes);
  assert.deepEqual(await readFile(join(loaded.versionPath, 'raw/packs_raw.json')), f.packBytes);
  assert.deepEqual(new Set(loaded.manifest.files.map(file => file.path)), new Set(VERSION_FILES));
  for (const file of loaded.manifest.files) {
    const bytes = await readFile(join(loaded.versionPath, file.path));
    assert.equal(file.sha256, hash(bytes)); assert.equal(file.bytes, bytes.length);
  }
  assert.equal(loaded.state.players.length, 0, 'raw population is not the processed API population');
  const baseline = (await lines(join(loaded.versionPath, 'logs/players_raw_updates.jsonl')))[0];
  assert.equal(baseline.action, 'baseline_import'); assert.equal(baseline.beforeCount, null);
  assert.equal(baseline.importedCount, 2); assert.deepEqual(baseline.addedIds, []);
  await assert.rejects(initializeWorkspace({ root: f.root, playersPath: f.playersPath, packsPath: f.packsPath, now: NOW }), /already initialized/);
});

test('a new processed generation retains raw bytes and target-aware logs; replay only adds a check', async t => {
  const f = await fixture(t);
  const first = await applyCycle(f);
  assert.equal(first.changed, true); assert.notEqual(first.current.version, f.initialized.current.version);
  assert.equal(first.manifest.previousVersion, f.initialized.current.version);
  assert.deepEqual(await readFile(join(first.versionPath, 'raw/players_raw.json')), f.playerBytes);
  assert.deepEqual(await readFile(join(first.versionPath, 'raw/packs_raw.json')), f.packBytes);
  const beforeVersions = await readdir(join(f.root, 'versions'));
  const replay = await applyCycle({ ...f, now: '2026-10-27T02:00:00Z', officialObservation: { ...f.officialObservation, observedAt: '2026-10-27T02:00:00Z' } });
  assert.equal(replay.changed, false); assert.equal(replay.current.version, first.current.version);
  assert.deepEqual(await readdir(join(f.root, 'versions')), beforeVersions);
  const updates = await lines(join(replay.versionPath, 'logs/api_updates.jsonl'));
  assert.deepEqual(updates.map(update => update.targetFile), ['processed/players.json', 'processed/packs.json', 'live.json']);
  assert.equal((await lines(join(replay.versionPath, 'logs/players_raw_updates.jsonl'))).length, 1);
  const checks = await lines(join(f.root, 'checks.jsonl'));
  assert.deepEqual(checks.map(check => check.status), ['changed', 'no_change']);
});

test('verified raw additions and processed additions publish together with complete append history', async t => {
  const f = await fixture(t);
  const initial = await applyCycle(f);
  const newPlayer = player('999999999999999999999999999');
  const rawPack = { name: 'New official product', slug: 'new-pack', date: '2026-10-27', playerCount: 1 };
  const candidate = { ...f.candidate, saleId: 'new-sale', packSlug: rawPack.slug, officialTitle: 'New official product', memberIds: [newPlayer.id], expectedSpecialCount: 1, rawPack, rawPlayers: [newPlayer] };
  const officialObservation = { ...f.officialObservation, rows: [...f.officialObservation.rows, { title: candidate.officialTitle, totalPlayerCount: 150, endsAt: END }] };
  const result = await applyCycle({ ...f, candidates: [candidate], officialObservation, expectedVersion: initial.current.version });
  assert.equal(result.rawPlayers.length, 3); assert.equal(result.rawPacks.length, 2);
  assert.equal(result.state.players.length, 3); assert.equal(result.state.packs.length, 2);
  assert.deepEqual(result.rawPlayers.slice(0, 2), f.rawPlayers);
  const logs = await lines(join(result.versionPath, 'logs/players_raw_updates.jsonl'));
  assert.equal(logs.length, 2); const delta = logs[1];
  assert.equal(delta.targetFile, 'raw/players_raw.json'); assert.equal(delta.action, 'append');
  assert.deepEqual(delta.addedIds, [newPlayer.id]); assert.deepEqual(delta.addedRecords, [newPlayer]);
  assert.equal(delta.beforeSha256, hash(f.playerBytes));
  assert.equal(delta.afterSha256, hash(await readFile(join(result.versionPath, delta.targetFile))));
  assert.deepEqual(await readFile(join(f.initialized.versionPath, 'raw/players_raw.json')), f.playerBytes, 'old generations remain immutable');
});

test('one-sided or conflicting raw payloads cannot partially add raw or processed data', async t => {
  const f = await fixture(t);
  const candidate = { ...f.candidate, rawPack: f.rawPacks[0], rawPlayers: [{ ...f.rawPlayers[0], name: 'Conflicting source value' }] };
  const blocked = await applyCycle({ ...f, candidates: [candidate] });
  assert.equal(blocked.changed, false); assert.equal(blocked.current.version, f.initialized.current.version);
  assert.match(blocked.pending[0].reason, /raw_player_conflict/);
  const failedSource = await applyCycle({ ...f, officialObservation: { status: 'error', complete: false }, sources: [{ url: 'https://efhub.com/new-players', status: 'error', error: 'HTTP 403' }] });
  assert.equal(failedSource.changed, false); assert.equal(failedSource.state.packs.length, 0);
  const checks = await lines(join(f.root, 'checks.jsonl'));
  assert.equal(checks.length, 2); assert.equal(checks[1].sources[0].error, 'HTTP 403');
});

test('expiry publishes archive and live together even while both sources fail', async t => {
  const f = await fixture(t); const first = await applyCycle(f);
  const expired = await applyCycle({ root: f.root, officialObservation: { status: 'error', complete: false }, candidates: [], now: '2026-11-02T02:00:00Z' });
  assert.equal(expired.changed, true); assert.equal(expired.state.active.length, 0); assert.equal(expired.state.archive.length, 1);
  assert.deepEqual(expired.state.archive[0].players, first.state.active[0].players);
  assert.deepEqual(expired.state.players, first.state.players);
  assert.deepEqual(expired.changes.map(change => change.targetFile), ['live.json', 'archive.json']);
  assert.deepEqual(await readFile(join(expired.versionPath, 'raw/players_raw.json')), f.playerBytes);
});

test('revision mismatch and concurrent writers preserve CURRENT without lost updates', async t => {
  const f = await fixture(t); const original = await readFile(join(f.root, 'CURRENT.json'));
  await assert.rejects(applyCycle({ ...f, expectedVersion: '0'.repeat(64) }), /revision changed/);
  assert.deepEqual(await readFile(join(f.root, 'CURRENT.json')), original);
  const attempts = await Promise.allSettled([applyCycle(f), applyCycle(f)]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = attempts.find(result => result.status === 'rejected');
  assert.match(rejected.reason.message, /locked/);
  const loaded = await loadWorkspace(f.root);
  assert.equal(loaded.state.packs.length, 1); assert.equal(loaded.state.updates.length, 3);
  assert.equal((await readdir(f.root)).includes('.write-lock'), false);
});

test('hash validation rejects modified generations before replacing CURRENT', async t => {
  const f = await fixture(t); const original = await readFile(join(f.root, 'CURRENT.json'));
  const path = join(f.initialized.versionPath, 'processed/players.json');
  const originalPlayers = await readFile(path);
  await writeFile(path, '[{"id":"tampered"}]\n');
  await assert.rejects(applyCycle(f), /hash mismatch/);
  assert.deepEqual(await readFile(join(f.root, 'CURRENT.json')), original);
  assert.deepEqual(await readdir(join(f.root, 'versions')), [f.initialized.current.version]);
  await writeFile(path, originalPlayers);
  assert.equal((await loadWorkspace(f.root)).state.packs.length, 0);
});

test('provided historical player update document is preserved as evidence without replaying additions', async t => {
  const f = await fixture(t);
  const root = join(f.temporary, 'second-workspace'); const updatePath = join(f.temporary, 'old-update.json');
  const bytes = Buffer.from(' { "schemaVersion": 1, "addedCount": 11 } \n');
  await writeFile(updatePath, bytes);
  const result = await initializeWorkspace({ root, playersPath: f.playersPath, packsPath: f.packsPath, playerUpdatePath: updatePath, now: NOW });
  assert.deepEqual(await readFile(join(result.versionPath, 'raw/source_player_update.json')), bytes);
  assert.equal(result.state.rawUpdates.players.length, 1);
  assert.equal(result.state.rawUpdates.players[0].sourceUpdate.targetFile, 'raw/source_player_update.json');
  assert.deepEqual(result.state.rawUpdates.players[0].addedIds, []);
});
