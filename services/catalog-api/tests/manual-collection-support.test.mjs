import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { collectCycle } from '../scripts/lifecycle/collect-cycle.mjs';
import { replayCollectionReceipt } from '../scripts/lifecycle/collection-receipt.mjs';
import { activeRules } from '../scripts/lifecycle/rules.mjs';
import { fixtureApproval } from './helpers/source-fixture.mjs';

const NOW = '2026-10-29T12:00:00.000Z';
const RULES = { version: 'synthetic-manual-test', sha256: 'a'.repeat(64) };
const OFFICIAL = 'https://efootball-web.konami.net/probability_kr.php';
const NEW = 'https://efhub.com/new-players';
const doc = body => `<html><head></head><body>${body}</body></html>`;
const flight = value => `<script>self.__next_f.push(${JSON.stringify([1, `a:${JSON.stringify(value)}\n`])})</script>`;
const player = { id: '001', name: 'Player 001', nameJa: '', nameZh: '', slug: 'player-001', nationality: '', nationalityCode: '', team: '', position: 'CF', overallRating: 85, imageUrl: 'https://efimg.com/001.png', playerType: 5 };
const pack = { name: 'Pack A', slug: 'pack-a', date: '2026-10-29', playerCount: 1 };
const mapping = { saleId: 'sale-a', officialTitle: 'Official A', packSlug: 'pack-a', newPlayersSection: 'Section A', expectedEndsAt: '2026-11-05T01:59:59Z', expectedTotalPlayerCount: 150, expectedSpecialCount: 1, memberIds: ['001'], matchEvidence: { reviewed: 'Synthetic same-round fixture' } };
const anchor = id => `<a href="/players/${id}"><p>Player ${id}</p></a>`;
const pages = (ids = ['001']) => ({
  [OFFICIAL]: doc('<dl class="probability"><dt>선수 영입 확률</dt><dd><div class="probability_data"><p class="data_title">Official A</p><p>종료 일시(UTC)：2026-11-05 01:59:59</p><p>처음 영입할 때의 선수 수：150</p><p>처음 영입할 때의 영입 확률：0.6667%</p></div><div>주의 사항</div></dd></dl>'),
  [NEW]: doc(`<h1>New Players</h1><section><h2>Section A</h2><div>${ids.map(anchor).join('')}</div></section>`),
  'https://efhub.com/packs/pack-a': doc(`<section><h1>Pack A</h1><p>29 October 2026·1 player</p><div class="grid">${anchor('001')}</div></section>${flight({ pack })}`),
  'https://efhub.com/players/001': doc(`<h1>Player 001</h1>${flight({ player })}`),
});
const domSnapshot = (url, html) => ({ source_url: url, observed_at: NOW, status: null, source_kind: 'browser_dom', complete: true,
  bytes: Buffer.byteLength(html), sha256: createHash('sha256').update(html).digest('hex'), html });
async function collect({ manualCollection = true, rulesIdentity = RULES, mutate = value => value, ids } = {}) {
  const calls = []; const htmls = pages(ids);
  const source = await collectCycle({ mappings: [mapping], mappingsDocument: { schemaVersion: 1, mappings: [mapping] },
    rulesIdentity, rawPlayers: [], rawPacks: [], manualCollection, now: () => new Date(NOW), fetchHtml: async url => {
      calls.push(url); assert.ok(Object.hasOwn(htmls, url), `Unexpected URL ${url}`);
      return mutate(domSnapshot(url, htmls[url]));
    } });
  return { source, calls };
}

test('manual DOM evidence keeps unknown HTTP status and collects summary-only pack cards from detail HTML', async () => {
  const { source, calls } = await collect();
  assert.equal(source.candidates.length, 1);
  assert.deepEqual(source.candidates[0].rawPack, pack);
  assert.deepEqual(source.candidates[0].rawPlayers, [player]);
  assert.equal(calls.length, 4);
  assert.equal(source.receipt.schemaVersion, 3);
  assert.equal(source.receipt.mode, 'manual');
  for (const { snapshot } of source.receipt.requests) {
    assert.equal(snapshot.status, null);
    assert.equal(snapshot.source_kind, 'browser_dom');
  }
  assert.ok(source.sources.every(source => source.status === 'ok' && source.source_kind === 'browser_dom'));
});

test('DOM evidence requires explicit manual mode and original byte/hash metadata', async () => {
  const automatic = await collect({ manualCollection: false });
  assert.deepEqual(automatic.source.candidates, []);
  assert.equal(automatic.source.receipt.schemaVersion, 1);
  assert.ok(automatic.source.pending.some(item => item.reason === 'invalid_browser_dom_snapshot'));
  for (const mutate of [snapshot => ({ ...snapshot, status: 200 }), snapshot => ({ ...snapshot, sha256: '0'.repeat(64) }),
    snapshot => ({ ...snapshot, bytes: snapshot.bytes + 1 }), snapshot => ({ ...snapshot, complete: false })]) {
    const invalid = await collect({ mutate });
    assert.deepEqual(invalid.source.candidates, []);
    assert.ok(invalid.source.pending.some(item => item.reason === 'invalid_browser_dom_snapshot'));
  }
});

test('pack detail must cover the complete listing section rather than a matching subset', async () => {
  const { source } = await collect({ ids: ['001', '002'] });
  assert.deepEqual(source.candidates, []);
  assert.ok(source.pending.some(item => item.reason === 'pack_detail_section_mismatch'));
});

test('manual DOM receipts replay the same content and cannot forge an HTTP success or automatic mode', async () => {
  const rulesIdentity = await activeRules();
  const { source } = await collect({ rulesIdentity });
  const args = { receipt: source.receipt, rawPlayers: [], rawPacks: [], now: NOW, approval: fixtureApproval([mapping]), rulesIdentity };
  const replay = await replayCollectionReceipt(args);
  assert.deepEqual(replay, source);
  const status = structuredClone(source.receipt); status.requests[0].snapshot.status = 200;
  await assert.rejects(replayCollectionReceipt({ ...args, receipt: status }), /invalid snapshot metadata/);
  const automatic = structuredClone(source.receipt); automatic.schemaVersion = 1; delete automatic.mode;
  await assert.rejects(replayCollectionReceipt({ ...args, receipt: automatic }), /invalid snapshot metadata/);
});

test('manual collection keeps the fixed 30-source budget', async () => {
  await assert.rejects(collectCycle({ mappings: [], rawPlayers: [], rawPacks: [], rulesIdentity: RULES,
    manualCollection: true, maxRequests: 31 }), /invalid_request_budget/);
});

async function collectPaginated({ secondPageIds, secondPagePack = {}, secondPageUnavailable = false } = {}) {
  const ids = Array.from({ length: 40 }, (_, index) => String(index + 1).padStart(3, '0'));
  const pagesByUrl = pages(ids);
  const sourcePack = { ...pack, playerCount: 40 };
  const packUrl = 'https://efhub.com/packs/pack-a';
  const pageUrl = `${packUrl}?page=2`;
  const original = id => ({ ...player, id, name: `Player ${id}`, slug: `player-${id}`, imageUrl: `https://efimg.com/${id}.png` });
  const packPage = (page, memberIds, metadata) => doc(`<section><h1>Pack A</h1><p>29 October 2026·40 players</p><div class="grid">${memberIds.map(anchor).join('')}</div><nav aria-label="Pagination"><a class="${page === 1 ? 'bg-blue-600' : ''}" href="/packs/pack-a">1</a><a class="${page === 2 ? 'bg-blue-600' : ''}" href="/packs/pack-a?page=2">2</a></nav></section>${flight([{ pack: metadata }, ...memberIds.map(id => ({ player: original(id) }))])}`);
  pagesByUrl[packUrl] = packPage(1, ids.slice(0, 30), sourcePack);
  pagesByUrl[pageUrl] = packPage(2, secondPageIds ?? ids.slice(30), { ...sourcePack, ...secondPagePack });
  const calls = [];
  const reviewed = { ...mapping, expectedSpecialCount: 40, memberIds: ids };
  const result = await collectCycle({ mappings: [reviewed], rulesIdentity: RULES, rawPlayers: [], rawPacks: [], now: () => new Date(NOW), fetchHtml: async url => {
    calls.push(url);
    if (url === pageUrl && secondPageUnavailable) throw Object.assign(new Error('Temporary unavailable'), { code: 'source_http_error', status: 500 });
    assert.ok(Object.hasOwn(pagesByUrl, url), `Unexpected URL ${url}`);
    return { source_url: url, observed_at: NOW, status: 200, html: pagesByUrl[url] };
  } });
  return { result, calls, ids };
}

test('a 40-card pack joins both advertised HTML pages before producing one complete candidate', async () => {
  const { result, calls, ids } = await collectPaginated();
  assert.equal(result.candidates.length, 1, JSON.stringify(result.pending));
  assert.deepEqual(result.candidates[0].memberIds, ids);
  assert.equal(result.candidates[0].rawPlayers.length, 40);
  assert.equal(result.candidates[0].rawPack.playerCount, 40);
  assert.equal(calls.length, 4);
  assert.equal(result.receipt.requests.filter(request => request.url.includes('/packs/')).length, 2);
});

test('overlapping or missing cards on the second page cannot produce a complete pack', async () => {
  for (const ids of [['030', '031', '032', '033', '034', '035', '036', '037', '038', '039'], ['031', '032', '033', '034', '035', '036', '037', '038', '039']]) {
    const { result } = await collectPaginated({ secondPageIds: ids });
    assert.deepEqual(result.candidates, []);
    assert.ok(result.pending.some(item => item.reason === 'pack_pagination_membership_incomplete'), JSON.stringify(result.pending));
  }
});

test('pagination metadata changes or unavailable later pages preserve the pack as pending', async () => {
  for (const options of [{ secondPagePack: { date: '2026-10-28' } }, { secondPageUnavailable: true }]) {
    const { result } = await collectPaginated(options);
    assert.deepEqual(result.candidates, []);
    assert.ok(result.pending.some(item => ['pack_pagination_metadata_changed', 'source_http_error'].includes(item.reason)), JSON.stringify(result.pending));
  }
});


test('a complete single-page pack remains valid when its navigation advertises only page one', async () => {
  const { source, calls } = await collect({ mutate: snapshot => snapshot.source_url === 'https://efhub.com/packs/pack-a'
    ? domSnapshot(snapshot.source_url, snapshot.html.replace('</section>', '<nav aria-label="Pagination"><a class="bg-blue-600" href="/packs/pack-a">1</a></nav></section>'))
    : snapshot });
  assert.equal(source.candidates.length, 1, JSON.stringify(source.pending));
  assert.deepEqual(source.candidates[0].memberIds, ['001']);
  assert.equal(calls.length, 4);
});
