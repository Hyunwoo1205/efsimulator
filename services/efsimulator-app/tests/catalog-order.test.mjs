import test from 'node:test';
import assert from 'node:assert/strict';
import { orderCatalog, playerDates, sortPacks, sortPlayers } from '../lib/catalog-order.mjs';
import { selectPackPreview } from '../lib/pack-preview.mjs';

const player = id => ({ id, name: 'Same name', overallRating: 99 });
const ids = values => values.map(value => value.id ?? value.saleId);
const pack = (saleId, title, date, players = []) => ({ saleId, officialTitle: title, date, players });

test('packs combine Epic/Show Time first, then order each group by valid date descending', () => {
  const packs = [pack('new-other', 'POTW', '2026-11-01'), pack('old-epic', 'Epic: Old', '2026-10-15'),
    pack('new-show', 'Showtime: New', '2026-10-22'), pack('new-epic', 'Epic: New', '2026-10-26'),
    pack('old-other', 'League Selection', '2026-09-10'), pack('not-epic', 'Epicurious', '2026-10-30'),
    pack('no-date-epic', 'Epic: Missing date', null), pack('bad-date', 'POTW', '2026-02-30')];
  const before = structuredClone(packs);
  assert.deepEqual(ids(sortPacks(packs)), ['new-epic', 'new-show', 'old-epic', 'no-date-epic', 'new-other', 'not-epic', 'old-other', 'bad-date']);
  assert.deepEqual(packs, before);
});

test('actual card grade overrides parent pack and OVR, with newest linked pack dates inside each group', () => {
  const epic = player('epic'), show = player('show'), highlight = player('highlight'), trending = player('trending'), unknown = player('unknown');
  epic.overallRating = 1; highlight.overallRating = 110;
  const packs = [pack('ep', 'Epic: Mixed', '2026-10-26', [highlight, epic]), pack('st', 'Show Time', '2026-10-22', [show]),
    pack('pw', 'POTW', '2026-10-29', [trending]), pack('u', 'Epic: Unregistered card', '2026-10-28', [unknown])];
  const registry = { playerTypes: { epic: 5, show: 8, highlight: 6, trending: 3 } };
  assert.deepEqual(ids(sortPlayers([highlight, trending, show, unknown, epic], playerDates(packs), registry)), ['epic', 'show', 'trending', 'unknown', 'highlight']);
});

test('shared card uses earliest known valid linked date irrespective of pack iteration order', () => {
  const reused = player('9007199254740993'), other = player('9007199254740992');
  const packs = [pack('late', 'POTW', '2026-10-26', [reused]), pack('bad', 'POTW', 'invalid', [reused]),
    pack('first', 'POTW', '2026-09-01', [reused]), pack('other', 'POTW', '2026-10-01', [other])];
  const registry = { playerTypes: {} };
  assert.deepEqual([...playerDates(packs).entries()].sort(), [...playerDates([...packs].reverse()).entries()].sort());
  assert.deepEqual(ids(sortPlayers([reused, other], playerDates(packs), registry)), [other.id, reused.id]);
});

test('ties use exact string IDs, missing dates finish their own group, and all inputs remain unchanged', () => {
  const players = [player('9007199254740993'), player('9007199254740992'), player('no-date'), player('epic-no-date')];
  const before = structuredClone(players);
  const dates = new Map([[players[0].id, 100], [players[1].id, 100]]);
  const registry = { playerTypes: { 'epic-no-date': 5 } };
  assert.deepEqual(ids(sortPlayers(players, dates, registry)), ['epic-no-date', '9007199254740992', '9007199254740993', 'no-date']);
  assert.deepEqual(players, before);
  assert.deepEqual(ids(sortPacks([pack('z', 'POTW', '2026-10-22'), pack('a', 'POTW', '2026-10-22')])), ['a', 'z']);
});

test('catalog sorting covers nested rosters without changing representatives or input objects', () => {
  const epicIds = ['88046292831684', '88046292831703', '88046292831719'];
  const showIds = ['106800804376628', '106800804393500', '106800804418912'];
  const highlight = player('105896445274201');
  const epic = pack('ep', 'Epic: Italian League Attackers', '2026-10-26', [highlight, ...epicIds.map(player)]);
  const show = pack('st', 'Show Time: Magical Dribblers', '2026-10-22', showIds.map(player));
  const normal = pack('normal', 'POTW', '2026-10-29', [player('52904333457355')]);
  const catalog = { manifest: { version_id: 'unchanged' }, live: [normal, show, epic], archive: [], players: [highlight, ...normal.players, ...show.players, ...epic.players.slice(1)] };
  const before = structuredClone(catalog), result = orderCatalog(catalog);
  assert.deepEqual(result.live.map(p => p.saleId), ['ep', 'st', 'normal']);
  assert.deepEqual(ids(result.live[0].players), [...epicIds, highlight.id]);
  assert.deepEqual(ids(result.players).slice(0, 6), [...epicIds, ...showIds]);
  assert.deepEqual(ids(selectPackPreview(result.live[0])), epicIds);
  assert.deepEqual(ids(selectPackPreview(result.live[1])), showIds);
  assert.deepEqual(catalog, before);
  assert.notEqual(result.live[0], epic);
  assert.equal(result.manifest, catalog.manifest);
});
