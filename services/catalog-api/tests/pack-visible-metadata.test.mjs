import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePackMembershipHtml, validateHtmlSourceUrl } from '../scripts/lifecycle/html-sources.mjs';

// Synthetic structure fixtures for visible product metadata; no live raw data.
const pack = { name: "Current Pack 29 Oct '26", slug: 'current-pack-29-oct-26', date: '2026-10-29', playerCount: 2 };
const url = `https://efhub.com/packs/${pack.slug}`;
const ids = ['880460243089191111', '880460243089192222'];
const player = (id, name) => ({ id, name, slug: `player-${id}`, position: 'CF', overallRating: 85, imageUrl: `https://example.org/${id}.png`, playerType: 5 });
const players = ids.map((id, i) => player(id, `Card ${i + 1}`));
const flight = value => `<script>self.__next_f.push(${JSON.stringify([1, `a:${JSON.stringify(value)}\n`])})</script>`;
const document = (metadata = '29 October 2026<span>·</span>2 players', cards = players, extra = '') => `<html><body><main><section><div><h1>${pack.name}</h1><p>${metadata}</p></div><div class="grid">${cards.map(card => `<a href="/players/${card.id}"><img alt="${card.name}" /></a>`).join('')}</div>${extra}</section></main></body></html>`;

test('new visible product metadata yields the exact four-field raw pack and full string membership', () => {
  const parsed = parsePackMembershipHtml(document(undefined, players, flight(players.map(player => ({ player })))), { sourceUrl: url });
  assert.deepEqual(parsed.pack, pack);
  assert.deepEqual(parsed.playerIds, ids);
  assert.deepEqual(parsed.players, players);
  assert.equal(parsed.membershipComplete, true);
});

test('new metadata requires one unambiguous valid release date and reported count', () => {
  for (const metadata of ['2 players', '29 October 2026', '29 October 2026 · 2 players · 3 players', '29 October 2026 · 30 October 2026 · 2 players', '31 February 2026 · 2 players']) {
    assert.throws(() => parsePackMembershipHtml(document(metadata), { sourceUrl: url }));
  }
});

test('visible metadata remains bounded to its own product and excludes card text', () => {
  const named = [player(ids[0], '31 December 2025 99 players'), players[1]];
  const source = document(undefined, named).replace('</main>', '<aside>1 January 2020 · 20 players</aside></main>');
  assert.deepEqual(parsePackMembershipHtml(source, { sourceUrl: url }).pack, pack);
  const outside = document('2 players').replace('</main>', '<aside>29 October 2026</aside></main>');
  assert.throws(() => parsePackMembershipHtml(outside, { sourceUrl: url }), /release date/);
});

test('new visible packs reject incomplete or repeated links and conflicting retained metadata', () => {
  for (const cards of [[players[0]], [players[0], players[0]]]) {
    assert.throws(() => parsePackMembershipHtml(document(undefined, cards), { sourceUrl: url }), /count/);
  }
  assert.throws(() => parsePackMembershipHtml(document(), { sourceUrl: url, retainedPack: { ...pack, date: '2026-10-28' } }), /release date/);
  assert.throws(() => parsePackMembershipHtml(document(), { sourceUrl: url, expectedSlug: 'another-round' }), /explicit pack slug/);
});

test('two product headings cannot supply one another with raw metadata or member links', () => {
  const source = document('2 players').replace('</section>', '<section><h1>Other pack</h1><p>29 October 2026 · 2 players</p></section></section>');
  assert.throws(() => parsePackMembershipHtml(source, { sourceUrl: url }), /heading/);
});

const paginated = (page, extra = '') => document('29 October 2026 · 2 players', [players[page - 1]], `<nav aria-label="Pagination"><a ${page === 1 ? 'aria-current="page"' : ''} href="/packs/${pack.slug}">1</a><a ${page === 2 ? 'aria-current="page"' : ''} href="/packs/${pack.slug}?page=2">2</a><a aria-label="Next" href="/packs/${pack.slug}?page=2">›</a>${extra}</nav>`);

test('explicit pagination preserves both observed page URLs and never marks either partial page complete', () => {
  for (const page of [1, 2]) {
    const sourceUrl = `${url}${page === 2 ? '?page=2' : ''}`;
    assert.throws(() => parsePackMembershipHtml(paginated(page), { sourceUrl }), /count/);
    const parsed = parsePackMembershipHtml(paginated(page), { sourceUrl, allowPagination: true });
    assert.deepEqual(parsed.pack, pack);
    assert.deepEqual(parsed.pagination, { page, pageUrls: [url, `${url}?page=2`] });
    assert.equal(parsed.membershipComplete, false);
    assert.deepEqual(parsed.playerIds, [ids[page - 1]]);
  }
});

test('pack source URL permits only a canonical single page query on pack details', () => {
  assert.equal(validateHtmlSourceUrl(`${url}?page=2`).href, `${url}?page=2`);
  for (const sourceUrl of [`${url}?page=1`, `${url}?page=02`, `${url}?page=0`, `${url}?page=-2`, `${url}?page=2&x=1`, `${url}?page=2&page=2`, `${url}?page=9007199254740992`, 'https://efhub.com/new-players?page=2', 'https://efhub.com/players/123?page=2']) {
    assert.throws(() => validateHtmlSourceUrl(sourceUrl), /ordinary HTTPS/);
  }
});

test('pagination rejects unknown query, another pack, duplicate labels and missing page numbers', () => {
  for (const link of [`<a href="/packs/${pack.slug}?page=2&x=1">2</a>`, '<a href="/packs/another-pack?page=2">2</a>', `<a href="/packs/${pack.slug}?page=2">2</a>`, `<a href="/packs/${pack.slug}?page=4">4</a>`]) {
    assert.throws(() => parsePackMembershipHtml(paginated(1, link), { sourceUrl: url, allowPagination: true }), /pagination/);
  }
});

test('pagination validates the current page selection and cannot be inferred from a source query alone', () => {
  assert.throws(() => parsePackMembershipHtml(paginated(1), { sourceUrl: `${url}?page=2`, allowPagination: true }), /current selection/);
  assert.throws(() => parsePackMembershipHtml(document(), { sourceUrl: `${url}?page=2`, allowPagination: true }), /pagination controls/);
});
