import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSimulatorPack } from '../lib/simulator/prepare.mjs';

const VERSION = 'publication-test-version';
const player = (id, playerType = 5) => ({ id, name: `Player ${id}`, slug: `player-${id}`, position: 'CF', overallRating: 85, playingStyle: null, playingStyleDefensive: null, imageUrl: `https://efimg.com/${id}.png`, playerType });
function fixture({ total = 150, types = [5, 8, 3, 6], archive = false } = {}) {
  const players = types.map((type, index) => player(String(index + 1), type));
  const pack = {
    saleId: 'exact-round-20261029', name: 'Test pack', officialTitle: 'Test pack',
    playerCount: players.length, totalPlayerCount: total, standardPlayerCount: total - players.length,
    date: '2026-10-29', endsAt: '2026-11-02T01:59:59.000Z',
    members: players.map(({ id, name }) => ({ id, name })), players: structuredClone(players),
    drawOptions: {
      single: { supported: true, count: 1, coinCost: 100 },
      ten: { supported: total > 11, count: 10, coinCost: 900, minimumRemaining: 10 },
      provenance: { authority: 'direct_user_confirmation', reference: 'T042', rule: 'total_player_count_gt_11' },
    },
  };
  return { saleId: pack.saleId, catalog: { manifest: { version_id: VERSION }, live: archive ? [] : [pack], archive: archive ? [pack] : [], players } };
}
const packOf = input => [...input.catalog.live, ...input.catalog.archive][0];
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

test('one atomic snapshot prepares every verified special regardless of grade and never creates anonymous player IDs', () => {
  const input = freeze(fixture());
  const result = prepareSimulatorPack(input);
  assert.equal(result.ready, true); assert.equal(result.status, 'ready');
  assert.deepEqual(result.reasonCodes, []); assert.equal(result.publicationVersionId, VERSION);
  assert.deepEqual(result.counts, { totalPlayerCount: 150, specialPlayerCount: 4, standardPlayerCount: 146 });
  assert.deepEqual(result.specialPlayerIds, ['1', '2', '3', '4']);
  assert.deepEqual(result.supportedCounts, [1, 10]);
  assert.notEqual(result.drawOptions, packOf(input).drawOptions);
  assert.equal(input.catalog.players.length, 4);
});

test('N=1, all special A=0 and all anonymous S=0 are safe preparation boundaries', () => {
  for (const settings of [{ total: 1, types: [6] }, { total: 4, types: [5, 8, 3, 6] }, { total: 1, types: [] }]) {
    const result = prepareSimulatorPack(fixture(settings));
    assert.equal(result.ready, true);
    assert.equal(result.counts.specialPlayerCount + result.counts.standardPlayerCount, result.counts.totalPlayerCount);
    assert.deepEqual(result.supportedCounts, [1]);
  }
});

test('unknown positive integer player types remain valid and large exact string IDs keep their precision', () => {
  const input = fixture({ types: [777] });
  const id = '999999999999999999999999999999999999';
  input.catalog.players[0] = player(id, 777);
  packOf(input).players = [player(id, 777)]; packOf(input).members = [{ id, name: `Player ${id}` }];
  const result = prepareSimulatorPack(input);
  assert.equal(result.ready, true); assert.deepEqual(result.specialPlayerIds, [id]);
});

test('selection requires exact saleId, including when another round has the same title', () => {
  const input = fixture();
  assert.ok(prepareSimulatorPack({ ...input, saleId: 'different-round' }).reasonCodes.includes('sale_id_not_found'));
  for (const saleId of ['', null, 123]) assert.equal(prepareSimulatorPack({ ...input, saleId }).ready, false);
  input.catalog.archive.push(structuredClone(packOf(input)));
  assert.ok(prepareSimulatorPack(input).reasonCodes.includes('sale_id_ambiguous'));
});

test('loading, refresh errors, missing publication or incomplete collections cannot use a last-good snapshot as ready', () => {
  const good = fixture();
  assert.ok(prepareSimulatorPack({ ...good, loading: true }).reasonCodes.includes('catalog_loading'));
  assert.ok(prepareSimulatorPack({ ...good, error: 'network failure' }).reasonCodes.includes('catalog_error'));
  for (const version_id of ['', null, 42]) {
    const input = fixture(); input.catalog.manifest.version_id = version_id;
    assert.ok(prepareSimulatorPack(input).reasonCodes.includes('publication_missing'));
  }
  for (const key of ['live', 'archive', 'players']) {
    const input = fixture(); delete input.catalog[key];
    assert.ok(prepareSimulatorPack(input).reasonCodes.includes('catalog_incomplete'));
  }
  assert.equal(prepareSimulatorPack().ready, false);
});

test('unsafe N/S/A values and inconsistent subtraction are rejected before producing a pool', () => {
  for (const [key, value] of [
    ['totalPlayerCount', 0], ['totalPlayerCount', -1], ['totalPlayerCount', 150.5],
    ['totalPlayerCount', Number.MAX_SAFE_INTEGER + 1], ['totalPlayerCount', '150'],
    ['playerCount', -1], ['playerCount', 151], ['playerCount', NaN],
    ['standardPlayerCount', -1], ['standardPlayerCount', 145], ['standardPlayerCount', Infinity],
  ]) {
    const input = fixture(); packOf(input)[key] = value;
    const result = prepareSimulatorPack(input);
    assert.equal(result.ready, false); assert.ok(result.reasonCodes.includes('invalid_counts'));
    assert.deepEqual(result.specialPlayerIds, []);
  }
});

test('missing members, partial nested roster, duplicate IDs and unresolved member references cannot shrink S', () => {
  for (const mutate of [
    input => { delete packOf(input).members; },
    input => { packOf(input).members.pop(); },
    input => { packOf(input).players.pop(); },
    input => { packOf(input).members[1] = structuredClone(packOf(input).members[0]); },
    input => { packOf(input).players[1] = structuredClone(packOf(input).players[0]); },
    input => { input.catalog.players.push(structuredClone(input.catalog.players[0])); },
    input => { input.catalog.players.pop(); },
    input => { packOf(input).members[0].id = '404'; },
  ]) {
    const input = fixture(); mutate(input);
    assert.equal(prepareSimulatorPack(input).ready, false);
  }
});

test('full player/member linkage rejects matching IDs with different names or snapshot fields', () => {
  for (const mutate of [
    input => { packOf(input).members[0].name = 'Wrong name'; },
    input => { packOf(input).players[0].name = 'Wrong name'; },
    input => { packOf(input).players[0].overallRating += 1; },
    input => { packOf(input).players[0].playerType = 8; },
    input => { packOf(input).players[0].imageUrl = 'https://example.com/other.png'; },
    input => { packOf(input).members[0].id = 1; },
  ]) {
    const input = fixture(); mutate(input);
    const result = prepareSimulatorPack(input);
    assert.equal(result.ready, false); assert.ok(result.reasonCodes.includes('membership_mismatch'));
  }
});

test('missing/invalid types block current preparation while valid unknown types do not', () => {
  for (const playerType of [undefined, null, 0, -1, 5.5, '5', Number.MAX_SAFE_INTEGER + 1]) {
    const input = fixture();
    input.catalog.players[0].playerType = playerType; packOf(input).players[0].playerType = playerType;
    assert.ok(prepareSimulatorPack(input).reasonCodes.includes('invalid_player_type'));
  }
});

test('malformed current player fields are rejected, including unrelated duplicate or malformed catalog rows', () => {
  for (const mutate of [
    p => { delete p.playingStyle; }, p => { p.overallRating = '85'; }, p => { p.overallRating = 201; },
    p => { p.position = null; }, p => { p.imageUrl = 'http://efimg.com/1.png'; }, p => { p.id = 'not-decimal'; },
    p => { p.fabricated = true; },
  ]) {
    const input = fixture(); const unrelated = player('900', 777); mutate(unrelated); input.catalog.players.push(unrelated);
    assert.ok(prepareSimulatorPack(input).reasonCodes.includes('invalid_player'));
  }
});

test('ready options require current published support, exact 100/900 prices and T042 provenance', () => {
  for (const mutate of [
    p => { delete p.drawOptions; }, p => { p.drawOptions.single.coinCost = null; },
    p => { p.drawOptions.ten.coinCost = 500; }, p => { p.drawOptions.ten.minimumRemaining = 1; },
    p => { p.drawOptions.provenance.reference = 'T040'; }, p => { p.drawOptions.ten.supported = false; },
    p => { p.drawOptions.single.supported = false; }, p => { p.drawOptions.single.coinCost = '100'; },
    p => { p.drawOptions.extra = true; },
  ]) {
    const input = fixture(); mutate(packOf(input)); assert.equal(prepareSimulatorPack(input).ready, false);
  }
  const eleven = fixture({ total: 11 });
  assert.deepEqual(prepareSimulatorPack(eleven).supportedCounts, [1]);
  packOf(eleven).drawOptions.ten.supported = true;
  assert.equal(prepareSimulatorPack(eleven).ready, false);
  assert.deepEqual(prepareSimulatorPack(fixture({ total: 12 })).supportedCounts, [1, 10]);
});

test('archive preparation uses its complete frozen snapshot without inventing freshness from dates or polling', () => {
  const input = fixture({ archive: true });
  input.catalog.manifest.created_at = '2000-01-01T00:00:00.000Z';
  packOf(input).endsAt = '2000-01-01T00:00:00.000Z';
  assert.equal(prepareSimulatorPack(freeze(input)).ready, true);
  assert.equal(packOf(input).endsAt, '2000-01-01T00:00:00.000Z');
});
