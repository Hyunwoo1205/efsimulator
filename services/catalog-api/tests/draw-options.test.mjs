import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProcessedPack, createDrawOptions } from '../lib/catalog-contract.mjs';
import { enrichPackDrawOptions, reconcileCatalog } from '../lib/catalog-lifecycle.mjs';
import { generatePublication } from '../scripts/lifecycle/publication.mjs';

const NOW = '2026-10-30T00:00:00.000Z';
const END = '2026-11-02T01:59:59.000Z';
function fixture(totalPlayerCount) {
  const rawPlayers = [{ id: '1', name: 'Player 1', slug: 'player-1', position: 'CF', overallRating: 85, imageUrl: 'https://efimg.com/1.png', playerType: 5 }];
  const rawPacks = [{ name: 'Test pack', slug: 'test-pack', date: '2026-10-29', playerCount: 1 }];
  const candidate = { saleId: 'test-sale', packSlug: 'test-pack', officialTitle: 'Official test pack', totalPlayerCount, endsAt: END, memberIds: ['1'], expectedSpecialCount: 1, membershipComplete: true, matchVerified: true, evidence: { source: 'synthetic-test' } };
  const officialObservation = { status: 'ok', complete: true, observedAt: NOW, sha256: 'official-test-hash', rows: [{ title: candidate.officialTitle, totalPlayerCount, endsAt: END }] };
  return { rawPlayers, rawPacks, candidates: [candidate], officialObservation, now: NOW };
}

test('11 is single only; 12 and larger support ten based on official total rather than special count', () => {
  for (const total of [1, 10, 11, 12, 150]) {
    const input = fixture(total); const before = JSON.stringify(input);
    const result = reconcileCatalog(input);
    const options = result.state.packs[0].drawOptions;
    assert.equal(options.single.supported, true);
    assert.equal(options.ten.supported, total > 11);
    assert.equal(options.ten.minimumRemaining, 10);
    assert.equal(options.single.coinCost, 100);
    assert.equal(options.ten.coinCost, 900);
    assert.deepEqual(result.state.active[0].drawOptions, options);
    assert.equal(JSON.stringify(input), before, 'source inputs are unchanged');
  }
});

test('support and fixed prices are strict and retain user-confirmed provenance', () => {
  const pack = reconcileCatalog(fixture(150)).state.packs[0];
  assert.equal(pack.playerCount, 1, 'one special card does not disable a 150-person ten draw');
  assert.deepEqual(pack.drawOptions.provenance, { authority: 'direct_user_confirmation', reference: 'T042', rule: 'total_player_count_gt_11' });
  for (const edit of [
    options => { options.ten.supported = false; },
    options => { options.ten.minimumRemaining = 1; },
    options => { options.single.coinCost = 99; },
    options => { options.ten.coinCost = 500; },
    options => { options.provenance.authority = 'official_source'; },
    options => { options.guessed = true; },
  ]) {
    const changed = structuredClone(pack); edit(changed.drawOptions);
    assert.throws(() => assertProcessedPack(changed), /draw|prices/);
  }
  for (const count of [0, -1, 11.5, '150', null]) assert.throws(() => createDrawOptions(count), /total player count/);
});

test('explicit legacy metadata migration preserves members, players, history and archive classification; replay is a no-op', () => {
  const input = fixture(11);
  const first = reconcileCatalog(input).state;
  const ended = reconcileCatalog({ ...input, state: first, candidates: [], officialObservation: null, now: '2026-11-02T02:00:00.000Z' }).state;
  for (const key of ['packs', 'archive']) for (const pack of ended[key]) delete pack.drawOptions;
  const original = structuredClone(ended);
  assert.doesNotThrow(() => generatePublication({ state: ended }), 'legacy immutable publications remain readable');
  const migrated = enrichPackDrawOptions(ended, '2026-11-02T03:00:00.000Z');
  assert.equal(migrated.changed, true);
  assert.deepEqual(migrated.changes.map(change => change.targetFile), ['processed/packs.json', 'archive.json']);
  assert.deepEqual(migrated.state.players, original.players);
  assert.deepEqual(migrated.state.rawUpdates, original.rawUpdates);
  assert.deepEqual(migrated.state.observations, original.observations);
  assert.deepEqual(migrated.state.packs[0].members, original.packs[0].members);
  assert.equal(migrated.state.archive[0].archivedAt, original.archive[0].archivedAt);
  assert.deepEqual(ended, original, 'migration is pure');
  assert.ok(migrated.changes.every(change => change.added.length === 0 && change.removed.length === 0 && change.updated.length === 1));
  const publication = generatePublication({ state: migrated.state });
  for (const record of publication.records.filter(record => record.kind !== 'player')) assert.deepEqual(record.payload.drawOptions, migrated.state.packs[0].drawOptions);
  const replay = enrichPackDrawOptions(migrated.state, '2026-11-02T04:00:00.000Z');
  assert.equal(replay.changed, false); assert.deepEqual(replay.changes, []); assert.deepEqual(replay.state, migrated.state);
});


test('exact T040 null-price publications remain readable; reviewed migration replaces prices throughout active and archived packs', () => {
  for (const archived of [false, true]) {
    const input = fixture(150);
    let state = reconcileCatalog(input).state;
    if (archived) state = reconcileCatalog({ ...input, state, candidates: [], officialObservation: null, now: '2026-11-02T02:00:00.000Z' }).state;
    for (const key of ['packs', 'active', 'archive']) for (const pack of state[key]) {
      pack.drawOptions.single.coinCost = null;
      pack.drawOptions.ten.coinCost = null;
      pack.drawOptions.provenance.reference = 'T040';
    }
    const original = structuredClone(state);
    assert.doesNotThrow(() => generatePublication({ state }), 'retained null-price publication is readable');
    const migrated = enrichPackDrawOptions(state, '2026-11-02T03:00:00.000Z');
    assert.equal(migrated.changed, true);
    assert.deepEqual(migrated.changes.map(change => change.targetFile), ['processed/packs.json', archived ? 'archive.json' : 'live.json']);
    assert.deepEqual(migrated.state.players, original.players);
    for (const key of ['packs', 'active', 'archive']) for (let i = 0; i < migrated.state[key].length; i++) {
      const pack = migrated.state[key][i];
      assert.equal(pack.drawOptions.single.coinCost, 100);
      assert.equal(pack.drawOptions.ten.coinCost, 900);
      assert.equal(pack.drawOptions.provenance.reference, 'T042');
      const { drawOptions: ignored, ...unchanged } = pack;
      const { drawOptions: ignoredOld, ...previous } = original[key][i];
      assert.deepEqual(unchanged, previous, 'price migration preserves members, type metadata, archive transition and sale identity');
    }
    assert.deepEqual(state, original, 'retained generation is not mutated');
    assert.equal(enrichPackDrawOptions(migrated.state, '2026-11-02T04:00:00.000Z').changed, false);
    const bad = structuredClone(state.packs[0]); bad.drawOptions.single.coinCost = 100;
    assert.throws(() => assertProcessedPack(bad), 'mixed legacy/current prices are rejected');
  }
});
