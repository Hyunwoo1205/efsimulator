import test from 'node:test';
import assert from 'node:assert/strict';
import { orderSimulatorResults } from '../lib/simulator/result-order.mjs';

const player = (id, playerType, overallRating = 90) => ({ id, name: 'Same name', playerType, overallRating });
const special = cardId => ({ kind: 'special', cardId });
const standard = () => ({ kind: 'standard' });
const ids = entries => entries.map(({ result }) => result.kind === 'special' ? result.cardId : 'standard');
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

test('result cards follow exact API grade then OVR and put anonymous Standards last', () => {
  const players = [player('highlight', 6, 120), player('epic-low', 5, 80), player('show', 8, 100),
    player('trend', 3, 110), player('epic-high', 5, 99), player('unknown', 777, 150)];
  const results = [standard(), special('highlight'), special('unknown'), special('trend'), special('epic-low'), standard(), special('show'), special('epic-high')];
  assert.deepEqual(ids(orderSimulatorResults(results, players)), ['epic-high', 'epic-low', 'show', 'trend', 'highlight', 'unknown', 'standard', 'standard']);
});

test('same-grade OVR beats acquisition order, missing OVR follows known values, exact IDs break ties', () => {
  const players = [player('9007199254740993', 5, 88), player('missing', 5, null), player('top', 5, 99),
    player('9007199254740992', 5, 88), player('invalid', 5, NaN), player('show', 8, 150)];
  const results = players.map(value => special(value.id));
  assert.deepEqual(ids(orderSimulatorResults(results, players)), ['top', '9007199254740992', '9007199254740993', 'invalid', 'missing', 'show']);
});

test('all anonymous results retain their multiplicity, original references and acquisition indexes', () => {
  const results = freeze(Array.from({ length: 10 }, standard));
  const ordered = orderSimulatorResults(results, []);
  assert.notEqual(ordered, results);
  assert.equal(ordered.length, 10);
  ordered.forEach((entry, index) => {
    assert.equal(entry.result, results[index]);
    assert.equal(entry.acquisitionIndex, index);
    assert.equal(entry.player, undefined);
    assert.deepEqual(Object.keys(entry.result), ['kind']);
  });
});

test('presentation cannot rewrite a frozen committed batch or its surrounding session ledger', () => {
  const players = freeze([player('low', 5, 80), player('high', 5, 99)]);
  const session = freeze({ revision: 7, pendingBatchId: 'batch', totals: { drawCount: 10, coinCost: 900 },
    batches: [{ id: 'batch', commandId: 'draw', count: 10, coinCost: 900, acknowledged: false,
      results: [standard(), special('low'), ...Array.from({ length: 7 }, standard), special('high')] }] });
  const before = JSON.stringify({ session, players });
  const results = session.batches[0].results;
  const first = orderSimulatorResults(results, players);
  const replay = orderSimulatorResults(results, players);
  assert.deepEqual(ids(first), ['high', 'low', ...Array(8).fill('standard')]);
  assert.deepEqual(first.map(entry => entry.acquisitionIndex), [9, 1, 0, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(replay, first);
  first.forEach(entry => assert.equal(entry.result, results[entry.acquisitionIndex]));
  assert.equal(JSON.stringify({ session, players }), before);
});

test('unresolved special metadata stays a distinct special entry before Standards', () => {
  const results = [standard(), special('z-missing'), special('unknown'), special('a-missing'), special('epic')];
  const entries = orderSimulatorResults(results, [player('epic', 5), player('unknown', 999, 120)]);
  assert.deepEqual(ids(entries), ['epic', 'unknown', 'a-missing', 'z-missing', 'standard']);
  assert.equal(entries[2].player, undefined);
  assert.equal(entries[2].result.kind, 'special');
  assert.equal(entries.length, results.length);
});

test('empty and single batches remain representable without changing player or result objects', () => {
  const known = freeze(player('one', 8, 88));
  assert.deepEqual(orderSimulatorResults([], [known]), []);
  const result = freeze(special('one'));
  const [entry] = orderSimulatorResults([result], [known]);
  assert.equal(entry.result, result);
  assert.equal(entry.player, known);
  assert.equal(entry.acquisitionIndex, 0);
});
