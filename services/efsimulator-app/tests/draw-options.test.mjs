import test from 'node:test';
import assert from 'node:assert/strict';
import { canDrawCount, drawCostLabel, readDrawOptions } from '../lib/draw-options.mjs';

const pack = (ten, totalPlayerCount = 11) => ({ totalPlayerCount, drawOptions: {
  single: { supported: true, count: 1, coinCost: null },
  ten: { supported: ten, count: 10, coinCost: null, minimumRemaining: 10 },
  provenance: { authority: 'direct_user_confirmation', reference: 'T040', rule: 'total_player_count_gt_11' },
} });

test('support follows published options rather than titles, special count, or inferred N', () => {
  assert.equal(canDrawCount({ ...pack(false, 150), name: 'Epic', playerCount: 3 }, 10, 150), false);
  assert.equal(canDrawCount(pack(true, 11), 10, 11), true);
  assert.equal(canDrawCount(pack(false), 1, 1), true);
});

test('ten draws require ten remaining and cannot cross into a new round', () => {
  for (const remaining of [0, 1, 9]) assert.equal(canDrawCount(pack(true, 150), 10, remaining), false);
  assert.equal(canDrawCount(pack(true, 150), 10, 10), true);
  assert.equal(canDrawCount(pack(true, 150), 1, 0), false);
  assert.equal(canDrawCount(pack(true), 9, 11), false);
  assert.equal(canDrawCount(pack(true), 10, 10.5), false);
});

test('missing and malformed metadata stay unknown without blocking old catalog display', () => {
  assert.equal(readDrawOptions({ totalPlayerCount: 150 }), null);
  for (const update of [
    value => { value.ten.supported = 'true'; },
    value => { value.ten.minimumRemaining = 1; },
    value => { value.single.coinCost = -1; },
    value => { delete value.ten.coinCost; },
    value => { delete value.provenance; },
  ]) {
    const value = pack(true); update(value.drawOptions);
    assert.equal(readDrawOptions(value), null);
    assert.equal(canDrawCount(value, 1, 150), false);
  }
});

test('unknown, free, regular, and discounted costs remain distinct', () => {
  assert.equal(drawCostLabel(null), '비용 확인 중');
  assert.equal(drawCostLabel(0), '0 코인');
  assert.equal(drawCostLabel(100), '100 코인');
  assert.equal(drawCostLabel(500), '500 코인');
  assert.equal(drawCostLabel(900), '900 코인');
});
