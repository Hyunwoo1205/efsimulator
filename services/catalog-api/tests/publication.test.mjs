import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { generatePublication, assertPublicationRows } from '../scripts/lifecycle/publication.mjs';

const NOW = '2026-10-27T00:00:00.000Z';
function fixture() {
  const player = { id: '999999999999999999999', name: "O'Brien", slug: 'obrien', position: 'CF', overallRating: 82, playingStyle: null, playingStyleDefensive: null, imageUrl: 'https://efimg.com/card.png' };
  const pack = { saleId: 'round-1', name: 'Pack', slug: 'pack', date: '2026-10-26', playerCount: 1, sourceReportedPlayerCount: 1, totalPlayerCount: 150, standardPlayerCount: 149, endsAt: '2026-11-02T01:59:59.000Z', officialTitle: 'Official Pack', members: [{ id: player.id, name: player.name }], countCorrection: null, provenance: { official: 'hash1', efhub: 'hash2' } };
  return { players: [player], packs: [pack], active: [{ ...structuredClone(pack), players: [structuredClone(player)] }], archive: [] };
}
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../drizzle/0001_api_publications.sql', import.meta.url), 'utf8'));
  return db;
}
const current = db => db.prepare("SELECT version_id FROM api_current WHERE singleton='current'").get()?.version_id ?? null;
const load = (db, bundle) => bundle.sqlChunks.forEach(chunk => db.exec(chunk.sql));
const rows = (db, bundle) => db.prepare('SELECT kind,record_key,payload_json FROM api_records WHERE version_id=?').all(bundle.versionId);

test('chunk replay is idempotent; partial uploads cannot activate; ready version is checked before singlepointer switch', () => {
  const db = database();
  try {
    const bundle = generatePublication({ state: fixture(), createdAt: NOW, chunkSize: 1 });
    db.exec(bundle.sqlChunks[0].sql); db.exec(bundle.activateSql);
    assert.equal(current(db), null, 'Manifest alone must not activate partial data');
    load(db, bundle); assertPublicationRows(rows(db, bundle), bundle); db.exec(bundle.activateSql);
    assert.equal(current(db), bundle.versionId);
    const before = db.prepare('SELECT * FROM api_records ORDER BY 1,2,3').all();
    load(db, bundle); db.exec(bundle.activateSql);
    assert.deepEqual(db.prepare('SELECT * FROM api_records ORDER BY 1,2,3').all(), before);
    assert.equal(current(db), bundle.versionId);
  } finally { db.close(); }
});

test('stale writers cannot replace a newer publication; correctlease succeeds and previousversions remain', () => {
  const db = database();
  try {
    const first = generatePublication({ state: fixture(), createdAt: NOW }); load(db, first); db.exec(first.activateSql);
    const nextState = fixture(); nextState.packs[0].totalPlayerCount = 151; nextState.packs[0].standardPlayerCount = 150;
    nextState.active[0].totalPlayerCount = 151; nextState.active[0].standardPlayerCount = 150;
    const next = generatePublication({ state: nextState, createdAt: NOW, expectedVersionId: 'stale-head' });
    load(db, next); db.exec(next.activateSql); assert.equal(current(db), first.versionId);
    const correct = generatePublication({ state: nextState, createdAt: NOW, expectedVersionId: first.versionId });
    db.exec(correct.activateSql); assert.equal(current(db), correct.versionId);
    assert.equal(db.prepare('SELECT count(*) AS n FROM api_versions').get().n, 2);
    assert.equal(db.prepare('SELECT count(*) AS n FROM api_records WHERE version_id=?').get(first.versionId).n, first.records.length);
  } finally { db.close(); }
});

test('uploaded content collisions and checksum changes are rejected rather than silently overwriting an immutableversion', () => {
  const db = database();
  try {
    const bundle = generatePublication({ state: fixture(), createdAt: NOW }); load(db, bundle);
    db.prepare("UPDATE api_records SET payload_json='{}' WHERE version_id=? AND kind='player'").run(bundle.versionId);
    assert.throws(() => assertPublicationRows(rows(db, bundle), bundle), /do not match/);
    assert.throws(() => load(db, bundle), /NOT NULL/);
  } finally { db.close(); }
});

test('publications reject rawfields, brokenreferences, duplicatedpartitions, and incomplete specialcards', () => {
  const withRaw = fixture(); withRaw.players[0].nameJa = '不公開';
  assert.throws(() => generatePublication({ state: withRaw }), /eight/);
  const orphan = fixture(); orphan.packs[0].members[0].id = '123';
  assert.throws(() => generatePublication({ state: orphan }), /processed player/);
  const duplicate = fixture(); duplicate.archive.push(structuredClone(duplicate.active[0]));
  assert.throws(() => generatePublication({ state: duplicate }), /partition/);
  const wrongCount = fixture(); wrongCount.packs[0].playerCount = 3;
  assert.throws(() => generatePublication({ state: wrongCount }), /special count/);
  const wrongStandard = fixture(); wrongStandard.packs[0].standardPlayerCount = 0;
  assert.throws(() => generatePublication({ state: wrongStandard }), /Standard/);
  const missingFullCopy = fixture(); missingFullCopy.active[0].players[0].imageUrl = 'other';
  assert.throws(() => generatePublication({ state: missingFullCopy }), /differ/);
});

test('versionhash describes publiccontent, ignores rawcollections and logs, and excludes observations timestamps', () => {
  const state = fixture();
  const one = generatePublication({ state, createdAt: NOW });
  state.rawPlayers = [{ id: 'private' }]; state.updates = [{ localPath: '/private' }];
  const two = generatePublication({ state, createdAt: '2026-10-27T01:00:00Z' });
  assert.equal(one.versionId, two.versionId);
  assert.equal(JSON.stringify(two.records).includes('/private'), false);
  assert.equal(two.manifest.raw_in_runtime, false);
});
