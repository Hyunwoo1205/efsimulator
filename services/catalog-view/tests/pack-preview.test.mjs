import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPackPreview } from '../lib/pack-preview.mjs';
import { sortPlayers, sortGlobalPlayers, sortPacks, orderCatalog, playerGrade } from '../lib/catalog-order.mjs';
import metadata from '../lib/preview-player-types.json' with { type: 'json' };
import { buildPreviewTypes } from '../scripts/prepare-preview-types.mjs';

const player = (id, playerType, overallRating = 99, name = id) => ({ id, playerType, overallRating, name });
const ids = players => players.map(value => value.id);

test('new API cards outside the historical registry are selected by exact source type and OVR', () => {
  const pack = { officialTitle: 'Show Time: Newly published', players: [
    player('new-highlight', 6, 110), player('new-show-low', 8, 90),
    player('new-show-best', 8, 99), player('new-show-next', 8, 98), player('new-show-fourth', 8, 95),
  ] };
  const before = structuredClone(pack);
  assert.deepEqual(ids(selectPackPreview(pack)), ['new-show-best', 'new-show-next', 'new-show-fourth']);
  assert.deepEqual(pack, before);
});

test('WPOTY previews Kane, Yamal and Mbappe in OVR order while every Highlight stays below Epic', () => {
  const players = [
    player('105879802349991', 6, 86, 'Erling Haaland'),
    player('105879802223959', 6, 84, 'Lionel Messi'),
    player('88047366549630', 5, 87, 'Kylian Mbappe'),
    player('88047366601026', 5, 88, 'Lamine Yamal'),
    player('88046024308919', 5, 88, 'Harry Kane'),
  ];
  const pack = { officialTitle: 'Epic: World Player of the Year 2026', players };
  assert.deepEqual(selectPackPreview(pack).map(p => p.name), ['Harry Kane', 'Lamine Yamal', 'Kylian Mbappe']);
  assert.deepEqual(sortPlayers(players).map(p => p.playerType), [5, 5, 5, 6, 6]);
});

test('a single Epic is never padded with higher-OVR Highlight cards', () => {
  const pack = { officialTitle: 'Epic: Ricardo Quaresma', players: [
    player('highlight1', 6, 120), player('highlight2', 6, 119), player('epic', 5, 88),
  ] };
  assert.deepEqual(ids(selectPackPreview(pack)), ['epic']);
});

test('source grade precedes rating and known cards precede missing or future taxonomy', () => {
  const players = [player('future', 99, 150), player('highlight', 6, 120), player('trend', 3, 100),
    player('show', 8, 90), player('epic-low', 5, 80), player('epic-high', 5, 99), { id: 'missing', overallRating: 160 }];
  assert.deepEqual(ids(sortPlayers(players)), ['epic-high', 'epic-low', 'show', 'trend', 'highlight', 'missing', 'future']);
  assert.equal(playerGrade({ id: 'unregistered', playerType: 99 }).label, '등급 미확인');
  assert.equal(playerGrade({ id: 'epic-name', name: 'Epic star', overallRating: 110 }).rank, 4);
});

test('pack class follows actual card types, then date descending; unknown types are not promoted by titles', () => {
  const pack = (saleId, date, type, officialTitle = '') => ({ saleId, date, officialTitle, players: [player(saleId, type)] });
  const packs = [pack('new-highlight', '2026-12-01', 6), pack('old-epic', '2026-10-01', 5),
    pack('new-epic', '2026-10-29', 5), pack('show', '2026-11-01', 8), pack('trend', '2026-11-02', 3),
    pack('unknown', '2026-12-02', 99, 'Epic: Unverified')];
  assert.deepEqual(sortPacks(packs).map(p => p.saleId), ['new-epic', 'old-epic', 'show', 'trend', 'new-highlight', 'unknown']);
});

test('catalog ordering reaches player tab and nested rosters without mutating the snapshot', () => {
  const players = [player('highlight', 6, 120), player('epic-low', 5, 80), player('epic-high', 5, 99)];
  const catalog = { live: [{ saleId: 'mixed', date: '2026-10-29', players }], archive: [], players };
  const before = structuredClone(catalog); const result = orderCatalog(catalog);
  assert.deepEqual(ids(result.players), ['epic-high', 'epic-low', 'highlight']);
  assert.deepEqual(ids(result.live[0].players), ids(result.players));
  assert.deepEqual(catalog, before);
});

test('display registry contains only approved card IDs/types and exact input provenance', () => {
  assert.equal(Object.keys(metadata.playerTypes).length, 70);
  assert.equal(metadata.source.rawPlayersSha256, 'c8d141864401ae4eff8abae4fab3aa059ebeb15b74e821e016942e3bb3f823d8');
  assert.equal(metadata.source.publicationVersion, 'c8cbaa7783d2889870347cf1509d3dc3141c41f76db81245c8aadf236e3dd854');
  assert.equal(metadata.source.taxonomyObservationId, 'efhub_types_js');
  assert.equal(metadata.source.taxonomySha256, '241046ee60771205e8a331364dccb65b9e5cf39e7471e08bd75c2123152744bc');
  assert.ok(Object.entries(metadata.playerTypes).every(([id, type]) => /^\d+$/.test(id) && (type === null || Number.isSafeInteger(type))));
  assert.deepEqual(Object.keys(metadata).sort(), ['playerTypes', 'schemaVersion', 'source']);
});

test('metadata builder excludes unapproved raw cards and records unknown type without inferring it', () => {
  const loaded = { manifest: { files: [{ path: 'raw/players_raw.json', sha256: 'a'.repeat(64) }] }, rawPlayers: [
    { id: '1', name: 'not copied', playerType: 5 }, { id: '2', playerType: 99 }, { id: '3', playerType: 8 },
  ], state: { players: [{ id: '2' }, { id: '1' }] } };
  const taxonomyDocument = { observations: [{ id: 'efhub_types_js', status: 200, sha256: 'b'.repeat(64), verified_fields: { raw_player_type_translation_keys: { 5: 'epic', 6: 'highlight', 8: 'showtime' } } }] };
  const result = buildPreviewTypes({ loaded, taxonomyDocument, publicationVersion: 'c'.repeat(64) });
  assert.deepEqual(result.playerTypes, { 1: 5, 2: null });
  assert.doesNotMatch(JSON.stringify(result), /not copied|playerType"|"3"/);
  assert.deepEqual(buildPreviewTypes({ loaded, taxonomyDocument, publicationVersion: 'c'.repeat(64) }), result);
  const changedTaxonomy = structuredClone(taxonomyDocument);
  changedTaxonomy.observations[0].verified_fields.raw_player_type_translation_keys[5] = 'highlight';
  assert.throws(() => buildPreviewTypes({ loaded, taxonomyDocument: changedTaxonomy, publicationVersion: 'c'.repeat(64) }), /taxonomy differs/);
});

const pack = (saleId, date, players) => ({ saleId, date, players });

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
