import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { approvalDigest } from '../scripts/lifecycle/rules.mjs';
import { sourceFixture } from './helpers/source-fixture.mjs';
import { VERSION_FILES, initializeWorkspace, loadWorkspace, applyCycle, adoptRules } from '../scripts/lifecycle/workspace.mjs';

const NOW = '2026-10-27T01:00:00.000Z';
const END = '2026-11-02T01:59:59.000Z';
const hash = value => createHash('sha256').update(value).digest('hex');
const player = id => ({ id, name: `Player ${id}`, slug: `player-${id}`, position: 'CF', overallRating: 85, imageUrl: `https://example.com/${id}.png`, nameJa: '', nameZh: '', nationality: '', nationalityCode: '', team: '', playerType: 5 });

async function fixture(t, { includeNew = false } = {}) {
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
  const approvedCandidates = includeNew ? [candidate, nextCandidate(candidate)] : [candidate];
  const approved = await sourceFixture({ rawPlayers, rawPacks, candidates: approvedCandidates, officialObservation, now: NOW });
  const initialized = await initializeWorkspace({ root, playersPath, packsPath, now: NOW, approval: approved.approval });
  return { root, temporary, playersPath, packsPath, playerBytes, packBytes, rawPlayers, rawPacks, candidate, candidates: [candidate], officialObservation, now: NOW, initialized };
}
function nextCandidate(base) {
  const newPlayer = player('999999999999999999999999999');
  const rawPack = { name: 'New official product', slug: 'new-pack', date: '2026-10-27', playerCount: 1 };
  return { ...base, saleId: 'new-sale', packSlug: rawPack.slug, officialTitle: 'New official product', memberIds: [newPlayer.id], expectedSpecialCount: 1, rawPack, rawPlayers: [newPlayer] };
}
async function fixtureSource(options) {
  const loaded = await loadWorkspace(options.root);
  return await sourceFixture({ rawPlayers: loaded.rawPlayers, rawPacks: loaded.rawPacks, candidates: options.candidates ?? [], officialObservation: options.officialObservation, now: options.now ?? NOW, rulesIdentity: loaded.policy.rulesIdentity });
}
async function applyFixture(options) {
  const source = await fixtureSource(options);
  return await applyCycle({ root: options.root, receipt: source.receipt, now: options.now ?? NOW, expectedVersion: options.expectedVersion });
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
  const first = await applyFixture(f);
  assert.equal(first.changed, true); assert.notEqual(first.current.version, f.initialized.current.version);
  assert.equal(first.manifest.previousVersion, f.initialized.current.version);
  assert.deepEqual(await readFile(join(first.versionPath, 'raw/players_raw.json')), f.playerBytes);
  assert.deepEqual(await readFile(join(first.versionPath, 'raw/packs_raw.json')), f.packBytes);
  const beforeVersions = await readdir(join(f.root, 'versions'));
  const replay = await applyFixture({ ...f, now: '2026-10-27T02:00:00Z', officialObservation: { ...f.officialObservation, observedAt: '2026-10-27T02:00:00Z' } });
  assert.equal(replay.changed, false); assert.equal(replay.current.version, first.current.version);
  assert.deepEqual(await readdir(join(f.root, 'versions')), beforeVersions);
  const updates = await lines(join(replay.versionPath, 'logs/api_updates.jsonl'));
  assert.deepEqual(updates.map(update => update.targetFile), ['processed/players.json', 'processed/packs.json', 'live.json']);
  assert.equal((await lines(join(replay.versionPath, 'logs/players_raw_updates.jsonl'))).length, 1);
  const checks = await lines(join(f.root, 'checks.jsonl'));
  assert.deepEqual(checks.map(check => check.status), ['changed', 'no_change']);
});

test('verified raw additions and processed additions publish together with complete append history', async t => {
  const f = await fixture(t, { includeNew: true });
  const initial = await applyFixture(f);
  const candidate = nextCandidate(f.candidate);
  const newPlayer = candidate.rawPlayers[0];
  const officialObservation = { ...f.officialObservation, rows: [...f.officialObservation.rows, { title: candidate.officialTitle, totalPlayerCount: 150, endsAt: END }] };
  const result = await applyFixture({ ...f, candidates: [candidate], officialObservation, expectedVersion: initial.current.version });
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

test('caller verification flags and modified replay candidates cannot partially add raw or processed data', async t => {
  const f = await fixture(t);
  const original = await readFile(join(f.root, 'CURRENT.json'));
  await assert.rejects(applyCycle(f), /HTML receipt is required/);
  assert.deepEqual(await readFile(join(f.root, 'CURRENT.json')), original);
  const source = await fixtureSource(f);
  const supplied = structuredClone(source.candidates); supplied[0].memberIds = ['404'];
  await assert.rejects(applyCycle({ root: f.root, receipt: source.receipt, candidates: supplied, now: NOW }), /differ from replayed HTML/);
  assert.deepEqual(await readFile(join(f.root, 'CURRENT.json')), original);
  const failedSource = await applyCycle({ root: f.root, officialObservation: { status: 'error', complete: false }, candidates: [], now: NOW, sources: [{ url: 'https://efhub.com/new-players', status: 'error', error: 'HTTP 403' }] });
  assert.equal(failedSource.changed, false); assert.equal(failedSource.state.packs.length, 0);
  const checks = await lines(join(f.root, 'checks.jsonl'));
  assert.equal(checks.length, 3); assert.equal(checks[2].sources[0].error, 'HTTP 403');
});

test('expiry publishes archive and live together even while both sources fail', async t => {
  const f = await fixture(t); const first = await applyFixture(f);
  const expired = await applyCycle({ root: f.root, officialObservation: { status: 'error', complete: false }, candidates: [], now: '2026-11-02T02:00:00Z' });
  assert.equal(expired.changed, true); assert.equal(expired.state.active.length, 0); assert.equal(expired.state.archive.length, 1);
  assert.deepEqual(expired.state.archive[0].players, first.state.active[0].players);
  assert.deepEqual(expired.state.players, first.state.players);
  assert.deepEqual(expired.changes.map(change => change.targetFile), ['live.json', 'archive.json']);
  assert.deepEqual(await readFile(join(expired.versionPath, 'raw/players_raw.json')), f.playerBytes);
});

test('revision mismatch and concurrent writers preserve CURRENT without lost updates', async t => {
  const f = await fixture(t); const original = await readFile(join(f.root, 'CURRENT.json'));
  await assert.rejects(applyFixture({ ...f, expectedVersion: '0'.repeat(64) }), /revision changed/);
  assert.deepEqual(await readFile(join(f.root, 'CURRENT.json')), original);
  const attempts = await Promise.allSettled([applyFixture(f), applyFixture(f)]);
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
  await assert.rejects(applyFixture(f), /hash mismatch/);
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

test('missing or modified HTML receipt evidence preserves the current generation', async t => {
  const f = await fixture(t); const source = await fixtureSource(f);
  const original = await readFile(join(f.root, 'CURRENT.json'));
  const changed = structuredClone(source.receipt); changed.requests[0].snapshot.html += '<!-- edited -->';
  await assert.rejects(applyCycle({ root: f.root, receipt: changed, now: NOW }), /HTML bytes\/hash differ/);
  const missing = structuredClone(source.receipt); missing.requests.splice(0, 1);
  await assert.rejects(applyCycle({ root: f.root, receipt: missing, now: NOW }), /receipt/i);
  assert.deepEqual(await readFile(join(f.root, 'CURRENT.json')), original);
  assert.equal((await loadWorkspace(f.root)).state.packs.length, 0);
});

test('an unpinned legacy workspace needs explicit version-guarded rule adoption', async t => {
  const f = await fixture(t);
  await rm(join(f.root, 'RULES.json'));
  const original = await readFile(join(f.root, 'CURRENT.json'));
  await assert.rejects(applyCycle({ root: f.root, now: NOW }), /rules are not pinned/);
  await assert.rejects(adoptRules({ root: f.root, expectedVersion: '0'.repeat(64), reviewId: 'test-review', reason: 'Synthetic migration test', now: NOW }), /revision changed/);
  assert.deepEqual(await readFile(join(f.root, 'CURRENT.json')), original);
  const result = await adoptRules({ root: f.root, expectedVersion: f.initialized.current.version, reviewId: 'test-review', reason: 'Synthetic migration test', now: NOW });
  assert.equal(result.changed, true);
  assert.notEqual(result.current.version, f.initialized.current.version, 'adoption creates a manifest bound to the new policy');
  const adopted = await loadWorkspace(f.root);
  assert.equal(adopted.manifest.previousVersion, f.initialized.current.version);
  assert.deepEqual(await readFile(join(f.initialized.versionPath, 'raw/players_raw.json')), f.playerBytes, 'historical generations remain unchanged');
  for (const file of f.initialized.manifest.files) assert.deepEqual(await readFile(join(adopted.versionPath, file.path)), await readFile(join(f.initialized.versionPath, file.path)), 'adoption preserves every raw/data/log file byte');
  const events = await lines(join(f.root, 'rule-adoptions.jsonl'));
  assert.equal(events.length, 1); assert.equal(events[0].reviewId, 'test-review');
  assert.equal((await loadWorkspace(f.root)).rawPlayers.length, 2);
  const unchanged = await adoptRules({ root: f.root, expectedVersion: result.current.version, reviewId: 'test-review', reason: 'Synthetic migration replay', now: NOW });
  assert.equal(unchanged.changed, false); assert.equal((await lines(join(f.root, 'rule-adoptions.jsonl'))).length, 1);
});

test('editing RULES approval metadata and its digest cannot bypass the CURRENT policy binding', async t => {
  const f = await fixture(t);
  const policyPath = join(f.root, 'RULES.json');
  const originalPolicy = await readFile(policyPath); const originalCurrent = await readFile(join(f.root, 'CURRENT.json'));
  const policy = JSON.parse(originalPolicy); policy.approval.reviews[0].authority = 'Unreviewed changed authority';
  policy.approvalSha256 = approvalDigest(policy.approval);
  await writeFile(policyPath, JSON.stringify(policy));
  await assert.rejects(loadWorkspace(f.root), /policy|binding/i);
  assert.deepEqual(await readFile(join(f.root, 'CURRENT.json')), originalCurrent);
  await writeFile(policyPath, originalPolicy);
  assert.equal((await loadWorkspace(f.root)).rawPlayers.length, 2);
});
