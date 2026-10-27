import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_FILES, PLAYER_FIELDS, createLifecycleState, planRawAppend, projectPlayer, reconcileCatalog, validateLifecycleState } from '../lib/catalog-lifecycle.mjs';

const NOW = '2026-10-27T01:00:00.000Z';
const END = '2026-11-02T01:59:59.000Z';
const card = (id, values = {}) => ({
  id, name: `Player ${id}`, nameJa: 'unneeded', nameZh: 'unneeded', nationality: '', nationalityCode: '', team: '', slug: `player-${id}`, position: 'CF',
  overallRating: 85, imageUrl: `https://example.com/card/${id}.png`, playerType: 5,
  ...values,
});
const pack = (slug = 'italian-attackers', count = 2) => ({ name: 'Italian attackers', slug, date: '2026-10-26', playerCount: count });
function fixture() {
  const rawPlayers = [card('88046292831684'), card('105896445274201')];
  const rawPacks = [pack()];
  const candidate = {
    saleId: 'italian-attackers-20261026', packSlug: rawPacks[0].slug,
    officialTitle: 'Epic: Italian League Attackers', totalPlayerCount: 150,
    endsAt: END, memberIds: rawPlayers.map(player => player.id), expectedSpecialCount: 2,
    membershipComplete: true, matchVerified: true,
    evidence: { efhub: { url: 'https://efhub.com/new-players', sha256: 'html-hash' }, matching: 'same_round_explicit_card_ids' },
  };
  const officialObservation = { status: 'ok', complete: true, observedAt: NOW, sha256: 'official-hash', rows: [
    { title: candidate.officialTitle, totalPlayerCount: 150, endsAt: END },
  ] };
  return { rawPlayers, rawPacks, candidate, candidates: [candidate], officialObservation, now: NOW };
}
const ingest = values => reconcileCatalog(values ?? fixture());

test('player projection has exactly the requested eight fields and keeps string precision', () => {
  const player = projectPlayer(card('999999999999999999999999999999', { playingStyle: 'Goal Poacher' }));
  assert.deepEqual(Object.keys(player), PLAYER_FIELDS);
  assert.equal(player.id, '999999999999999999999999999999');
  assert.equal(player.playingStyle, 'Goal Poacher');
  assert.equal(player.playingStyleDefensive, null);
  assert.equal('nameJa' in player, false);
  assert.equal('members' in player, false);
  assert.throws(() => projectPlayer(card(123)), /decimal string/);
});

test('one complete generation embeds every pack field and full player objects with consistent unions', () => {
  const inputs = fixture(); const frozen = JSON.stringify(inputs);
  const result = ingest(inputs);
  assert.equal(JSON.stringify(inputs), frozen, 'pure reconciliation must not mutate source inputs');
  assert.deepEqual(result.invariants, { packs: 1, players: 2, active: 1, archive: 0, orphanPlayers: 0 });
  const { players, ...embeddedPack } = result.state.active[0];
  assert.deepEqual(embeddedPack, result.state.packs[0]);
  assert.deepEqual(players, result.state.players);
  assert.equal(result.state.packs[0].standardPlayerCount, 148);
  assert.equal(result.state.players.some(player => player.id.startsWith('standard')), false);
  assert.deepEqual(new Set(result.changes.map(change => change.targetFile)), new Set([CATALOG_FILES.players, CATALOG_FILES.packs, CATALOG_FILES.active]));
  assert.ok(result.changes.every(change => change.beforeCount === 0 && change.added.length > 0));
});

test('raw special count errors need explicit correction and preserve source/effective counts separately', () => {
  const f = fixture();
  f.rawPlayers = Array.from({ length: 11 }, (_, index) => card(`${index + 1}`));
  f.rawPacks[0].playerCount = 8;
  f.candidate.memberIds = f.rawPlayers.map(player => player.id);
  f.candidate.expectedSpecialCount = 11;
  const blocked = ingest(f);
  assert.equal(blocked.pending[0].reason, 'count_correction_unverified');
  assert.equal(blocked.state.packs.length, 0);
  f.candidate.countCorrection = { status: 'user_confirmed', reason: 'Source pack card count omitted three epic cards; 11 explicit IDs confirmed.' };
  const result = ingest(f);
  const saved = result.state.packs[0];
  assert.equal(saved.sourceReportedPlayerCount, 8);
  assert.equal(saved.playerCount, 11);
  assert.equal(saved.totalPlayerCount, 150);
  assert.equal(saved.standardPlayerCount, 139);
  assert.equal(f.rawPacks[0].playerCount, 8, 'source value must never be silently edited');
});

test('cross-source and complete-special gates reject one-sided, missing-card and duplicate rosters atomically', () => {
  for (const [edit, reason] of [
    [f => { f.candidate.matchVerified = false; }, 'cross_source_match_unverified'],
    [f => { f.candidate.membershipComplete = false; }, 'special_membership_incomplete'],
    [f => { f.candidate.officialTitle = 'Unlisted product'; }, 'official_product_not_matched'],
    [f => { f.candidate.memberIds[1] = '404'; }, 'raw_player_missing:404'],
    [f => { f.candidate.memberIds[1] = f.candidate.memberIds[0]; }, 'duplicate_member_ids'],
    [f => { f.candidate.totalPlayerCount = 1; f.officialObservation.rows[0].totalPlayerCount = 1; }, 'special_count_exceeds_total'],
  ]) {
    const f = fixture(); edit(f);
    const result = ingest(f);
    assert.equal(result.pending[0].reason, reason);
    assert.equal(result.state.players.length, 0);
    assert.equal(result.state.packs.length, 0);
    assert.equal(result.state.updates.length, 0);
  }
});

test('expired products move intact to archive even when the latest observation fails', () => {
  const f = fixture(); const initial = ingest(f);
  const ended = ingest({ ...f, state: initial.state, candidates: [], officialObservation: { status: 'error', complete: false }, now: '2026-11-02T02:00:00Z' });
  assert.equal(ended.state.active.length, 0);
  assert.equal(ended.state.archive.length, 1);
  assert.equal(ended.state.archive[0].archiveReason, 'ended');
  assert.deepEqual(ended.state.archive[0].players, initial.state.active[0].players);
  assert.deepEqual(ended.state.packs, initial.state.packs);
  assert.deepEqual(ended.state.players, initial.state.players);
  assert.deepEqual(ended.changes.map(change => change.targetFile), ['live.json', 'archive.json']);
  assert.deepEqual(ended.transitions, [{ saleId: f.candidate.saleId, action: 'archived', reason: 'ended' }]);
  const exactEnd = ingest({ ...f, state: initial.state, candidates: [], officialObservation: null, now: END });
  assert.equal(exactEnd.state.archive.length, 1);
});

test('stale, empty, partial, ambiguous or failed official responses cannot clear a future live product', () => {
  const f = fixture(); const initial = ingest(f);
  const observations = [
    null,
    { ...f.officialObservation, rows: [] },
    { ...f.officialObservation, complete: false },
    { ...f.officialObservation, observedAt: '2026-10-26T01:00:00Z' },
    { ...f.officialObservation, rows: [...f.officialObservation.rows, ...f.officialObservation.rows] },
    { ...f.officialObservation, rows: [{ title: 'Malformed product' }] },
  ];
  for (const officialObservation of observations) {
    const result = ingest({ ...f, state: initial.state, candidates: [], officialObservation });
    assert.equal(result.state.active.length, 1);
    assert.equal(result.state.archive.length, 0);
    assert.equal(result.changes.length, 0);
    assert.equal(result.officialUsable, false);
  }
});

test('fresh complete absence archives, while a conflicting same-title observation waits for verification', () => {
  const f = fixture(); const initial = ingest(f);
  const absent = { ...f.officialObservation, rows: [{ title: 'Other current pack', totalPlayerCount: 11, endsAt: END }] };
  const result = ingest({ ...f, state: initial.state, candidates: [], officialObservation: absent });
  assert.equal(result.state.archive[0].archiveReason, 'official_removed');
  const changed = { ...f.officialObservation, rows: [{ ...f.officialObservation.rows[0], endsAt: '2026-11-03T01:59:59Z' }] };
  const held = ingest({ ...f, state: initial.state, candidates: [], officialObservation: changed });
  assert.equal(held.state.active.length, 1);
  assert.equal(held.state.packs[0].endsAt, END);
});

test('shared players occur once cumulatively and can be embedded simultaneously in active and archive', () => {
  const f = fixture();
  const second = { ...f.candidate, saleId: 'second-sale', packSlug: 'second-pack', officialTitle: 'Second product', memberIds: [f.rawPlayers[1].id], expectedSpecialCount: 1 };
  f.candidates.push(second);
  f.rawPacks.push(pack('second-pack', 1));
  f.officialObservation.rows.push({ title: 'Second product', totalPlayerCount: 150, endsAt: END });
  const initial = ingest(f);
  assert.equal(initial.state.players.length, 2);
  assert.equal(initial.state.active.length, 2);
  const observation = { ...f.officialObservation, rows: [f.officialObservation.rows[1]] };
  const split = ingest({ ...f, state: initial.state, candidates: [], officialObservation: observation });
  assert.equal(split.state.active.length, 1);
  assert.equal(split.state.archive.length, 1);
  const union = new Set([...split.state.active, ...split.state.archive].flatMap(p => p.players.map(player => player.id)));
  assert.deepEqual(union, new Set(split.state.players.map(player => player.id)));
  assert.equal(validateLifecycleState(split.state).orphanPlayers, 0);
});

test('replays and hourly unchanged observations do not add meaningless DB update logs', () => {
  const f = fixture(); const first = ingest(f);
  const replay = ingest({ ...f, state: first.state });
  assert.equal(replay.changes.length, 0);
  assert.deepEqual(replay.state, first.state);
  const later = '2026-10-27T02:00:00Z';
  const recheck = ingest({ ...f, state: first.state, now: later, officialObservation: { ...f.officialObservation, observedAt: later, sha256: 'same-data-new-html' } });
  assert.equal(recheck.changes.length, 0);
  assert.equal(recheck.state.updates.length, first.state.updates.length);
  assert.deepEqual(recheck.state.packs, first.state.packs);
  assert.equal(recheck.state.observations.length, 2);
});

test('verified return may reactivate an archived offering without duplicating cumulative records', () => {
  const f = fixture(); const initial = ingest(f);
  const absent = { ...f.officialObservation, rows: [{ title: 'Other product', totalPlayerCount: 11, endsAt: END }] };
  const archived = ingest({ ...f, state: initial.state, candidates: [], officialObservation: absent });
  const noProof = ingest({ ...f, state: archived.state, candidates: [] });
  assert.equal(noProof.state.archive.length, 1);
  const returned = ingest({ ...f, state: archived.state });
  assert.equal(returned.state.active.length, 1);
  assert.equal(returned.state.archive.length, 0);
  assert.equal(returned.state.players.length, 2);
  assert.equal(returned.transitions[0].action, 'reactivated');
});

test('raw append preserves original records and refuses conflicting IDs without half-appending a product', () => {
  const f = fixture();
  f.candidate.rawPlayers = [f.rawPlayers[1]];
  f.candidate.rawPack = f.rawPacks[0];
  const planned = planRawAppend({ ...f, rawPlayers: [f.rawPlayers[0]], rawPacks: [] });
  assert.deepEqual(planned.rawPlayers, f.rawPlayers);
  assert.deepEqual(planned.addedPlayers, [f.rawPlayers[1]]);
  assert.deepEqual(planned.addedPacks, f.rawPacks);
  const replay = planRawAppend({ ...f });
  assert.equal(replay.addedPlayers.length, 0);
  assert.equal(replay.addedPacks.length, 0);
  f.candidate.rawPlayers = [card(f.rawPlayers[0].id, { name: 'Changed source payload' }), f.rawPlayers[1]];
  const conflict = planRawAppend({ ...f, rawPlayers: [f.rawPlayers[0]], rawPacks: [] });
  assert.equal(conflict.addedPlayers.length, 0);
  assert.equal(conflict.addedPacks.length, 0);
  assert.match(conflict.pending[0].reason, /raw_player_conflict/);
  assert.deepEqual(conflict.rawPlayers, [f.rawPlayers[0]]);
  const oneSided = planRawAppend({ ...f, officialObservation: { status: 'error' } });
  assert.equal(oneSided.addedPlayers.length, 0);
});

test('invalid cumulative state and membership removals cannot publish inconsistent generations', () => {
  const f = fixture(); const first = ingest(f);
  const corrupt = structuredClone(first.state); corrupt.active[0].players.pop();
  assert.throws(() => ingest({ ...f, state: corrupt }), /Incomplete embedded pack/);
  const orphan = createLifecycleState(); orphan.players.push(projectPlayer(f.rawPlayers[0]));
  assert.throws(() => validateLifecycleState(orphan), /orphan/);
  f.candidate.memberIds.pop(); f.candidate.expectedSpecialCount = 1;
  f.rawPacks[0].playerCount = 1;
  const reduced = ingest({ ...f, state: first.state });
  assert.equal(reduced.pending[0].reason, 'cumulative_membership_removal_requires_review');
  assert.deepEqual(reduced.state.packs, first.state.packs);
  assert.deepEqual(reduced.state.players, first.state.players);
});
