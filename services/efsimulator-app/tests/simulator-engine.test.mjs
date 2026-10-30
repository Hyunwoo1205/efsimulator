import test from 'node:test';
import assert from 'node:assert/strict';
import { drawFromPool, validateRemainingPool } from '../lib/simulator/engine.mjs';

test('each slot has equal representation and anonymous group consumes its actual count', () => {
  const pool = { remainingSpecialIds: ['1', '2'], remainingStandardCount: 8 };
  const counts = { special: 0, standard: 0 };
  for (let slot = 0; slot < 10; slot++) {
    const result = drawFromPool(pool, 1, { randomInt: max => { assert.equal(max, 10); return slot; } });
    const card = result.results[0]; counts[card.kind] += 1;
    if (card.kind === 'special') assert.equal(card.cardId, pool.remainingSpecialIds[slot]);
    else assert.deepEqual(card, { kind: 'standard' });
    assert.equal(validateRemainingPool(result), 9);
  }
  assert.deepEqual(counts, { special: 2, standard: 8 });
  assert.deepEqual(pool, { remainingSpecialIds: ['1', '2'], remainingStandardCount: 8 });
});

test('a multi draw uses decreasing bounds and removes every drawn special once', () => {
  const seen = [];
  const original = { remainingSpecialIds: ['99999999999999999999999999', '2'], remainingStandardCount: 10 };
  const first = drawFromPool(original, 10, { randomInt: max => { seen.push(max); return 0; } });
  assert.deepEqual(seen, [12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  assert.deepEqual(first.results.slice(0, 2), original.remainingSpecialIds.map(cardId => ({ kind: 'special', cardId })));
  assert.equal(first.results.filter(card => card.kind === 'standard').length, 8);
  assert.deepEqual(first.remainingSpecialIds, []); assert.equal(first.remainingStandardCount, 2);
  assert.equal(original.remainingSpecialIds.length, 2);
});

test('single remaining slot, all special and all anonymous pools exhaust without recursion', () => {
  for (const pool of [
    { remainingSpecialIds: ['1'], remainingStandardCount: 0 },
    { remainingSpecialIds: ['1', '2', '3'], remainingStandardCount: 0 },
    { remainingSpecialIds: [], remainingStandardCount: 3 },
  ]) {
    const count = validateRemainingPool(pool);
    const result = drawFromPool(pool, count, { randomInt: max => max - 1 });
    assert.equal(validateRemainingPool(result), 0); assert.equal(result.results.length, count);
  }
});

test('invalid pools/counts fail before consuming entropy; no partial draw or implicit rollover', () => {
  let calls = 0; const randomInt = () => { calls++; return 0; };
  for (const pool of [null, {}, { remainingSpecialIds: ['1', '1'], remainingStandardCount: 0 },
    { remainingSpecialIds: [1], remainingStandardCount: 0 }, { remainingSpecialIds: [], remainingStandardCount: -1 },
    { remainingSpecialIds: [], remainingStandardCount: 0.1 }, { remainingSpecialIds: ['1'], remainingStandardCount: Number.MAX_SAFE_INTEGER }]) {
    assert.throws(() => drawFromPool(pool, 1, { randomInt }), error => error.code === 'INVALID_POOL');
  }
  const pool = { remainingSpecialIds: ['1'], remainingStandardCount: 0 };
  for (const count of [0, -1, 1.5, '1', null]) assert.throws(() => drawFromPool(pool, count, { randomInt }), error => error.code === 'INVALID_DRAW_COUNT');
  assert.throws(() => drawFromPool(pool, 10, { randomInt }), error => error.code === 'INSUFFICIENT_REMAINING');
  assert.equal(calls, 0);
});

test('bad injected entropy never mutates the source pool or fabricates a result', () => {
  const pool = { remainingSpecialIds: ['1'], remainingStandardCount: 2 };
  for (const slot of [-1, 3, NaN, 0.5, '0', null]) {
    assert.throws(() => drawFromPool(pool, 1, { randomInt: () => slot }), error => error.code === 'RANDOM_INVALID');
  }
  assert.deepEqual(pool, { remainingSpecialIds: ['1'], remainingStandardCount: 2 });
});
