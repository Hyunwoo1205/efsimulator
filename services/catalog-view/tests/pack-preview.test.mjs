import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPackPreview } from '../lib/pack-preview.mjs';
import metadata from '../lib/preview-player-types.json' with { type: 'json' };
import { buildPreviewTypes } from '../scripts/prepare-preview-types.mjs';

const player = (id, name = 'Unchanged player', overallRating = 99) => ({ id, name, overallRating });
const ids = players => players.map(value => value.id);

test('Magical Dribblers preview chooses the three actual Show Time cards after Highlight cards', () => {
  const pack = { officialTitle: 'Show Time: Magical Dribblers', players: [
    player('105896176839655', 'Rafa Silva'), player('105896176881795', 'Ulisses Garcia'), player('105896176886332', 'Kingsley Ehizibue'),
    player('106800804376628', 'Raphinha'), player('106800804393500', 'Jeremy Doku'), player('106800804418912', 'Desire Doue'),
  ] };
  const preview = selectPackPreview(pack);
  assert.deepEqual(preview.map(value => value.name), ['Raphinha', 'Jeremy Doku', 'Desire Doue']);
  assert.ok(preview.every(value => metadata.playerTypes[value.id] === 8));
  assert.deepEqual(selectPackPreview({ ...pack, officialTitle: '', name: 'Showtime: Magical Dribblers' }), preview);
});

test('Italian League Attackers preview chooses all three actual Epic cards in source order', () => {
  const pack = { officialTitle: 'Epic: Italian League Attackers', name: "Italian League Selection Attackers 26 Oct '26", players: [
    player('105896445274201', 'Domenico Berardi'), player('105896445333214', 'Nikola Vlasic'), player('105896445333407', 'Willem Geubbels'),
    player('88046292831684', 'Filippo Inzaghi'), player('88046292831703', 'Nakata Hidetoshi'), player('88046292831719', 'Roberto Baggio'),
  ] };
  assert.deepEqual(ids(selectPackPreview(pack)), ['88046292831684', '88046292831703', '88046292831719']);
});

test('Quaresma preview shows its single Epic without filling two places with Highlight cards', () => {
  const pack = { officialTitle: 'Epic: Ricardo Quaresma', players: [
    player('105899934993248', 'Rigoberto Rivas'), player('105899934997085', 'David Bates'), player('105899935007795', 'Kerem Demirbay'), player('88045487395246', 'Ricardo Quaresma'),
  ] };
  assert.deepEqual(ids(selectPackPreview(pack)), ['88045487395246']);
});

test('ordinary packs and target packs without known matching grade preserve the first three', () => {
  const players = [player('105899934993248'), player('105899934997085'), player('105899935007795'), player('88045487395246')];
  assert.deepEqual(selectPackPreview({ officialTitle: 'League Selection: Worldwide', players }), players.slice(0, 3));
  assert.deepEqual(selectPackPreview({ officialTitle: 'Show Time: Unrecognized cards', players }), players.slice(0, 3));
  const unknown = [player('999', 'Epic star', 110), player('998', 'Show Time star', 1), player('997'), player('996')];
  assert.deepEqual(selectPackPreview({ officialTitle: 'Epic: Unknown', players: unknown }), unknown.slice(0, 3));
});

test('selection uses exact string card IDs, preserves order and ignores names and OVR', () => {
  const players = [player('a', 'Epic label', 110), player('b', 'Ordinary name', 1), player('c'), player('d'), player('e')];
  const registry = { playerTypes: { a: 6, b: 5, c: 5, d: 5, e: 5 } };
  const before = structuredClone(players);
  assert.deepEqual(ids(selectPackPreview({ name: 'Epic: Any release', players }, registry)), ['b', 'c', 'd']);
  assert.deepEqual(players, before);
  assert.deepEqual(selectPackPreview({ officialTitle: 'Show Time: No inferred grade', players }, registry), players.slice(0, 3));
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
