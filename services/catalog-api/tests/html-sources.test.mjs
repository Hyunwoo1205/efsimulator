import test from 'node:test';
import assert from 'node:assert/strict';
import { checkHtmlSources, fetchHtmlSnapshot, parseNewPlayersHtml, parseOfficialHtml, parsePackHtml, parsePlayerHtml, validateHtmlSourceUrl } from '../scripts/lifecycle/html-sources.mjs';

// These fixtures reproduce the observed HTML/Flight boundaries, not a claimed live capture.
const document = body => `<html><head></head><body>${body}</body></html>`;
const flight = value => `<script>self.__next_f.push(${JSON.stringify([1, `a:${JSON.stringify(value)}\n`])})</script>`;
const player = (id = '001234567890123456789') => ({ id, name: 'Player & One', nameJa: '名前', slug: 'player-one', position: 'CF', overallRating: 85, playingStyle: 'Goal Poacher', imageUrl: `https://efimg.com/${id}.png`, playerType: 5 });
const anchor = p => `<a href="/players/${p.id}"><img alt="Player &amp; One"/><p>${p.name.replace('&', '&amp;')}</p></a>`;
const officialRow = (title = 'Product A', end = '2026-11-02 01:59:59', count = '150') => `<div class="probability_data"><p class="data_title">${title}</p><p>종료 일시(UTC)：${end}</p><p>처음 영입할 때의 선수 수：${count}</p><p>처음 영입할 때의 영입 확률：0.6667%</p></div>`;
const official = rows => document(`<dl class="probability"><dt>선수 영입 확률</dt><dd>${rows}<div class="probability_ntc_msg">주의 사항</div></dd></dl>`);

test('official HTML collects every row, explicit UTC end and initial total, without fixed row count', () => {
  const parsed = parseOfficialHtml(official(officialRow('A &amp; B') + officialRow('C', '2026-11-05 01:59:59', '11')), { observedAt: '2026-10-27T00:00:00Z' });
  assert.equal(parsed.complete, true);
  assert.equal(parsed.records.length, 2);
  assert.deepEqual(parsed.records[0], { title: 'A & B', totalPlayerCount: 150, endsAt: '2026-11-02T01:59:59Z', probabilityText: '0.6667%' });
  assert.equal(parsed.observed_at, '2026-10-27T00:00:00Z');
  assert.match(parsed.sha256, /^[a-f\d]{64}$/);
});

test('official HTML fails closed for truncated, missing, invalid, duplicate or empty product boundaries', () => {
  for (const html of [official(officialRow()).replace('</body>', ''), official(officialRow()).replace('주의 사항', ''), official(officialRow()).replace('처음 영입할 때의 선수 수：150', ''), official(officialRow('A', '2026-02-30 01:59:59')), official(officialRow() + officialRow()), official('')]) {
    assert.throws(() => parseOfficialHtml(html));
  }
});

test('New Players uses section-scoped exact string IDs and does not invent a pack slug', () => {
  const one = player();
  const two = player('002');
  const html = document(`<h1>New Players</h1><section><h2>Section A</h2><div>${anchor(one)}</div></section><section><h2><a href="/packs/product-b">Section B</a></h2><div>${anchor(two)}</div></section>${flight([{ player: one }, { player: two }, { player: player('999') }])}`);
  const parsed = parseNewPlayersHtml(html);
  assert.equal(parsed.sections.length, 2);
  assert.deepEqual(parsed.sections[0].players, [{ id: one.id, name: one.name, detailUrl: `https://efhub.com/players/${one.id}` }]);
  assert.equal(parsed.sections[0].packSlug, null);
  assert.equal(parsed.sections[1].packSlug, 'product-b');
  assert.deepEqual(parsed.rawPlayers, [one, two]);
  assert.deepEqual(parsed.rawPacks, []);
});

test('New Players rejects empty or duplicate section memberships instead of publishing a partial list', () => {
  for (const content of [`<h2>Empty</h2><div></div>`, `<h2>A</h2><div>${anchor(player())}${anchor(player())}</div>`]) {
    assert.throws(() => parseNewPlayersHtml(document(`<h1>New Players</h1><section>${content}</section>`)));
  }
});

test('detail parsing preserves original field shape and precision, without executing arbitrary script', () => {
  globalThis.__htmlSourceExecuted = false;
  const original = player();
  const html = document(`<h1>Player &amp; One</h1>${flight({ player: original })}<script>globalThis.__htmlSourceExecuted=true</script>`);
  const result = parsePlayerHtml(html, { sourceUrl: `https://efhub.com/players/${original.id}` });
  assert.deepEqual(result.player, original);
  assert.equal(Object.hasOwn(result.player, 'nationality'), false);
  assert.equal(Object.hasOwn(result.player, 'playingStyleDefensive'), false);
  assert.equal(globalThis.__htmlSourceExecuted, false);
  delete globalThis.__htmlSourceExecuted;
});

test('detail parsing rejects numeric IDs, conflicting records, wrong names and non-JSON Flight', () => {
  const original = player('123');
  const inputs = [
    document(`<h1>${original.name}</h1>${flight({ player: { ...original, id: 123 } })}`),
    document(`<h1>${original.name}</h1>${flight([{ player: original }, { player: { ...original, overallRating: 90 } }])}`),
    document(`<h1>Wrong</h1>${flight({ player: original })}`),
    document('<h1>Player</h1><script>self.__next_f.push([1, globalThis.untrusted()])</script>'),
  ];
  for (const html of inputs) assert.throws(() => parsePlayerHtml(html, { expectedId: original.id }));
});

test('pack detail links only its own grid, requires explicit source metadata and count completeness', () => {
  const card = player();
  const pack = { name: 'Pack A', slug: 'pack-a', date: '2026-10-26', playerCount: 1 };
  const html = document(`<section><h1>Pack A</h1><div class="grid">${anchor(card)}</div></section><aside>${anchor(player('999'))}</aside>${flight([{ pack }, { player: card }, { player: player('999') }])}`);
  const result = parsePackHtml(html, { sourceUrl: 'https://efhub.com/packs/pack-a' });
  assert.deepEqual(result.pack, pack);
  assert.deepEqual(result.playerIds, [card.id]);
  assert.deepEqual(result.players, [card]);
  assert.equal(result.membershipComplete, true);
  assert.throws(() => parsePackHtml(document(`<section><h1>Pack A</h1><div class="grid">${anchor(card)}</div></section>${flight([{ pack: { ...pack, playerCount: 2 } }, { player: card }])}`), { expectedSlug: 'pack-a' }));
  assert.throws(() => parsePackHtml(document(`<h1>Pack A</h1>${flight({ player: card })}`), { expectedSlug: 'pack-a' }));
});

test('HTML fetch refuses API, query, credentials, unsupported origins and non-HTTPS URLs', async () => {
  for (const url of ['https://efhub.com/api/players', 'https://efhub.com/new-players?a=1', 'https://user:secret@efhub.com/new-players', 'https://example.com/new-players', 'http://efhub.com/new-players']) assert.throws(() => validateHtmlSourceUrl(url));
  for (const url of ['https://efhub.com/new-players', 'https://efhub.com/ko/players/001', 'https://efhub.com/packs/pack-a', 'https://efootball-web.konami.net/probability_kr.php']) assert.equal(validateHtmlSourceUrl(url).href, url);
});

test('HTML fetch makes exactly one ordinary request, stops at denial, and never follows redirect', async () => {
  let calls = 0;
  for (const status of [403, 429, 302]) {
    await assert.rejects(fetchHtmlSnapshot('https://efhub.com/new-players', { fetchImpl: async (_url, init) => {
      calls++;
      assert.equal(init.redirect, 'manual');
      assert.deepEqual(init.headers, { Accept: 'text/html' });
      assert.equal(init.method, 'GET');
      return new Response('', { status });
    } }));
  }
  assert.equal(calls, 3);
});

test('HTML fetch validates MIME, byte limit and challenge bodies before accepting a snapshot', async () => {
  for (const response of [new Response('{}', { headers: { 'content-type': 'application/json' } }), new Response(document('Just a moment cf-chl-'), { headers: { 'content-type': 'text/html' } })]) {
    await assert.rejects(fetchHtmlSnapshot('https://efhub.com/new-players', { fetchImpl: async () => response }));
  }
  await assert.rejects(fetchHtmlSnapshot('https://efhub.com/new-players', { maxBytes: 5, fetchImpl: async () => new Response(document('abc'), { headers: { 'content-type': 'text/html' } }) }), { code: 'source_too_large' });
  const result = await fetchHtmlSnapshot('https://efhub.com/new-players', { now: () => new Date('2026-10-27T00:00:00Z'), fetchImpl: async () => new Response(document('abc'), { headers: { 'content-type': 'text/html; charset=utf-8' } }) });
  assert.equal(result.complete, true);
  assert.equal(result.observed_at, '2026-10-27T00:00:00.000Z');
  assert.equal(result.html, document('abc'));
});

test('one-pass source check preserves successful official observation while reporting EFHub denial explicitly', async () => {
  const calls = [];
  const result = await checkHtmlSources({ now: () => new Date('2026-10-27T00:00:00Z'), fetchImpl: async url => {
    calls.push(url);
    return url.includes('konami.net') ? new Response(official(officialRow()), { headers: { 'content-type': 'text/html' } }) : new Response('', { status: 403 });
  } });
  assert.equal(result.complete, false);
  assert.equal(result.sources.official.status, 'ok');
  assert.equal(result.sources.official.records.length, 1);
  assert.equal(result.sources.efhub.status, 'blocked');
  assert.equal(result.sources.efhub.http_status, 403);
  assert.equal(result.sources.efhub.previousDataAction, 'preserve');
  assert.deepEqual(calls, ['https://efootball-web.konami.net/probability_kr.php', 'https://efhub.com/new-players']);
});
