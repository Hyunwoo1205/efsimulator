import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cachedEvidenceDigest, parseCachedRosters, collectReviewedCache } from '../scripts/lifecycle/reviewed-cache.mjs';
import { replayCollectionReceipt } from '../scripts/lifecycle/collection-receipt.mjs';
import { fixtureApproval } from './helpers/source-fixture.mjs';

const NOW = '2026-10-27T16:00:00.000Z';
const END = '2026-11-02T01:59:59.000Z';
const OFFICIAL = 'https://efootball-web.konami.net/probability_kr.php';
const player = (id, position, overallRating) => ({ id, name: `Player ${id}`, slug: `player-${id}`, position, overallRating,
  nameJa: '', nameZh: '', nationality: '', nationalityCode: '', team: '', imageUrl: `https://efimg.com/${id}.png`, playerType: 5 });
const rawPlayers = [player('001', 'CF', 85), player('002', 'CB', 82)];
const rawPacks = [{ name: 'Pack A', slug: 'pack-a', date: '2026-10-26', playerCount: 2 }];
const wrapped = text => ({ content: [{ type: 'text', text }], isError: false });
const divider = '\n\n--------------------------------------------------------------------------------\n';
function evidenceFixture() {
  const lines = ['eFHUB', '# Pack A', '26 October 2026·2 players', '【12†85CF Player 001】【13†82CB Player 002】', '© 2026 eFHUB. All rights reserved.', '【14†Privacy Policy】'];
  return { retrievedAt: NOW,
    packPages: wrapped(`Pack A | eFHUB (https://efhub.com/packs/pack-a)\n【fixturepack0】 [wordlim: 200] Crawled: last month; Content type: text/html; Source: open({"ref_id":"https://efhub.com/packs/pack-a","lineno":null}); Total lines: ${lines.length}\n${lines.map((line, index) => `L${index}: ${line}`).join('\n')}\n`),
    rosterLinkResolutions: wrapped(rawPlayers.map((p, index) => `efhub.com (https://efhub.com/players/${p.id})\n【fixturecard${index}】 [wordlim: 200] Crawled: last month; Content type: text/html; Source: click({"ref_id":"fixturepack0","id":${12 + index}}); Total lines: 400\n`).join(divider)),
  };
}
function fixture() {
  const evidence = evidenceFixture();
  const mapping = { saleId: 'pack-a::2026-10', packSlug: 'pack-a', officialTitle: 'Official A', newPlayersSection: 'Pack A',
    expectedEndsAt: END, expectedTotalPlayerCount: 150, expectedSpecialCount: 2, memberIds: ['001', '002'],
    matchEvidence: { authority: 'synthetic_test_fixture', cachedEvidenceSha256: cachedEvidenceDigest(evidence) } };
  const mappingsDocument = { schemaVersion: 1, mappings: [mapping] };
  const html = `<html><head></head><body><dl class="probability"><dt>선수 영입 확률</dt><dd><div class="probability_data"><p class="data_title">Official A</p><p>종료 일시(UTC)：2026-11-02 01:59:59</p><p>처음 영입할 때의 선수 수：150</p><p>처음 영입할 때의 영입 확률：0.6667%</p></div><div>주의 사항</div></dd></dl></body></html>`;
  const officialSnapshot = { source_url: OFFICIAL, observed_at: NOW, status: 200, complete: true, html,
    bytes: Buffer.byteLength(html), sha256: createHash('sha256').update(html).digest('hex') };
  return { mappingsDocument, rawPlayers: structuredClone(rawPlayers), rawPacks: structuredClone(rawPacks), cachedEvidence: [evidence], officialSnapshot, checkedAt: NOW, approval: fixtureApproval(mappingsDocument.mappings) };
}

test('cached HTML extraction preserves string IDs and original crawl metadata without creating HTML', () => {
  const entry = evidenceFixture();
  const rosters = parseCachedRosters(entry);
  assert.equal(rosters.length, 1);
  assert.deepEqual(rosters[0].members.map(member => member.id), ['001', '002']);
  assert.equal(rosters[0].crawlLabel, 'last month');
  assert.equal(rosters[0].retrievedAt, NOW);
  assert.equal(rosters[0].evidenceSha256, cachedEvidenceDigest(entry));
  assert.equal(rosters[0].date, '2026-10-26');
  assert.equal(Object.hasOwn(rosters[0], 'html'), false);
});

test('cached roster requires complete extraction lines, footer, and exact stated card count', () => {
  const missing = evidenceFixture();
  missing.packPages.content[0].text = missing.packPages.content[0].text.replace('L5: 【14†Privacy Policy】\n', '');
  assert.throws(() => parseCachedRosters(missing), /truncated|missing lines/);
  const count = evidenceFixture();
  count.packPages.content[0].text = count.packPages.content[0].text.replace('·2 players', '·3 players');
  assert.throws(() => parseCachedRosters(count), /declared count/);
  const footer = evidenceFixture();
  footer.packPages.content[0].text = footer.packPages.content[0].text.replace('Privacy Policy', 'Not completed');
  assert.throws(() => parseCachedRosters(footer), /completion marker/);
});

test('each roster link must resolve through its own exact pack reference and click number', () => {
  const missing = evidenceFixture();
  missing.rosterLinkResolutions.content[0].text = missing.rosterLinkResolutions.content[0].text.split(divider)[0];
  assert.throws(() => parseCachedRosters(missing), /missing or repeated/);
  const wrong = evidenceFixture();
  wrong.rosterLinkResolutions.content[0].text = wrong.rosterLinkResolutions.content[0].text.replaceAll('fixturepack0', 'differentpack');
  assert.throws(() => parseCachedRosters(wrong), /missing or repeated/);
  const contradiction = evidenceFixture();
  contradiction.packPages.content[0].text = contradiction.packPages.content[0].text.replace('"ref_id":"https://efhub.com/packs/pack-a"', '"ref_id":"https://evil.example/unrelated"');
  assert.throws(() => parseCachedRosters(contradiction), /contradicts/);
  const partial = evidenceFixture();
  partial.packPages.content[0].text = partial.packPages.content[0].text.replace('"lineno":null', '"lineno":12');
  assert.throws(() => parseCachedRosters(partial), /partial or invalid/);
});

test('cached roster rejects duplicate IDs, ambiguous click resolutions and unrelated extra clicks', () => {
  const duplicateId = evidenceFixture();
  duplicateId.rosterLinkResolutions.content[0].text = duplicateId.rosterLinkResolutions.content[0].text.replace('/players/002', '/players/001');
  assert.throws(() => parseCachedRosters(duplicateId), /duplicate card ID/);
  const duplicateLink = evidenceFixture();
  duplicateLink.rosterLinkResolutions.content[0].text = duplicateLink.rosterLinkResolutions.content[0].text.replace('"id":13', '"id":12');
  assert.throws(() => parseCachedRosters(duplicateLink), /duplicate click resolution/);
  const extra = evidenceFixture();
  extra.rosterLinkResolutions.content[0].text += `${divider}efhub.com (https://efhub.com/players/003)\n【othercard】 Content type: text/html; Source: click({"ref_id":"fixturepack0","id":30}); Total lines: 15\n`;
  assert.throws(() => parseCachedRosters(extra), /unused click/);
});

test('reviewed import and receipt replay reproduce candidates from cached links and retained raw only', async () => {
  const f = fixture();
  const source = await collectReviewedCache(f);
  const replay = await replayCollectionReceipt({ ...f, receipt: source.receipt, now: NOW });
  assert.deepEqual(replay, source);
  assert.deepEqual((await collectReviewedCache(f)), source);
  assert.deepEqual(source.candidates[0].rawPlayers, []);
  assert.equal(source.requestCount, 0);
  assert.equal(source.sources[1].status, 'cached');
  assert.equal(source.sources[1].origin_observed_at, null);
  assert.equal(source.candidates[0].evidence.efhub.originObservedAt, null);
  assert.equal(source.receipt.schemaVersion, 2);
});

test('reviewed cache rejects raw IDs and display fields that do not match the exact linked cards', async () => {
  const missing = fixture(); missing.rawPlayers.pop();
  await assert.rejects(collectReviewedCache(missing), /missing from retained raw/);
  const renamed = fixture(); renamed.rawPlayers[0].name = 'Wrong';
  await assert.rejects(collectReviewedCache(renamed), /display fields differ/);
  const rating = fixture(); rating.rawPlayers[0].overallRating = 99;
  await assert.rejects(collectReviewedCache(rating), /display fields differ/);
  const pack = fixture(); pack.rawPacks[0].date = '2026-10-25';
  await assert.rejects(collectReviewedCache(pack), /pack metadata differs/);
});

test('changed extraction bytes and changed mappings require new reviewed hash bindings', async () => {
  const bytes = fixture(); bytes.cachedEvidence[0].packPages.content[0].text += '\n';
  await assert.rejects(collectReviewedCache(bytes), /reviewed evidence hash differs/);
  const mapping = fixture(); mapping.mappingsDocument.mappings[0].memberIds = ['001', '003'];
  await assert.rejects(collectReviewedCache(mapping), /Unreviewed or changed mapping/);
});

test('cached receipt refuses other baselines, clocks, hashes and extra verification flags', async () => {
  const f = fixture(); const source = await collectReviewedCache(f);
  const args = { ...f, receipt: source.receipt, now: NOW };
  await assert.rejects(replayCollectionReceipt({ ...args, rawPlayers: [...f.rawPlayers].reverse() }), /raw baseline differs/);
  await assert.rejects(replayCollectionReceipt({ ...args, now: '2026-10-27T16:00:01.000Z' }), /execution clock differs/);
  const hash = structuredClone(source.receipt); hash.resultSha256 = '0'.repeat(64);
  await assert.rejects(replayCollectionReceipt({ ...args, receipt: hash }), /recomputed result differs/);
  await assert.rejects(replayCollectionReceipt({ ...args, receipt: { ...source.receipt, matchVerified: true } }), /unsupported receipt schema/);
});

test('cached historical membership never makes stale official sale data fresh', async () => {
  const stale = fixture(); stale.officialSnapshot.observed_at = '2026-10-27T12:00:00.000Z';
  await assert.rejects(collectReviewedCache(stale), /fresh complete origin/);
  const cache = fixture(); cache.cachedEvidence[0].retrievedAt = '2026-10-27T12:00:00.000Z';
  await assert.rejects(collectReviewedCache(cache), /retrieval timestamp is stale/);
  const content = fixture(); content.officialSnapshot.html += 'edited';
  await assert.rejects(collectReviewedCache(content), /official HTML bytes\/hash differ/);
});
