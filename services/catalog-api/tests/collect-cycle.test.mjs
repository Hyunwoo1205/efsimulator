import test from 'node:test';
import assert from 'node:assert/strict';
import { collectCycle } from '../scripts/lifecycle/collect-cycle.mjs';

const NOW = new Date('2026-10-27T00:00:00Z');
const document = body => `<html><head></head><body>${body}</body></html>`;
const flight = value => `<script>self.__next_f.push(${JSON.stringify([1, `a:${JSON.stringify(value)}\n`])})</script>`;
const player = id => ({ id, name: `Player ${id}`, nameJa: '', nameZh: '', slug: `player-${id}`, nationality: '', nationalityCode: '', team: '', position: 'CF', overallRating: 85, imageUrl: `https://efimg.com/${id}.png`, playerType: 5 });
const pack = (slug = 'pack-a', playerCount = 1) => ({ name: 'Pack A', slug, date: '2026-10-26', playerCount });
const row = title => `<div class="probability_data"><p class="data_title">${title}</p><p>종료 일시(UTC)：2026-11-02 01:59:59</p><p>처음 영입할 때의 선수 수：150</p><p>처음 영입할 때의 영입 확률：0.6667%</p></div>`;
const official = titles => document(`<dl class="probability"><dt>선수 영입 확률</dt><dd>${titles.map(row).join('')}<div class="probability_ntc_msg">주의 사항</div></dd></dl>`);
const anchor = id => `<a href="/players/${id}"><p>Player ${id}</p></a>`;
const newPlayers = (sections, embedded = []) => document(`<h1>New Players</h1>${sections.map(([title, ids]) => `<section><h2>${title}</h2><div>${ids.map(anchor).join('')}</div></section>`).join('')}${flight(embedded)}`);
const mapping = (extra = {}) => ({ saleId: 'sale-a', officialTitle: 'Official A', packSlug: 'pack-a', newPlayersSection: 'Section A', expectedEndsAt: '2026-11-02T01:59:59Z', expectedTotalPlayerCount: 150, matchEvidence: { reviewed: 'explicit same-round mapping' }, ...extra });
function fetcher(pages) {
  const calls = [];
  const fetchHtml = async url => {
    calls.push(url);
    assert.equal(url.includes('/api/'), false);
    if (!Object.hasOwn(pages, url)) throw new Error(`Unexpected URL ${url}`);
    if (pages[url] instanceof Error) throw pages[url];
    return { status: 200, source_url: url, observed_at: NOW.toISOString(), html: pages[url] };
  };
  return { calls, fetchHtml };
}
const pages = (efhub, titles = ['Official A']) => ({ 'https://efootball-web.konami.net/probability_kr.php': official(titles), 'https://efhub.com/new-players': efhub });

test('collector preserves fresh official rows but produces no candidates after one EFHub denial', async () => {
  const f = fetcher(pages(Object.assign(new Error('Forbidden'), { code: 'source_denied', status: 403 })));
  const result = await collectCycle({ mappings: [mapping()], rawPlayers: [], rawPacks: [], fetchHtml: f.fetchHtml, now: () => NOW });
  assert.equal(result.officialObservation.status, 'ok');
  assert.equal(result.officialObservation.rows.length, 1);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.requestCount, 2);
  assert.equal(f.calls.length, 2);
  assert.equal(result.sources.at(-1).http_status, 403);
});

test('reviewed existing raw membership needs only the two HTML checks and appends no raw objects', async () => {
  const f = fetcher(pages(newPlayers([['Section A', ['001']]])));
  const result = await collectCycle({ mappings: [mapping({ memberIds: ['001'] })], rawPlayers: [player('001')], rawPacks: [pack()], fetchHtml: f.fetchHtml, now: () => NOW });
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].memberIds, ['001']);
  assert.deepEqual(result.candidates[0].rawPlayers, []);
  assert.deepEqual(result.candidates[0].rawPack, pack());
  assert.equal(result.candidates[0].totalPlayerCount, 150);
  assert.equal(result.candidates[0].specialCount, 1);
  assert.equal(result.candidates[0].expectedSpecialCount, 1);
  assert.equal(f.calls.length, 2);
});

test('new-player original fields can come from section HTML without API or detail requests', async () => {
  const original = player('12345678901234567890');
  const f = fetcher(pages(newPlayers([['Section A', [original.id]]], [{ player: original }])));
  const result = await collectCycle({ mappings: [mapping()], rawPlayers: [], rawPacks: [pack()], fetchHtml: f.fetchHtml, now: () => NOW });
  assert.deepEqual(result.candidates[0].rawPlayers, [original]);
  assert.equal(f.calls.length, 2);
});

test('missing card fields are collected only from its linked ordinary detail HTML', async () => {
  const original = player('001');
  const f = fetcher({ ...pages(newPlayers([['Section A', ['001']]])), 'https://efhub.com/players/001': document(`<h1>Player 001</h1>${flight({ player: original })}`) });
  const result = await collectCycle({ mappings: [mapping()], rawPlayers: [], rawPacks: [pack()], fetchHtml: f.fetchHtml, now: () => NOW });
  assert.deepEqual(result.candidates[0].rawPlayers, [original]);
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls.at(-1), 'https://efhub.com/players/001');
});

test('new pack requires canonical four-field metadata and explicit section membership', async () => {
  const original = player('001');
  const sourcePack = pack();
  const f = fetcher({ ...pages(newPlayers([['Section A', ['001']]])), 'https://efhub.com/packs/pack-a': document(`<section><h1>Pack A</h1><div class="grid">${anchor('001')}</div></section>${flight([{ pack: sourcePack }, { player: original }])}`) });
  const result = await collectCycle({ mappings: [mapping()], rawPlayers: [], rawPacks: [], fetchHtml: f.fetchHtml, now: () => NOW });
  assert.deepEqual(result.candidates[0].rawPack, sourcePack);
  assert.deepEqual(result.candidates[0].rawPlayers, [original]);
  assert.equal(f.calls.length, 3);
});

test('partial raw fields and new unreviewed membership never become append candidates', async () => {
  const { nameJa: _nameJa, ...incomplete } = player('001');
  const f = fetcher(pages(newPlayers([['Section A', ['001']]], [{ player: incomplete }])));
  const result = await collectCycle({ mappings: [mapping()], rawPlayers: [], rawPacks: [pack()], fetchHtml: f.fetchHtml, now: () => NOW });
  assert.deepEqual(result.candidates, []);
  assert.equal(result.pending.at(-1).reason, 'incomplete_raw_player_shape');
  const f2 = fetcher(pages(newPlayers([['Section A', ['001']]])));
  const changed = await collectCycle({ mappings: [mapping({ memberIds: ['002'] })], rawPlayers: [player('001')], rawPacks: [pack()], fetchHtml: f2.fetchHtml, now: () => NOW });
  assert.equal(changed.pending.at(-1).reason, 'reviewed_membership_changed');
});

test('reported special-count corrections require explicit user confirmation and preserve the raw count', async () => {
  const f = fetcher(pages(newPlayers([['Section A', ['001', '002']]])));
  const result = await collectCycle({ mappings: [mapping({ countCorrection: { effectiveCount: 2, userConfirmed: true } })], rawPlayers: [player('001'), player('002')], rawPacks: [pack()], fetchHtml: f.fetchHtml, now: () => NOW });
  assert.equal(result.candidates[0].specialCount, 2);
  const f2 = fetcher(pages(newPlayers([['Section A', ['001', '002']]])));
  const rejected = await collectCycle({ mappings: [mapping({ countCorrection: { effectiveCount: 2 } })], rawPlayers: [player('001'), player('002')], rawPacks: [pack()], fetchHtml: f2.fetchHtml, now: () => NOW });
  assert.equal(rejected.candidates.length, 0);
  assert.equal(rejected.pending.at(-1).reason, 'unconfirmed_count_correction');
});

test('unmapped official products and changed rounds stay pending rather than fuzzy matching', async () => {
  const f = fetcher(pages(newPlayers([['Section A', ['001']]]), ['Official A', 'Unreviewed B']));
  const result = await collectCycle({ mappings: [mapping({ expectedEndsAt: '2026-11-03T01:59:59Z' })], rawPlayers: [player('001')], rawPacks: [pack()], fetchHtml: f.fetchHtml, now: () => NOW });
  assert.equal(result.candidates.length, 0);
  assert.ok(result.pending.some(item => item.reason === 'unmapped_official_product'));
  assert.ok(result.pending.some(item => item.reason === 'official_round_guard_mismatch'));
});

test('request budget is enforced before fetching another detail', async () => {
  const f = fetcher({ ...pages(newPlayers([['Section A', ['001', '002']]])), 'https://efhub.com/players/001': document(`<h1>Player 001</h1>${flight({ player: player('001') })}`) });
  const result = await collectCycle({ mappings: [mapping()], rawPlayers: [], rawPacks: [pack('pack-a', 2)], fetchHtml: f.fetchHtml, now: () => NOW, maxRequests: 3 });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.pending.at(-1).reason, 'request_budget_exhausted');
  assert.equal(f.calls.length, 3);
});

test('a denied detail stops all further EFHub requests and withholds earlier candidates', async () => {
  const f = fetcher({ ...pages(newPlayers([['Section A', ['001']], ['Section B', ['002']]]), ['Official A', 'Official B']), 'https://efhub.com/players/002': Object.assign(new Error('Forbidden'), { code: 'source_denied', status: 403 }) });
  const result = await collectCycle({ mappings: [mapping(), mapping({ saleId: 'sale-b', officialTitle: 'Official B', packSlug: 'pack-b', newPlayersSection: 'Section B' }), mapping({ saleId: 'sale-c', officialTitle: 'Official B', packSlug: 'pack-c', newPlayersSection: 'Section B' })], rawPlayers: [player('001')], rawPacks: [pack(), pack('pack-b'), pack('pack-c')], fetchHtml: f.fetchHtml, now: () => NOW });
  assert.equal(result.candidates.length, 0);
  assert.equal(f.calls.length, 3);
  assert.ok(result.pending.some(item => item.saleId === 'sale-a' && item.reason === 'efhub_cycle_blocked'));
  assert.ok(result.pending.some(item => item.saleId === 'sale-c' && item.reason === 'efhub_cycle_blocked'));
});
