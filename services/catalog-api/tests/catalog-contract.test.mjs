import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertRawPlayer, assertRawPack, assertApiUpdateLog, assertRawUpdateLog, canonical } from '../lib/catalog-contract.mjs';
import { planRawAppend, reconcileCatalog, validateLifecycleState } from '../lib/catalog-lifecycle.mjs';
import { generatePublication } from '../scripts/lifecycle/publication.mjs';

const NOW = '2026-10-27T01:00:00.000Z';
const END = '2026-11-02T01:59:59.000Z';
const rawPlayer = id => ({ id, name: `Player ${id}`, nameJa: '', nameZh: '', nationality: '', nationalityCode: '', team: '', slug: `player-${id}`, position: 'CF', overallRating: 85, imageUrl: `https://efimg.com/${id}.png`, playerType: 5 });
const rawPack = slug => ({ name: slug, slug, date: '2026-10-27', playerCount: 1 });
function fixture() {
  const baseline = rawPlayer('999');
  const candidates = ['b', 'a'].map((label, index) => ({ saleId: `sale-${label}`, packSlug: `pack-${label}`, officialTitle: `Official ${label}`, totalPlayerCount: 150, endsAt: END, memberIds: [String(index + 1)], expectedSpecialCount: 1, membershipComplete: true, matchVerified: true, evidence: { z: 'source', a: { y: 2, x: 1 } }, rawPack: rawPack(`pack-${label}`), rawPlayers: [rawPlayer(String(index + 1))] }));
  const officialObservation = { status: 'ok', complete: true, observedAt: NOW, sha256: 'official-hash', rows: candidates.map(c => ({ title: c.officialTitle, totalPlayerCount: 150, endsAt: END })) };
  return { rawPlayers: [baseline], rawPacks: [], candidates, officialObservation, now: NOW };
}
function processed(input) {
  const raw = planRawAppend(input);
  const result = reconcileCatalog({ ...input, ...raw });
  return { raw, result, publication: generatePublication({ state: result.state, createdAt: NOW }) };
}
const reversedKeys = value => Array.isArray(value) ? value.map(reversedKeys) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reversedKeys(v)])) : value;

test('every append route rejects incomplete original raw shape, extra fields, invalid types and orphan payloads', () => {
  assert.doesNotThrow(() => assertRawPlayer(rawPlayer('000123456789012345678901234567890')));
  for (const edit of [p => { delete p.nameJa; }, p => { p.jerseyNumber = 9; }, p => { p.overallRating = '85'; }, p => { p.playerType = 0; }, p => { p.id = 123; }, p => { p.playingStyle = null; }]) {
    const f = fixture(); edit(f.candidates[0].rawPlayers[0]);
    const plan = planRawAppend(f);
    assert.equal(plan.addedPacks.length, 1, 'only the unaffected complete product is admitted');
    assert.equal(plan.pending.length, 1);
  }
  const f = fixture(); f.candidates[0].rawPlayers.push(rawPlayer('unlinked'.replace('unlinked', '777')));
  const plan = planRawAppend(f);
  assert.equal(plan.pending[0].reason, 'unlinked_raw_player_payload');
  assert.equal(plan.rawPlayers.some(p => p.id === '777'), false);
  assert.throws(() => assertRawPack({ ...rawPack('pack-a'), extra: true }), /fields/);
  assert.throws(() => assertRawPack({ ...rawPack('pack-a'), date: '2026-02-30' }), /values/);
});

test('equivalent candidate/member/object-key permutations produce identical raw deltas, state, SQL and public version', () => {
  const f = fixture();
  f.candidates[0].rawPlayers.push(rawPlayer('003'));
  f.candidates[0].memberIds.push('003'); f.candidates[0].expectedSpecialCount = 2; f.candidates[0].rawPack.playerCount = 2;
  const one = processed(f);
  const shuffled = reversedKeys(f); shuffled.rawPlayers = f.rawPlayers; shuffled.rawPacks = f.rawPacks; shuffled.candidates.reverse();
  for (const candidate of shuffled.candidates) { candidate.rawPlayers.reverse(); candidate.memberIds.reverse(); }
  const two = processed(shuffled);
  assert.equal(JSON.stringify(one.raw), JSON.stringify(two.raw));
  assert.equal(JSON.stringify(one.result.state), JSON.stringify(two.result.state));
  assert.equal(one.publication.versionId, two.publication.versionId);
  assert.deepEqual(one.publication.sqlChunks, two.publication.sqlChunks);
  assert.deepEqual(one.raw.rawPlayers[0], f.rawPlayers[0], 'baseline raw record is preserved');
  assert.deepEqual(one.raw.rawPlayers.map(p => p.id), ['999', '003', '1', '2'], 'only the appended tail is codepoint sorted');
  const replay = reconcileCatalog({ ...f, rawPlayers: one.raw.rawPlayers, rawPacks: one.raw.rawPacks, state: one.result.state });
  assert.deepEqual(replay.state, one.result.state); assert.deepEqual(replay.changes, []);
});

test('duplicate sales/packs and cross-product conflicting card payloads reject all contenders independent of order', () => {
  for (const alter of [
    f => { f.candidates[1].saleId = f.candidates[0].saleId; },
    f => { f.candidates[1].packSlug = f.candidates[0].packSlug; f.candidates[1].rawPack = f.candidates[0].rawPack; },
    f => { f.candidates[1].memberIds = f.candidates[0].memberIds; f.candidates[1].rawPlayers = [{ ...f.candidates[0].rawPlayers[0], name: 'Conflicting card name' }]; },
  ]) {
    const f = fixture(); alter(f);
    const first = planRawAppend(f); const reversed = planRawAppend({ ...f, candidates: [...f.candidates].reverse() });
    assert.deepEqual(first, reversed); assert.deepEqual(first.addedPlayers, []); assert.deepEqual(first.addedPacks, []); assert.equal(first.pending.length, 2);
  }
});

test('strict processed pack and log schemas reject unknown fields, missing targetFile and inconsistent counts', () => {
  const f = fixture(); const { result } = processed(f);
  for (const edit of [
    state => { state.packs[0].extra = 'field'; state.active[0].extra = 'field'; },
    state => { delete state.packs[0].officialTitle; delete state.active[0].officialTitle; },
    state => { delete state.updates[0].targetFile; },
    state => { state.updates[0].afterCount += 1; },
    state => { state.updates[0].evidence.guessed = true; },
    state => { state.active[0].archivedAt = NOW; state.active[0].archiveReason = 'ended'; },
    state => { const transition = state.updates.find(update => update.targetFile === 'live.json').transitions[0]; transition.saleId = 'unrelated-sale'; },
    state => { const transition = state.updates.find(update => update.targetFile === 'live.json').transitions[0]; transition.reason = 'ended'; },
  ]) {
    const corrupt = structuredClone(result.state); edit(corrupt); assert.throws(() => validateLifecycleState(corrupt));
  }
  const record = result.state.updates[0]; assert.doesNotThrow(() => assertApiUpdateLog(record));
  const baseline = { id: 'baseline-id', at: NOW, action: 'baseline_import', targetFile: 'raw/players_raw.json', beforeCount: null, afterCount: 1, importedCount: 1, addedIds: [], beforeSha256: null, afterSha256: 'a'.repeat(64), source: 'provided_raw_file' };
  assert.doesNotThrow(() => assertRawUpdateLog(baseline, 'players'));
  assert.throws(() => assertRawUpdateLog({ ...baseline, targetFile: 'live.json' }, 'players'));
  const appended = { id: 'raw-id', at: NOW, action: 'append', targetFile: 'raw/players_raw.json', beforeCount: 1, afterCount: 2, addedCount: 1, addedIds: ['2'], addedRecords: [rawPlayer('2')], beforeSha256: 'a'.repeat(64), afterSha256: 'b'.repeat(64), evidence: { officialObservedAt: NOW, officialSha256: 'source-hash', sources: [] } };
  assert.doesNotThrow(() => assertRawUpdateLog(appended, 'players'));
  assert.throws(() => assertRawUpdateLog({ ...appended, addedIds: ['3'] }, 'players'));
  assert.throws(() => assertRawUpdateLog({ ...appended, addedRecords: [{ id: '2' }] }, 'players'));
});

test('public version rejects invalid player types and unexpected nested or archive fields', () => {
  const state = processed(fixture()).result.state;
  const badPlayer = structuredClone(state); badPlayer.players[0].overallRating = '85';
  assert.throws(() => generatePublication({ state: badPlayer }), /rating/);
  const extraNested = structuredClone(state); extraNested.active[0].accidentalField = true;
  assert.throws(() => generatePublication({ state: extraNested }), /Nested pack fields/);
  assert.throws(() => canonical({ undefinedValue: undefined }), /defined JSON/);
  assert.throws(() => canonical({ number: Infinity }), /finite/);
  assert.equal(createHash('sha256').update(canonical({ b: 2, a: 1 })).digest('hex'), createHash('sha256').update(canonical({ a: 1, b: 2 })).digest('hex'));
});
