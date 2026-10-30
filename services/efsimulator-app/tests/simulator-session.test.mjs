import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSimulatorPack } from '../lib/simulator/prepare.mjs';
import { createSimulatorSession, applySimulatorCommand, validateSimulatorSession, poolFingerprint, SIMULATOR_POLICY_VERSION } from '../lib/simulator/session.mjs';

const NOW = '2026-10-30T05:00:00.000Z';
const NEVER = () => { throw new Error('Entropy must not be consumed here'); };
function fixture({ total = 12, types = [5, 6, 777], sessionId = 'test-session' } = {}) {
  const players = types.map((playerType, index) => ({ id: String(index + 1), name: `Player ${index + 1}`, slug: `player-${index + 1}`, position: 'CF', overallRating: 85, playingStyle: null, playingStyleDefensive: null, imageUrl: `https://efimg.com/${index + 1}.png`, playerType }));
  const pack = { saleId: 'sale-1', name: 'Pack', officialTitle: 'Official Pack', totalPlayerCount: total, playerCount: players.length, standardPlayerCount: total - players.length,
    members: players.map(({ id, name }) => ({ id, name })), players,
    drawOptions: { single: { supported: true, count: 1, coinCost: 100 }, ten: { supported: total > 11, count: 10, coinCost: 900, minimumRemaining: 10 }, provenance: { authority: 'direct_user_confirmation', reference: 'T042', rule: 'total_player_count_gt_11' } } };
  const catalog = { manifest: { version_id: 'publication-1' }, live: [pack], archive: [], players };
  const preparation = prepareSimulatorPack({ saleId: pack.saleId, catalog });
  return { pack, preparation, session: createSimulatorSession({ preparation, pack, sessionId, now: NOW }) };
}
const draw = (session, id, count = 1, randomInt = () => 0) => applySimulatorCommand(session, { id, type: 'draw', count, expectedRevision: session.revision }, { randomInt, now: NOW });
const acknowledge = (session, id) => applySimulatorCommand(session, { id, type: 'acknowledge', batchId: session.pendingBatchId, expectedRevision: session.revision }, { randomInt: NEVER, now: NOW });
const reset = (session, id) => applySimulatorCommand(session, { id, type: 'reset', expectedRevision: session.revision }, { randomInt: NEVER, now: NOW });
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

test('creation captures one prepared snapshot with all grades and immutable initial totals', () => {
  const { pack, preparation, session } = fixture();
  assert.equal(session.schemaVersion, 1); assert.equal(session.policyVersion, SIMULATOR_POLICY_VERSION);
  assert.equal(session.revision, 0); assert.deepEqual(session.commands, []); assert.equal(session.pendingBatchId, null);
  assert.deepEqual(session.initial, { totalPlayerCount: 12, specialPlayerCount: 3, standardPlayerCount: 9 });
  assert.deepEqual(session.activeRound.remainingSpecialIds, ['1', '2', '3']);
  assert.equal(session.activeRound.remainingStandardCount, 9);
  assert.deepEqual(session.totals, { drawCount: 0, coinCost: 0 });
  assert.notEqual(session.snapshot.players, pack.players);
  assert.notEqual(session.snapshot.drawOptions, pack.drawOptions);
  const changedPreparation = { ...preparation, counts: { ...preparation.counts, specialPlayerCount: 1 } };
  assert.throws(() => createSimulatorSession({ preparation: changedPreparation, pack, sessionId: 'new', now: NOW }), error => error.code === 'PREPARATION_REQUIRED');
});

test('probability fingerprint ignores display order/name/type and publication but detects exact IDs/N/sale round', () => {
  const { pack } = fixture(); const initial = poolFingerprint(pack);
  const display = structuredClone(pack); display.name = 'New title'; display.officialTitle = 'New title'; display.players.reverse(); display.members.reverse();
  display.players[0].imageUrl = 'https://example.com/new.png'; display.players[0].overallRating = 99; display.players[0].playerType = 8;
  display.members[0].name = 'New name'; display.date = '2027-01-01'; display.endsAt = '2027-02-01T00:00:00Z';
  assert.equal(poolFingerprint(display), initial);
  for (const change of [value => { value.saleId = 'new-round'; }, value => { value.totalPlayerCount += 1; }, value => { value.members[0].id = '900'; }]) {
    const next = structuredClone(pack); change(next); assert.notEqual(poolFingerprint(next), initial);
  }
  const malformed = structuredClone(pack); malformed.drawOptions.ten.coinCost = 500;
  assert.throws(() => poolFingerprint(malformed), error => error.code === 'INVALID_PACK');
});

test('draw stores before reveal, acknowledge/skip never rerolls, and retry IDs precede revision validation', () => {
  const initial = freeze(fixture().session);
  const first = draw(initial, 'draw-a');
  assert.equal(initial.revision, 0); assert.equal(first.revision, 1); assert.equal(first.pendingBatchId, first.batches[0].id);
  assert.deepEqual(first.batches[0].results, [{ kind: 'special', cardId: '1' }]);
  assert.equal(first.batches[0].acknowledged, false); assert.deepEqual(first.totals, { drawCount: 1, coinCost: 100 });
  const retry = applySimulatorCommand(first, { id: 'draw-a', type: 'draw', count: 1, expectedRevision: 0 }, { randomInt: NEVER, now: 'invalid' });
  assert.equal(retry, first);
  const revealed = acknowledge(first, 'ack-a');
  assert.equal(revealed.revision, 2); assert.equal(revealed.pendingBatchId, null); assert.equal(revealed.batches[0].acknowledged, true);
  assert.deepEqual(revealed.totals, first.totals); assert.deepEqual(revealed.batches[0].results, first.batches[0].results);
  assert.equal(applySimulatorCommand(revealed, { id: 'ack-a', type: 'acknowledge', batchId: revealed.batches[0].id, expectedRevision: 1 }, { randomInt: NEVER }), revealed);
  assert.throws(() => applySimulatorCommand(revealed, { id: 'draw-a', type: 'reset', expectedRevision: revealed.revision }), error => error.code === 'COMMAND_ID_CONFLICT');
});

test('pending reveal prevents extra draw/reset and wrong acknowledgements without consuming entropy', () => {
  const pending = draw(fixture().session, 'first');
  for (const command of [{ id: 'second', type: 'draw', count: 1 }, { id: 'reset', type: 'reset' }]) {
    assert.throws(() => applySimulatorCommand(pending, { ...command, expectedRevision: pending.revision }, { randomInt: NEVER, now: NOW }), error => error.code === 'PENDING_BATCH');
  }
  assert.throws(() => applySimulatorCommand(pending, { id: 'bad-ack', type: 'acknowledge', batchId: 'another-batch', expectedRevision: pending.revision }, { randomInt: NEVER, now: NOW }), error => error.code === 'BATCH_NOT_PENDING');
});

test('ten consumes exactly ten from one round for900; last single closes round and prepares full next round atomically', () => {
  let session = draw(fixture().session, 'ten', 10);
  assert.deepEqual(session.batches[0].results.slice(0, 3).map(card => card.cardId), ['1', '2', '3']);
  assert.equal(session.batches[0].results.filter(card => card.kind === 'standard').length, 7);
  assert.deepEqual(session.totals, { drawCount: 10, coinCost: 900 });
  session = acknowledge(session, 'ten-ack');
  assert.throws(() => draw(session, 'too-few', 10, NEVER), error => error.code === 'INSUFFICIENT_REMAINING');
  session = acknowledge(draw(session, 'eleven'), 'eleven-ack');
  session = draw(session, 'twelve');
  assert.equal(session.activeRound.number, 2); assert.equal(session.activeRound.drawCount, 0);
  assert.deepEqual(session.activeRound.remainingSpecialIds, ['1', '2', '3']); assert.equal(session.activeRound.remainingStandardCount, 9);
  assert.equal(session.rounds.length, 1); assert.equal(session.rounds[0].drawCount, 12); assert.equal(session.rounds[0].remainingStandardCount, 0);
  assert.equal(session.resets[0].reason, 'exhausted'); assert.equal(session.pendingBatchId, session.batches[2].id);
  assert.deepEqual(session.totals, { drawCount: 12, coinCost: 1100 });
  const last = session.batches[2]; session = acknowledge(session, 'last-ack');
  assert.deepEqual(session.batches[2].results, last.results);
  session = draw(session, 'new-round');
  assert.deepEqual(session.batches.at(-1).results, [{ kind: 'special', cardId: '1' }]);
  assert.equal(session.batches.at(-1).roundNumber, 2);
});

test('remaining exactly10 supports one full ten batch and crosses no round inside that batch', () => {
  let session = fixture().session;
  for (let index = 0; index < 2; index++) session = acknowledge(draw(session, `single-${index}`), `ack-${index}`);
  assert.equal(session.activeRound.remainingSpecialIds.length + session.activeRound.remainingStandardCount, 10);
  session = draw(session, 'exact-ten', 10);
  assert.equal(session.batches.at(-1).roundNumber, 1); assert.equal(session.batches.at(-1).results.length, 10);
  assert.equal(session.activeRound.number, 2); assert.equal(session.rounds[0].drawCount, 12);
  assert.deepEqual(session.totals, { drawCount: 12, coinCost: 1100 });
});

test('single-only11 refuses ten before entropy; remaining1..9 in supported pack refuse partial batches', () => {
  assert.throws(() => draw(fixture({ total: 11 }).session, 'bad-ten', 10, NEVER), error => error.code === 'MODE_UNSUPPORTED');
  let session = fixture().session;
  for (let drawn = 0; drawn < 11; drawn++) {
    const remaining = 12 - drawn;
    if (remaining < 10) assert.throws(() => draw(session, `bad-ten-${remaining}`, 10, NEVER), error => error.code === 'INSUFFICIENT_REMAINING');
    session = acknowledge(draw(session, `draw-${drawn}`), `ack-${drawn}`);
  }
});

test('manual reset preserves snapshots, all results and cumulative usage while restoring only the selected pool', () => {
  const initial = fixture().session;
  const progressed = acknowledge(draw(initial, 'first'), 'first-ack');
  const next = reset(freeze(progressed), 'manual');
  assert.equal(next.activeRound.number, 2); assert.equal(next.activeRound.drawCount, 0); assert.equal(next.rounds[0].reason, 'manual');
  assert.deepEqual(next.totals, progressed.totals); assert.deepEqual(next.batches, progressed.batches); assert.deepEqual(next.snapshot, progressed.snapshot);
  assert.equal(next.resets[0].reason, 'manual'); assert.equal(next.rounds[0].remainingSpecialIds.length, 2);
  const emptyReset = reset(next, 'another-manual');
  assert.equal(emptyReset.activeRound.number, 3); assert.deepEqual(emptyReset.totals, next.totals);
});

test('a stale concurrent command fails before entropy while saved retry returns the latest session', () => {
  const initial = fixture().session; const first = draw(initial, 'winner');
  assert.throws(() => applySimulatorCommand(first, { id: 'loser', type: 'draw', count: 1, expectedRevision: 0 }, { randomInt: NEVER, now: NOW }), error => error.code === 'REVISION_CONFLICT');
  const acknowledged = acknowledge(first, 'winner-ack');
  assert.equal(applySimulatorCommand(acknowledged, { id: 'winner', type: 'draw', count: 1, expectedRevision: 0 }, { randomInt: NEVER }), acknowledged);
});

test('N=1, A=0 and S=0 complete without recursion or invented Standard IDs', () => {
  for (const options of [{ total: 1, types: [777] }, { total: 3, types: [5, 6, 8] }, { total: 1, types: [] }]) {
    let session = fixture(options).session;
    for (let index = 0; index < options.total; index++) session = acknowledge(draw(session, `draw-${index}`), `ack-${index}`);
    assert.equal(session.activeRound.number, 2); assert.equal(session.rounds[0].drawCount, options.total);
    assert.deepEqual(session.initial, fixture(options).session.initial);
    if (!options.types.length) assert.deepEqual(session.batches[0].results, [{ kind: 'standard' }]);
  }
});

test('malformed stored state, duplicate special results and partial updates are rejected without silent reset', () => {
  const base = acknowledge(draw(fixture().session, 'first'), 'first-ack');
  for (const mutate of [
    value => { value.schemaVersion = 2; }, value => { value.totals.coinCost += 1; },
    value => { value.activeRound.remainingSpecialIds.push('1'); }, value => { value.activeRound.remainingStandardCount -= 1; },
    value => { value.revision += 1; }, value => { value.batches[0].results[0].cardId = '404'; },
    value => { value.batches[0].acknowledged = false; }, value => { value.pendingBatchId = value.batches[0].id; },
    value => { value.snapshot.players[0].playerType = null; }, value => { value.snapshot.drawOptions.ten.coinCost = null; },
    value => { value.commands.push(value.commands[0]); }, value => { value.rounds.push(value); },
  ]) {
    const corrupted = structuredClone(base); mutate(corrupted);
    assert.throws(() => validateSimulatorSession(corrupted), error => error.code === 'INVALID_SESSION');
  }
  for (const input of [null, undefined, [], {}, { schemaVersion: 1 }]) assert.throws(() => validateSimulatorSession(input), error => error.code === 'INVALID_SESSION');
  const circular = structuredClone(base); circular.snapshot.players = [circular];
  assert.throws(() => validateSimulatorSession(circular), error => error.code === 'INVALID_SESSION');
  const repeatedReset = reset(reset(fixture().session, 'reset-1'), 'reset-2');
  repeatedReset.resets[1].commandId = repeatedReset.resets[0].commandId;
  repeatedReset.resets[1].id = repeatedReset.resets[0].id;
  assert.throws(() => validateSimulatorSession(repeatedReset), error => error.code === 'INVALID_SESSION');
});

test('failed entropy halfway through a ten command preserves the original complete session', () => {
  const initial = freeze(fixture().session); let calls = 0;
  assert.throws(() => draw(initial, 'bad-entropy', 10, () => ++calls < 5 ? 0 : -1), error => error.code === 'RANDOM_INVALID');
  assert.equal(calls, 5); assert.equal(initial.revision, 0); assert.deepEqual(initial.batches, []); assert.equal(initial.activeRound.remainingStandardCount, 9);
});
