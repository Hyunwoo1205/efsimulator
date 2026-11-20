import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { collectCycle } from '../scripts/lifecycle/collect-cycle.mjs';
import { replayCollectionReceipt, baselineFingerprint } from '../scripts/lifecycle/collection-receipt.mjs';
import { activeRules } from '../scripts/lifecycle/rules.mjs';
import { sourceFixture, fixtureApproval } from './helpers/source-fixture.mjs';

const NOW = '2026-10-27T00:00:00.000Z';
const END = '2026-11-02T01:59:59.000Z';
const player = id => ({ id, name: `Player ${id}`, nameJa: '', nameZh: '', slug: `player-${id}`, nationality: '', nationalityCode: '', team: '', position: 'CF', overallRating: 85, imageUrl: `https://efimg.com/${id}.png`, playerType: 5 });
const pack = { name: 'Pack A', slug: 'pack-a', date: '2026-10-26', playerCount: 1 };
async function fixture({ failed = false } = {}) {
  const rawPlayers = []; const rawPacks = [];
  const candidate = { saleId: 'sale-a', packSlug: pack.slug, officialTitle: 'Official A', totalPlayerCount: 150, endsAt: END,
    memberIds: ['001'], expectedSpecialCount: 1, rawPlayers: [player('001')], rawPack: pack, evidence: { source: 'synthetic' } };
  const officialObservation = failed ? { status: 'error', complete: false } : { status: 'ok', complete: true, observedAt: NOW, rows: [{ title: candidate.officialTitle, totalPlayerCount: 150, endsAt: END }] };
  const source = await sourceFixture({ rawPlayers, rawPacks, candidates: [candidate], officialObservation, now: NOW });
  return { ...source, rawPlayers, rawPacks, now: NOW };
}

const OFFICIAL = 'https://efootball-web.konami.net/probability_kr.php';
const NEW_PLAYERS = 'https://efhub.com/new-players';
const HISTORICAL_NOW = '2026-10-29T12:00:00.000Z';
const HISTORICAL_OBSERVED_AT = '2026-10-28T00:30:00.000Z';
const HISTORICAL_END = '2026-10-28T01:59:59.000Z';
const CURRENT_END = '2026-11-05T01:59:59.000Z';
const document = body => `<html><head></head><body>${body}</body></html>`;
const flight = value => `<script>self.__next_f.push(${JSON.stringify([1, `a:${JSON.stringify(value)}\n`])})</script>`;
const anchor = id => `<a href="/players/${id}"><p>Player ${id}</p></a>`;
const snapshot = (sourceUrl, html, observedAt = HISTORICAL_OBSERVED_AT) => ({ source_url: sourceUrl, observed_at: observedAt,
  status: null, source_kind: 'browser_dom', complete: true, bytes: Buffer.byteLength(html),
  sha256: createHash('sha256').update(html).digest('hex'), html });
const officialHtml = rows => document(`<dl class="probability"><dt>선수 영입 확률</dt><dd>${rows.map(row => `<div class="probability_data"><p class="data_title">${row.title}</p><p>종료 일시(UTC)：${new Date(row.endsAt).toISOString().replace('T', ' ').slice(0, 19)}</p><p>처음 영입할 때의 선수 수：${row.totalPlayerCount}</p><p>처음 영입할 때의 영입 확률：1.0000%</p></div>`).join('')}<div class="probability_ntc_msg">주의 사항</div></dd></dl>`);

async function historicalReceiptFixture() {
  const currentPlayer = player('101');
  const historicalPlayers = [player('201'), player('202')];
  const currentPack = { name: 'Current Pack', slug: 'current-pack', date: '2026-10-29', playerCount: 1 };
  const historicalPack = { name: 'Historical Pack', slug: 'historical-pack', date: '2026-10-27', playerCount: 1 };
  const historicalUrls = { pack: 'https://efhub.com/packs/historical-pack', player: 'https://efhub.com/players/202' };
  const historicalSnapshots = {
    official: snapshot(OFFICIAL, officialHtml([{ title: 'Historical Official', totalPlayerCount: 100, endsAt: HISTORICAL_END }])),
    listing: snapshot(NEW_PLAYERS, document(`<h1>New Players</h1><section><h2><a href="/packs/historical-pack">Historical Section</a></h2><div>${historicalPlayers.map(({ id }) => anchor(id)).join('')}</div></section>`), '2026-10-28T00:31:00.000Z'),
    pack: snapshot(historicalUrls.pack, document(`<section><h1>Historical Pack</h1><p>27 October 2026·1 player</p><div class="grid">${anchor('201')}</div></section>${flight([{ pack: historicalPack }, { player: historicalPlayers[0] }])}`), '2026-10-28T00:32:00.000Z'),
    player: snapshot(historicalUrls.player, document(`<h1>Player 202</h1>${flight({ player: historicalPlayers[1] })}`), '2026-10-28T00:33:00.000Z'),
  };
  const historicalMapping = { saleId: 'historical-sale', officialTitle: 'Historical Official', packSlug: historicalPack.slug,
    newPlayersSection: 'Historical Section', expectedEndsAt: HISTORICAL_END, expectedTotalPlayerCount: 100,
    expectedSpecialCount: 2, memberIds: historicalPlayers.map(({ id }) => id),
    countCorrection: { status: 'user_confirmed', reason: 'Synthetic historical correction', effectiveCount: 2 },
    matchEvidence: { reviewed: 'Synthetic ended-round fixture', official: { observedAt: historicalSnapshots.official.observed_at },
      newPlayers: { observedAt: historicalSnapshots.listing.observed_at },
      pack: { observedAt: historicalSnapshots.pack.observed_at, originalPlayerCount: 1 },
      historicalArchive: { officialSha256: historicalSnapshots.official.sha256, listingSha256: historicalSnapshots.listing.sha256,
        packSha256: historicalSnapshots.pack.sha256, playerDetailSha256: { 202: historicalSnapshots.player.sha256 } } } };
  const currentMapping = { saleId: 'current-sale', officialTitle: 'Current Official', packSlug: currentPack.slug,
    newPlayersSection: 'Current Section', expectedEndsAt: CURRENT_END, expectedTotalPlayerCount: 150,
    expectedSpecialCount: 1, memberIds: [currentPlayer.id], matchEvidence: { reviewed: 'Synthetic current-round fixture' } };
  const mappings = [currentMapping, historicalMapping];
  const currentPages = {
    [OFFICIAL]: officialHtml([{ title: currentMapping.officialTitle, totalPlayerCount: 150, endsAt: CURRENT_END }]),
    [NEW_PLAYERS]: document(`<h1>New Players</h1><section><h2><a href="/packs/current-pack">Current Section</a></h2><div>${anchor(currentPlayer.id)}</div></section>`),
  };
  const historicalArchive = { saleId: historicalMapping.saleId, official: historicalSnapshots.official,
    listing: historicalSnapshots.listing, pack: historicalSnapshots.pack, playerDetails: [historicalSnapshots.player] };
  const rulesIdentity = await activeRules();
  const rawPlayers = [currentPlayer]; const rawPacks = [currentPack];
  const source = await collectCycle({ mappings, mappingsDocument: { schemaVersion: 1, mappings }, rawPlayers, rawPacks,
    rulesIdentity, manualCollection: true, historicalArchive, now: () => new Date(HISTORICAL_NOW), fetchHtml: async url => {
      assert.ok(Object.hasOwn(currentPages, url), `Unexpected current URL ${url}`);
      return snapshot(url, currentPages[url], HISTORICAL_NOW);
    } });
  return { source, mappings, rawPlayers, rawPacks, rulesIdentity,
    replay: { receipt: source.receipt, rawPlayers, rawPacks, now: HISTORICAL_NOW, approval: fixtureApproval(mappings), rulesIdentity } };
}

test('an HTML receipt independently reproduces candidates and observations without fetching the network', async () => {
  const f = await fixture();
  assert.equal(f.candidates.length, 1);
  const first = await replayCollectionReceipt(f);
  const second = await replayCollectionReceipt(f);
  assert.deepEqual(first, second);
  assert.deepEqual(first.candidates, f.candidates);
  assert.deepEqual(first.officialObservation, f.officialObservation);
  assert.deepEqual(first.receipt, f.receipt);
  assert.equal(first.requestCount, f.receipt.requests.length);
});

test('schema 4 replays fresh current evidence with a separately bound ended-sale archive', async () => {
  const f = await historicalReceiptFixture();
  assert.equal(f.source.receipt.schemaVersion, 4);
  assert.equal(f.source.receipt.mode, 'manual');
  assert.equal(f.source.receipt.requests.length, 2, 'historical snapshots must not become ordinary current requests');
  const replay = await replayCollectionReceipt(f.replay);
  assert.deepEqual(replay, f.source);
  assert.equal(replay.candidates.length, 2);
  assert.equal(replay.candidates.find(candidate => candidate.saleId === 'current-sale').evidence.historicalArchive, undefined);
  assert.equal(replay.candidates.find(candidate => candidate.saleId === 'historical-sale').evidence.historicalArchive, true);
  assert.deepEqual(Object.keys(replay.historicalOfficial), ['historical-sale']);
});

test('schema 4 rejects a bound historical observation made after the archived sale ended', async () => {
  const f = await historicalReceiptFixture();
  const receipt = structuredClone(f.source.receipt);
  const invalidObservedAt = '2026-10-28T02:00:00.000Z';
  receipt.historicalArchive.official.observed_at = invalidObservedAt;
  const historicalMapping = receipt.mappingsDocument.mappings.find(mapping => mapping.saleId === 'historical-sale');
  historicalMapping.matchEvidence.official.observedAt = invalidObservedAt;
  await assert.rejects(replayCollectionReceipt({ ...f.replay, receipt,
    approval: fixtureApproval(receipt.mappingsDocument.mappings) }), /historical_archive_observation_after_sale/);
});

test('schema 4 keeps the ordinary current-request freshness limit', async () => {
  const f = await historicalReceiptFixture();
  const receipt = structuredClone(f.source.receipt);
  receipt.requests[0].snapshot.observed_at = '2026-10-29T09:59:59.000Z';
  await assert.rejects(replayCollectionReceipt({ ...f.replay, receipt }), /snapshot timestamp is stale/);
});

test('baseline and clock identity prevent applying a receipt to another generation or execution time', async () => {
  const f = await fixture();
  await assert.rejects(replayCollectionReceipt({ ...f, rawPlayers: [player('002')] }), /raw baseline differs/);
  await assert.rejects(replayCollectionReceipt({ ...f, now: '2026-10-27T01:00:00.000Z' }), /execution clock differs/);
  const reversedKeys = Object.fromEntries(Object.entries(player('002')).reverse());
  assert.equal(baselineFingerprint([player('002')], []), baselineFingerprint([reversedKeys], []));
});

test('changed mappings and forged verification result hashes cannot authorize a different collection', async () => {
  const f = await fixture();
  const changedMapping = structuredClone(f.receipt);
  changedMapping.mappingsDocument.mappings[0].memberIds = ['002'];
  await assert.rejects(replayCollectionReceipt({ ...f, receipt: changedMapping }), /Unreviewed or changed mapping/);
  const changedResult = structuredClone(f.receipt); changedResult.resultSha256 = '0'.repeat(64);
  await assert.rejects(replayCollectionReceipt({ ...f, receipt: changedResult }), /recomputed result differs/);
  const changedRules = structuredClone(f.receipt); changedRules.rulesIdentity.sha256 = '0'.repeat(64);
  await assert.rejects(replayCollectionReceipt({ ...f, receipt: changedRules }), /rules identity differs/);
});

test('HTML edits, including edits with recomputed source hash, require recomputing the verified result', async () => {
  const f = await fixture();
  const changed = structuredClone(f.receipt);
  const snapshot = changed.requests.find(request => request.snapshot?.source_url.includes('efhub.com')).snapshot;
  snapshot.html = snapshot.html.replaceAll('Player 001', 'Wrong Player');
  await assert.rejects(replayCollectionReceipt({ ...f, receipt: changed }), /HTML bytes\/hash differ/);
  snapshot.bytes = Buffer.byteLength(snapshot.html); snapshot.sha256 = createHash('sha256').update(snapshot.html).digest('hex');
  await assert.rejects(replayCollectionReceipt({ ...f, receipt: changed }), /recomputed result differs/);
});

test('receipt replay rejects partial documents, API URLs, unused requests and unexpected envelope fields', async () => {
  const f = await fixture();
  const partial = structuredClone(f.receipt); partial.requests[0].snapshot.html = '<html><body>';
  partial.requests[0].snapshot.bytes = Buffer.byteLength(partial.requests[0].snapshot.html);
  partial.requests[0].snapshot.sha256 = createHash('sha256').update(partial.requests[0].snapshot.html).digest('hex');
  await assert.rejects(replayCollectionReceipt({ ...f, receipt: partial }), /recomputed result differs/);
  const api = structuredClone(f.receipt); api.requests[0].url = 'https://efhub.com/api/players';
  await assert.rejects(replayCollectionReceipt({ ...f, receipt: api }), /API requests are forbidden/);
  const unused = structuredClone(f.receipt); unused.requests.push({ url: 'https://efhub.com/players/002', error: { code: 'source_fetch_failed', message: 'unused', status: null, observed_at: NOW } });
  await assert.rejects(replayCollectionReceipt({ ...f, receipt: unused }), /unused source evidence/);
  await assert.rejects(replayCollectionReceipt({ ...f, receipt: { ...f.receipt, matchVerified: true } }), /unsupported schema/);
});

test('explicit source failures are replayed as failures rather than empty successful observations', async () => {
  const f = await fixture({ failed: true });
  assert.equal(f.receipt.requests[0].error.code, 'source_fetch_failed');
  const replay = await replayCollectionReceipt(f);
  assert.equal(replay.officialObservation.status, 'error');
  assert.equal(replay.officialObservation.complete, false);
  assert.deepEqual(replay.candidates, []);
  assert.ok(replay.pending.some(pending => pending.reason === 'official_source_unavailable'));
});

test('failure timestamps use the same canonical UTC metadata during collection and offline replay', async () => {
  const { collectCycle } = await import('../scripts/lifecycle/collect-cycle.mjs');
  const source = await collectCycle({ mappings: [], rawPlayers: [], rawPacks: [], now: () => new Date(NOW), fetchHtml: async () => {
    throw Object.assign(new Error('Synthetic unavailable'), { code: 'source_fetch_failed', observed_at: '2026-10-27T09:00:00+09:00' });
  } });
  const replay = await replayCollectionReceipt({ ...source, rawPlayers: [], rawPacks: [], now: NOW, approval: { schemaVersion: 1, reviews: [] } });
  assert.deepEqual(replay.sources, source.sources);
  assert.equal(source.sources[0].observed_at, NOW);
});
