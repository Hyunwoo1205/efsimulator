import test from 'node:test';
import assert from 'node:assert/strict';
import { collectCycle } from '../scripts/lifecycle/collect-cycle.mjs';
import { parsePackMembershipHtml, parsePackHtml } from '../scripts/lifecycle/html-sources.mjs';

// Synthetic structure fixtures only; current live pack HTML was unavailable during source cooldown.
const now = '2026-10-27T18:00:00.000Z';
const rulesIdentity = { version: 'test-rules', sha256: 'a'.repeat(64) };
const pack = { name: 'Older Pack', slug: 'older-pack', date: '2026-10-08', playerCount: 2 };
const player = (id, name) => ({ id, name, nameJa: '', nameZh: '', slug: `player-${id}`, nationality: '', nationalityCode: '', team: '', position: 'CF', overallRating: 80, imageUrl: `https://example.org/${id}.png`, playerType: 1 });
const players = [player('111111111111111111', 'First'), player('222222222222222222', 'Second')];
const mapping = { saleId: 'older-pack::2026-10', packSlug: pack.slug, officialTitle: 'Official Older Pack', newPlayersSection: pack.name,
  expectedEndsAt: '2026-10-29T01:59:59.000Z', expectedTotalPlayerCount: 2, expectedSpecialCount: 2,
  memberIds: players.map(value => value.id), matchEvidence: { status: 'explicit_user_approved' } };
const html = content => `<html><body>${content}</body></html>`;
const link = value => `<a href="/players/${value.id}"><img alt="${value.name}" /></a>`;
const detail = (rows = players, name = pack.name, extra = '') => html(`<main><h1>${name}</h1><p>Release Date: ${pack.date}</p><p>${pack.playerCount} Players</p><div class="grid">${rows.map(link).join('')}</div>${extra}</main>`);
const listing = html('<h1>New Players</h1><section><h2>Newer Pack</h2><div><a href="/players/999"><img alt="Other" /></a></div></section>');
const official = (maps = [mapping]) => html(`<dl class="probability"><dt>처음 영입할 때의 선수 수</dt>${maps.map(value => `<div class="probability_data"><p class="data_title">${value.officialTitle}</p><p>종료 일시(UTC): ${value.expectedEndsAt.replace('T', ' ').replace('.000Z', '')}</p><p>처음 영입할 때의 선수 수: ${value.expectedTotalPlayerCount}</p><p>처음 영입할 때의 영입 확률: 50%</p></div>`).join('')}<dd>주의 사항</dd></dl>`);
const options = { sourceUrl: 'https://efhub.com/packs/older-pack', observedAt: now, expectedSlug: pack.slug, retainedPack: pack };
function collector(overrides = {}) {
  const calls = [];
  const responses = { 'https://efootball-web.konami.net/probability_kr.php': official(), 'https://efhub.com/new-players': listing,
    'https://efhub.com/packs/older-pack': detail(), ...overrides.responses };
  return { calls, run: () => collectCycle({ mappings: overrides.mappings ?? [mapping], rawPlayers: overrides.rawPlayers ?? players,
    rawPacks: overrides.rawPacks ?? [pack], now: () => new Date(now), rulesIdentity,
    fetchHtml: async url => { calls.push(url); const response = responses[url]; if (response instanceof Error) throw response;
      if (response === undefined) throw new Error(`Unexpected URL ${url}`); return { html: response, source_url: url, observed_at: now, status: 200 }; } }) };
}

test('display-only detail validates exact retained pack and string roster IDs', () => {
  const result = parsePackMembershipHtml(detail(), options);
  assert.deepEqual(result.pack, pack);
  assert.deepEqual(result.playerIds, players.map(value => value.id));
  assert.deepEqual(result.players, []);
  assert.equal(result.membershipComplete, true);
  assert.throws(() => parsePackHtml(detail(), options), /original four-field pack metadata/);
});
test('detail rejects wrong title, wrong URL slug, duplicate and incomplete members', () => {
  assert.throws(() => parsePackMembershipHtml(detail(players, 'Wrong Pack'), options), /heading/);
  assert.throws(() => parsePackMembershipHtml(detail(), { ...options, sourceUrl: 'https://efhub.com/packs/wrong-pack' }), /explicit pack slug/);
  assert.throws(() => parsePackMembershipHtml(detail([players[0], players[0]]), options), /count/);
  assert.throws(() => parsePackMembershipHtml(detail([players[0]]), options), /count/);
});
test('retained pack requires matching visible release date and reported count', () => {
  assert.throws(() => parsePackMembershipHtml(detail().replace('<p>Release Date: 2026-10-08</p>', ''), options), /release date/);
  assert.throws(() => parsePackMembershipHtml(detail().replace('2026-10-08', '2026-10-09'), options), /release date/);
  assert.throws(() => parsePackMembershipHtml(detail().replace('<p>2 Players</p>', ''), options), /reported count/);
  assert.throws(() => parsePackMembershipHtml(detail().replace('<p>2 Players</p>', '<p>3 Players</p>'), options), /reported count/);
  assert.throws(() => parsePackMembershipHtml(detail(players, pack.name, '<p>3 Players</p>'), options), /reported count/);
  assert.throws(() => parsePackMembershipHtml(detail(players, pack.name, '<p>2026-10-09</p>'), options), /release date/);
  for (const label of ['8 October 2026', 'October 8, 2026', '<time datetime="2026-10-08">8 Oct</time>']) {
    assert.equal(parsePackMembershipHtml(detail().replace('2026-10-08', label), options).membershipComplete, true);
  }
});
test('detail does not borrow links from unrelated external grid', () => {
  const source = html(`<div><h1>${pack.name}</h1><div class="grid">${link(players[0])}</div><section><h1>Other</h1><div class="grid">${link(players[1])}</div></section></div>`);
  assert.throws(() => parsePackMembershipHtml(source, options), /grid|count/);
});
test('detail rejects conflicting embedded original pack metadata', () => {
  const payload = JSON.stringify(['$', 'x', null, { pack: { ...pack, date: '2026-10-09' } }]);
  const script = `<script>self.__next_f.push(${JSON.stringify([1, `1:${payload}\n`])})</script>`;
  assert.throws(() => parsePackMembershipHtml(detail(players, pack.name, script), options), /metadata disagree/);
});
test('missing historical listing section falls back to exact pack detail with retained raw', async () => {
  const fixture = collector(); const result = await fixture.run();
  assert.equal(result.candidates.length, 1);
  assert.equal(result.pending.length, 0);
  assert.equal(fixture.calls.length, 3);
  assert.deepEqual(result.candidates[0].rawPlayers, []);
  assert.equal(result.candidates[0].evidence.efhub.sourceUrl, 'https://efhub.com/packs/older-pack');
  assert.deepEqual(result.candidates[0].memberIds, mapping.memberIds);
});
test('detail fallback preserves exact reviewed membership validation', async () => {
  const fixture = collector({ mappings: [{ ...mapping, memberIds: ['111111111111111111', '333333333333333333'] }] });
  const result = await fixture.run();
  assert.equal(result.candidates.length, 0);
  assert.ok(result.pending.some(item => item.reason === 'reviewed_membership_changed'));
});
test('detail fallback rejects retained member name conflicts', async () => {
  const fixture = collector({ responses: { 'https://efhub.com/packs/older-pack': detail([{ ...players[0], name: 'Changed' }, players[1]]) } });
  const result = await fixture.run();
  assert.equal(result.candidates.length, 0);
  assert.ok(result.pending.some(item => item.reason === 'existing_member_name_conflict'));
});
test('new raw player still requires complete original detail fields', async () => {
  const fixture = collector({ rawPlayers: [players[0]], responses: { [`https://efhub.com/players/${players[1].id}`]: html(`<h1>${players[1].name}</h1>`) } });
  const result = await fixture.run();
  assert.equal(result.candidates.length, 0);
  assert.ok(result.pending.some(item => item.reason === 'source_layout_changed'));
});
test('official round guard fails before any pack detail request', async () => {
  const fixture = collector({ mappings: [{ ...mapping, expectedTotalPlayerCount: 3 }] });
  const result = await fixture.run();
  assert.equal(fixture.calls.length, 2);
  assert.equal(result.candidates.length, 0);
  assert.ok(result.pending.some(item => item.reason === 'official_round_guard_mismatch'));
});
test('blocked new-players never falls back to another EFHub page', async () => {
  const fixture = collector({ responses: { 'https://efhub.com/new-players': Object.assign(new Error('Denied'), { code: 'source_denied', status: 403 }) } });
  const result = await fixture.run();
  assert.equal(fixture.calls.length, 2);
  assert.equal(result.candidates.length, 0);
});
test('blocked pack detail ends EFHub requests and rejects earlier candidates', async () => {
  const otherPack = { ...pack, name: 'Later Pack', slug: 'later-pack' };
  const first = { ...mapping, saleId: 'a-first', newPlayersSection: 'Newer Pack', memberIds: ['999'], expectedSpecialCount: 1, packSlug: 'newer-pack' };
  const other = { ...mapping, saleId: 'z-last', packSlug: otherPack.slug, newPlayersSection: otherPack.name, officialTitle: 'Last Pack' };
  const fixture = collector({ mappings: [other, mapping, first], rawPlayers: [...players, player('999', 'Other')], rawPacks: [pack, otherPack, { ...pack, name: 'Newer Pack', slug: 'newer-pack', playerCount: 1 }],
    responses: { 'https://efootball-web.konami.net/probability_kr.php': official([mapping, other]), 'https://efhub.com/packs/older-pack': Object.assign(new Error('Denied'), { code: 'source_denied', status: 403 }) } });
  const result = await fixture.run();
  assert.equal(result.candidates.length, 0);
  assert.equal(fixture.calls.length, 3);
  assert.ok(result.pending.some(item => item.reason === 'efhub_cycle_blocked'));
});
test('same baseline and snapshots produce exactly the same evidence receipt', async () => {
  const first = await collector().run(); const second = await collector({ rawPlayers: structuredClone(players) }).run();
  assert.deepEqual(first, second);
});
