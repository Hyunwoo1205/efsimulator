import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { replayCollectionReceipt, baselineFingerprint } from '../scripts/lifecycle/collection-receipt.mjs';
import { sourceFixture } from './helpers/source-fixture.mjs';

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
