import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCatalogUpdateRecord, writeCatalogUpdateRecord, assertCatalogUpdateRecord, checkCatalogUpdateRecord, UPDATE_RECORD_PATH } from '../scripts/catalog-update-record.mjs';

const HASH = 'a'.repeat(64);
function fixture() {
  return { schemaVersion: 1, operation: 'verification', observedAt: '2026-10-29T03:00:00.000Z', sourceCommit: 'b'.repeat(40), runtimeVersion: HASH, publicationVersion: 'c'.repeat(64),
    rulesIdentity: { version: 'catalog-rules-1.2.0', sha256: HASH }, counts: { rawPlayers: 100, rawPacks: 10, players: 3, packs: 1, live: 1, archive: 0 },
    changes: { rawPlayersAdded: 0, rawPacksAdded: 0, playersAdded: 0, playersUpdated: 0, packsAdded: 0, packsUpdated: 0, archivedPacks: 0, targetFiles: [] },
    phases: { bundle: 'verified', api: 'verified', sites: 'verified', github: 'pending' },
    evidence: { bundleSha256: HASH, sourceReceiptSha256: null, sitesReceiptSha256: HASH, officialHtmlSha256: null, efhubHtmlSha256: null } };
}

test('whitelisted receipt is deterministic and retry phase changes preserve operation identity', () => {
  const input = fixture(); const record = buildCatalogUpdateRecord(input);
  assert.deepEqual(buildCatalogUpdateRecord(input), record); assert.match(record.runId, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(input, 'runId'), false);
  input.phases.sites = 'pending'; input.evidence.sitesReceiptSha256 = null;
  assert.equal(buildCatalogUpdateRecord(input).runId, record.runId);
});

test('secret or unknown fields at every nesting level are rejected instead of stripped silently', () => {
  for (const path of [[], ['rulesIdentity'], ['counts'], ['changes'], ['phases'], ['evidence']]) {
    const input = fixture(); let target = input; for (const name of path) target = target[name]; target.serviceToken = 'synthetic-secret';
    assert.throws(() => buildCatalogUpdateRecord(input));
  }
  const input = fixture(); input.evidence.bundleSha256 = 'synthetic-secret'; assert.throws(() => buildCatalogUpdateRecord(input));
});

test('false completion, fabricated verification changes and count inconsistencies are rejected', () => {
  for (const change of [input => { input.phases.github = 'verified'; }, input => { input.changes.playersAdded = 1; }, input => { input.counts.archive = 1; },
    input => { input.phases.api = 'pending'; }, input => { input.evidence.bundleSha256 = null; }, input => { input.evidence.sitesReceiptSha256 = null; },
    input => { input.observedAt = '2026-10-29'; }, input => { input.rulesIdentity.version = 'secret-value'; },
    input => { input.operation = 'data_update'; }]) {
    const input = fixture(); change(input); assert.throws(() => buildCatalogUpdateRecord(input));
  }
});

test('data update supports only known target files and never self-references a commit', () => {
  const input = fixture(); input.operation = 'data_update'; input.changes.archivedPacks = 1; input.changes.targetFiles = ['live.json', 'archive.json', 'logs/api_updates.jsonl'];
  const record = buildCatalogUpdateRecord(input); assert.deepEqual(record.changes.targetFiles, ['archive.json', 'live.json', 'logs/api_updates.jsonl']); assert.equal(record.phases.github, 'pending');
  input.changes.targetFiles.push('credentials.json'); assert.throws(() => buildCatalogUpdateRecord(input));
});

test('writer changes only the fixed registered file and an exact replay performs no rewrite', async t => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-record-')); t.after(() => rm(root, { recursive: true, force: true }));
  const result = await writeCatalogUpdateRecord(fixture(), root);
  assert.equal(result.path, UPDATE_RECORD_PATH); assert.equal(result.changed, true);
  assert.deepEqual(JSON.parse(await readFile(join(root, UPDATE_RECORD_PATH), 'utf8')), buildCatalogUpdateRecord(fixture()));
  assert.equal((await writeCatalogUpdateRecord(fixture(), root)).changed, false);
  assert.equal((await checkCatalogUpdateRecord(root)).valid, true);
  assert.deepEqual(await readdir(join(root, 'data/updates')), ['catalog-latest.json']);
});

test('a retry with a fresh clock/source/evidence preserves the first receipt, but a phase transition writes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-record-')); t.after(() => rm(root, { recursive: true, force: true }));
  const input = fixture(); input.phases.sites = 'pending'; input.evidence.sitesReceiptSha256 = null;
  await writeCatalogUpdateRecord(input, root);
  const first = await readFile(join(root, UPDATE_RECORD_PATH), 'utf8');
  input.observedAt = '2026-10-29T04:00:00.000Z'; input.sourceCommit = 'd'.repeat(40); input.evidence.bundleSha256 = 'e'.repeat(64);
  assert.equal((await writeCatalogUpdateRecord(input, root)).changed, false);
  assert.equal(await readFile(join(root, UPDATE_RECORD_PATH), 'utf8'), first);
  input.phases.sites = 'verified'; input.evidence.sitesReceiptSha256 = HASH;
  assert.equal((await writeCatalogUpdateRecord(input, root)).changed, true);
  assert.equal((await checkCatalogUpdateRecord(root)).valid, true);
});

test('stored record checker rejects altered run IDs, extra fields and noncanonical target ordering', () => {
  for (const change of [record => { record.runId = 'f'.repeat(64); }, record => { record.token = 'synthetic-secret'; }]) {
    const record = buildCatalogUpdateRecord(fixture()); change(record); assert.throws(() => assertCatalogUpdateRecord(record));
  }
  const input = fixture(); input.operation = 'data_update'; input.changes.targetFiles = ['live.json', 'archive.json'];
  const record = buildCatalogUpdateRecord(input); record.changes.targetFiles.reverse(); assert.throws(() => assertCatalogUpdateRecord(record));
});

test('writer refuses symlinked output directories', async t => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-record-')); const outside = await mkdtemp(join(tmpdir(), 'catalog-record-outside-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
  await symlink(outside, join(root, 'data'));
  await assert.rejects(writeCatalogUpdateRecord(fixture(), root), /symlinks/);
  assert.deepEqual(await readdir(outside), []);
});
