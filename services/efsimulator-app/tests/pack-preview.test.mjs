import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPackPreview } from '../lib/pack-preview.mjs';

const player = (id, name, playerType, overallRating) => ({ id, name, playerType, overallRating });
const ids = players => players.map(value => value.id);

// Exact IDs/types/OVR from the retained T039 raw source for this verified round.
const wpoty = { officialTitle: 'Epic: World Player of the Year 2026', players: [
  player('105879802223959', 'Lionel Messi', 6, 84), player('105879802323405', 'Unai Simon', 6, 82),
  player('105879802324687', 'Fabian Ruiz', 6, 83), player('105879802327074', 'Ousmane Dembele', 6, 84),
  player('105879802327263', 'Rodri', 6, 84), player('105879802345168', 'K. Kvaratskhelia', 6, 84),
  player('105879802345817', 'Michael Olise', 6, 84), player('105879802349991', 'Erling Haaland', 6, 86),
  player('88046024308919', 'Harry Kane', 5, 88), player('88047366549630', 'Kylian Mbappe', 5, 87),
  player('88047366601026', 'Lamine Yamal', 5, 88),
] };

test('WPOTY previews Kane/Yamal/Mbappe by OVR using their current API types', () => {
  assert.deepEqual(selectPackPreview(wpoty).map(value => value.name), ['Harry Kane', 'Lamine Yamal', 'Kylian Mbappe']);
  assert.deepEqual(selectPackPreview({ ...wpoty, players: [...wpoty.players].reverse() }).map(value => value.name), ['Harry Kane', 'Lamine Yamal', 'Kylian Mbappe']);
});

test('Show Time preview chooses the highest three verified Show Time cards before stronger Highlights', () => {
  const pack = { officialTitle: 'Show Time: A mixed pack', players: [player('h', 'Highlight', 6, 110), player('s1', 'Show one', 8, 88), player('s2', 'Show two', 8, 90), player('s3', 'Show three', 8, 89), player('s4', 'Show four', 8, 87)] };
  assert.deepEqual(ids(selectPackPreview(pack)), ['s2', 's3', 's1']);
});

test('single Epic preview is not padded with two Highlight cards', () => {
  const pack = { players: [player('h1', 'Highlight one', 6, 110), player('q', 'Ricardo Quaresma', 5, 80), player('h2', 'Highlight two', 6, 109)] };
  assert.deepEqual(ids(selectPackPreview(pack)), ['q']);
});

test('Trend and Highlight pack previews follow OVR and preserve the source array', () => {
  const players = [player('a', 'A', 3, 90), player('b', 'B', 3, 88), player('c', 'C', 3, 92), player('d', 'D', 3, 91)];
  const before = structuredClone(players);
  assert.deepEqual(ids(selectPackPreview({ players })), ['c', 'd', 'a']);
  assert.deepEqual(ids(selectPackPreview({ players: players.map(value => ({ ...value, playerType: 6 })) })), ['c', 'd', 'a']);
  assert.deepEqual(players, before);
});

test('missing/new unknown types are not classified using names, title or historic registry IDs', () => {
  const players = [{ id: '88046024308919', name: 'Epic old registry card', overallRating: 99 }, player('x', 'Epic star', 999, 100)];
  assert.deepEqual(ids(selectPackPreview({ officialTitle: 'Epic: Not proof of card grades', players })), ['x', '88046024308919']);
  assert.deepEqual(selectPackPreview({ players: [] }), []);
  assert.deepEqual(selectPackPreview({}), []);
});
