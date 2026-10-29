import test from 'node:test';
import assert from 'node:assert/strict';
import { orderCatalog, packGrade, playerGrade, playerDates, sortGlobalPlayers, sortPacks, sortPlayers } from '../lib/catalog-order.mjs';

const player = (id, playerType, overallRating = 99) => ({ id, playerType, name: 'Same name', overallRating });
const ids = values => values.map(value => value.id ?? value.saleId);
const pack = (saleId, date, players, officialTitle = '') => ({ saleId, officialTitle, date, players });

test('packs use Epic > Show Time > Trend > Highlight and newest date within each source grade', () => {
  const packs = [pack('new-highlight', '2026-12-01', [player('h', 6)]), pack('old-epic', '2026-09-01', [player('e', 5)]),
    pack('new-show', '2026-11-22', [player('s', 8)]), pack('new-epic', '2026-10-29', [player('x', 5)]),
    pack('trend', '2026-12-01', [player('t', 3)]), pack('unknown', '2027-01-01', [player('u', 999)]),
    pack('bad-date-epic', '2026-02-30', [player('b', 5)])];
  const before = structuredClone(packs);
  assert.deepEqual(ids(sortPacks(packs)), ['new-epic', 'old-epic', 'bad-date-epic', 'new-show', 'trend', 'new-highlight', 'unknown']);
  assert.deepEqual(packs, before);
});

test('pack players use exact API type, then OVR descending; parent titles cannot promote a Highlight', () => {
  const players = [player('h', 6, 110), player('s', 8, 91), player('e-low', 5, 1), player('t', 3, 110), player('e-high', 5, 99), player('u', 999, 120)];
  const before = structuredClone(players);
  assert.deepEqual(ids(sortPlayers(players)), ['e-high', 'e-low', 's', 't', 'h', 'u']);
  assert.deepEqual(players, before);
  assert.equal(packGrade(pack('mixed', '2026-10-29', players, 'Highlight: Wrong title')).label, 'Epic');
  assert.equal(playerGrade(players[0]).label, 'Highlight');
});

test('equal OVR uses exact string IDs; absent/nonfinite OVR finishes its grade', () => {
  const players = [player('9007199254740993', 5, 99), player('9007199254740992', 5, 99), player('null', 5, null), player('nan', 5, NaN), player('s', 8, 110)];
  assert.deepEqual(ids(sortPlayers(players)), ['9007199254740992', '9007199254740993', 'nan', 'null', 's']);
  assert.deepEqual(ids(sortPacks([pack('z', '2026-10-29', [player('e1', 5)]), pack('a', '2026-10-29', [player('e2', 5)])])), ['a', 'z']);
});

test('new API IDs classify without a bundled registry; present unknown codes stay unknown', () => {
  assert.equal(playerGrade(player('new-unregistered-id', 5)).label, 'Epic');
  assert.equal(playerGrade({ id: '88046024308919' }).label, '등급 미확인');
  assert.equal(packGrade(pack('bad', '2026-10-29', [player('u', 999)], 'Epic: A misleading name')).label, '등급 미확인');
  assert.equal(packGrade(pack('legacy', '2026-10-29', [{ id: 'untyped' }], 'Show Time: Legacy')).label, 'Show Time');
  assert.equal(packGrade(pack('false-prefix', '2026-10-29', [], 'Epicurious')).label, '등급 미확인');
});

test('catalog ordering covers live/archive/global players and nested rosters without mutation', () => {
  const h = player('h', 6, 110), e1 = player('e1', 5, 88), e2 = player('e2', 5, 87), s = player('s', 8, 99), t = player('t', 3, 99);
  const epic = pack('ep', '2026-10-26', [h, e2, e1]);
  const catalog = { manifest: { version_id: 'unchanged' }, live: [pack('t', '2026-10-29', [t]), pack('st', '2026-10-29', [s]), epic], archive: [pack('earlier', '2026-01-01', [e2])], players: [h, s, e2, t, e1] };
  const before = structuredClone(catalog), result = orderCatalog(catalog);
  assert.deepEqual(ids(result.live), ['ep', 'st', 't']);
  assert.deepEqual(ids(result.live[0].players), ['e1', 'e2', 'h']);
  assert.deepEqual(ids(result.players), ['e1', 'e2', 's', 't', 'h']);
  assert.deepEqual(catalog, before);
  assert.notEqual(result.live[0], epic);
  assert.equal(result.manifest, catalog.manifest);
});

test('global players use release date before OVR while a pack roster keeps OVR order', () => {
  const old = player('old', 5, 100), recent = player('recent', 5, 90);
  const packs = [pack('old', '2026-01-01', [old]), pack('new', '2026-10-29', [recent])];
  assert.ok(playerDates(packs).get(old.id) < playerDates(packs).get(recent.id));
  assert.deepEqual(ids(sortPlayers([recent, old])), ['old', 'recent']);
  assert.deepEqual(ids(sortGlobalPlayers([old, recent], packs)), ['recent', 'old']);
});

test('global search preserves grade priority, uses newest card release, then OVR and exact ID', () => {
  const old = player('old', 5, 110), newerLow = player('new-low', 5, 80), newerHigh = player('new-high', 5, 90);
  const equalA = player('9007199254740992', 5, 90), equalB = player('9007199254740993', 5, 90);
  const missing = player('missing', 5, 120), invalid = player('invalid', 5, 130), show = player('show', 8, 140);
  const players = [show, missing, old, newerLow, equalB, invalid, newerHigh, equalA];
  const packs = [pack('archive', '2026-01-01', [old]), pack('recent', '2026-10-29', [newerLow, newerHigh, equalA, equalB]),
    pack('reappearance', '2026-11-01', [old]), pack('invalid', '2026-02-30', [invalid]), pack('show', '2027-01-01', [show])];
  const before = structuredClone({ players, packs });
  assert.deepEqual(ids(sortGlobalPlayers(players, packs)), ['9007199254740992', '9007199254740993', 'new-high', 'new-low', 'old', 'invalid', 'missing', 'show']);
  assert.deepEqual({ players, packs }, before);
});

test('catalog searches all releases while nested rosters retain grade/OVR order after filtering', () => {
  const old = player('old', 5, 110), recent = player('recent', 5, 80), highlight = player('highlight', 6, 120);
  const catalog = { live: [pack('current', '2026-10-29', [recent, old, highlight])], archive: [pack('past', '2026-01-01', [old])], players: [highlight, old, recent] };
  const before = structuredClone(catalog), result = orderCatalog(catalog);
  assert.deepEqual(ids(result.players), ['recent', 'old', 'highlight']);
  assert.deepEqual(ids(result.players.filter(value => value.playerType === 5)), ['recent', 'old']);
  assert.deepEqual(ids(result.live[0].players), ['old', 'recent', 'highlight']);
  assert.deepEqual(ids(result.archive[0].players), ['old']);
  assert.deepEqual(catalog, before);
});
