import { createHash } from 'node:crypto';
import { canonical, compareText, assertRawPack, assertRawPlayer } from '../../lib/catalog-contract.mjs';
import { parseOfficialHtml } from './html-sources.mjs';
import { activeRules, assertApprovedMappings } from './rules.mjs';
import { baselineFingerprint, receiptResultHash } from './collection-receipt.mjs';

const OFFICIAL = 'https://efootball-web.konami.net/probability_kr.php';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sha = value => createHash('sha256').update(value).digest('hex');
const ensure = (value, reason) => { if (!value) throw new Error(`Reviewed cache: ${reason}`); };
const fresh = (value, clock) => iso(value) && Date.parse(clock) - Date.parse(value) >= -60_000 && Date.parse(clock) - Date.parse(value) <= 2 * 60 * 60 * 1000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Hash the entire unmodified extraction response and its retrieval metadata. */
export const cachedEvidenceDigest = evidence => sha(canonical(evidence));

function resultText(result) {
  ensure(object(result) && result.isError !== true && Array.isArray(result.content) && result.content.length > 0, 'extractor returned no successful content');
  ensure(result.content.every(item => object(item) && item.type === 'text' && typeof item.text === 'string'), 'unsupported extractor content');
  const text = result.content.map(item => item.text).join('\n');
  ensure(Buffer.byteLength(text) > 0 && Buffer.byteLength(text) <= 8 * 1024 * 1024, 'extractor response byte budget');
  return text;
}

/**
 * Parse preserved search-provider HTML extractions. These are NOT raw HTML or
 * fresh origin responses. Only the exact pack-reference -> click-reference ->
 * decimal-card-URL chain is accepted; names never manufacture a card ID.
 */
export function parseCachedRosters(evidence) {
  ensure(exact(evidence, ['retrievedAt', 'packPages', 'rosterLinkResolutions']) && iso(evidence.retrievedAt), 'invalid cached evidence envelope');
  const resolved = new Map();
  const clickRefs = new Set();
  for (const block of resultText(evidence.rosterLinkResolutions).trim().split(/\n-{5,}\n/)) {
    const header = /^.*\((https:\/\/efhub\.com\/players\/(\d+))\)\n【([^】]+)】([^\n]*)/.exec(block.trim());
    ensure(header && /Content type: text\/html;/.test(header[4]), 'click response URL or HTML metadata is absent');
    ensure(!clickRefs.has(header[3]), 'duplicate click response reference'); clickRefs.add(header[3]);
    const clicked = /Source: click\((\{[^\n]+?\})\);/.exec(header[4]);
    ensure(clicked, 'click provenance is absent');
    let source;
    try { source = JSON.parse(clicked[1]); } catch { ensure(false, 'click provenance is not JSON'); }
    ensure(exact(source, ['ref_id', 'id']) && typeof source.ref_id === 'string' && Number.isSafeInteger(source.id) && source.id >= 0, 'click provenance shape differs');
    const key = `${source.ref_id}\0${source.id}`;
    ensure(!resolved.has(key), 'duplicate click resolution');
    resolved.set(key, { id: header[2], detailUrl: header[1] });
  }
  ensure(resolved.size > 0, 'no resolved card links');

  const rosters = [];
  const used = new Set();
  const packRefs = new Set();
  for (const block of resultText(evidence.packPages).trim().split(/\n-{5,}\n/)) {
    const header = /^.*\((https:\/\/efhub\.com\/packs\/([a-z\d-]+))\)\n【([^】]+)】([^\n]*)\n([\s\S]*)$/.exec(block.trim());
    ensure(header && /Content type: text\/html;/.test(header[4]) && /Source: open\(/.test(header[4]), 'pack URL or HTML extraction metadata is absent');
    ensure(!packRefs.has(header[3]), 'duplicate pack response reference'); packRefs.add(header[3]);
    const opened = /Source: open\((\{[^\n]+?\})\);/.exec(header[4]);
    let openSource;
    try { openSource = JSON.parse(opened?.[1]); } catch { ensure(false, 'pack open provenance is not JSON'); }
    ensure(exact(openSource, ['ref_id', 'lineno']) && typeof openSource.ref_id === 'string' && openSource.lineno === null, 'partial or invalid pack open provenance');
    // The extractor can open either a canonical URL or its own search result
    // reference. An explicit URL must agree with the reported canonical URL.
    ensure(openSource.ref_id === header[1] || /^turn\d+(?:search|view)\d+$/.test(openSource.ref_id), 'pack open URL contradicts its reported source');
    const total = /Total lines: (\d+)/.exec(header[4]);
    const sourceLines = [...header[5].matchAll(/^L(\d+): ?(.*)$/gm)];
    ensure(total && sourceLines.length === Number(total[1]) && sourceLines.every((line, index) => Number(line[1]) === index), 'pack extraction is truncated or has missing lines');
    const lines = sourceLines.map(line => line[2]);
    const headings = lines.filter(line => /^# /.test(line));
    ensure(headings.length === 1, 'pack title is absent or ambiguous');
    const title = headings[0].slice(2);
    const counts = lines.filter(line => /^\d{1,2} [A-Za-z]+ \d{4}·\d+ players$/.test(line));
    ensure(counts.length === 1, 'pack date/count is absent or ambiguous');
    const count = /^(\d{1,2}) ([A-Za-z]+) (\d{4})·(\d+) players$/.exec(counts[0]);
    const month = MONTHS.indexOf(count[2]) + 1;
    ensure(month > 0, 'unrecognized release month');
    const date = `${count[3]}-${String(month).padStart(2, '0')}-${count[1].padStart(2, '0')}`;
    ensure(Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().startsWith(date), 'invalid release date');
    const reportedCount = Number(count[4]);
    ensure(Number.isSafeInteger(reportedCount) && reportedCount > 0 && lines.some(line => /© \d{4} eFHUB/.test(line)) && lines.some(line => /Privacy Policy/.test(line)), 'pack completion marker is absent');
    const rosterLines = lines.filter(line => /【\d+†\d+(?:GK|CB|LB|RB|DMF|CMF|LMF|RMF|AMF|LWF|RWF|SS|CF) /.test(line));
    ensure(rosterLines.length === 1, 'pack roster boundary is absent or ambiguous');
    const cards = [...rosterLines[0].matchAll(/【(\d+)†(\d+)(GK|CB|LB|RB|DMF|CMF|LMF|RMF|AMF|LWF|RWF|SS|CF) ([^】]+)】/g)];
    ensure(cards.map(card => card[0]).join('') === rosterLines[0] && cards.length === reportedCount, 'declared count differs from complete card-link list');
    const members = cards.map(card => {
      const key = `${header[3]}\0${card[1]}`;
      ensure(resolved.has(key) && !used.has(key), 'missing or repeated exact roster click resolution');
      used.add(key);
      return { ...resolved.get(key), name: card[4], overallRating: Number(card[2]), position: card[3] };
    });
    ensure(new Set(members.map(member => member.id)).size === members.length, 'duplicate card ID in roster');
    rosters.push({ sourceUrl: header[1], packSlug: header[2], title, date, reportedCount, members,
      retrievedAt: evidence.retrievedAt, crawlLabel: /Crawled: ([^;]+);/.exec(header[4])?.[1] ?? null,
      evidenceSha256: cachedEvidenceDigest(evidence) });
  }
  ensure(rosters.length > 0 && new Set(rosters.map(roster => roster.packSlug)).size === rosters.length, 'missing or duplicate pack extraction');
  ensure(used.size === resolved.size, 'unused click evidence');
  return rosters.sort((a, b) => compareText(a.packSlug, b.packSlug));
}

function validateOfficialSnapshot(snapshot, clock) {
  ensure(exact(snapshot, ['source_url', 'observed_at', 'status', 'complete', 'bytes', 'sha256', 'html']), 'invalid official snapshot shape');
  ensure(snapshot.source_url === OFFICIAL && snapshot.status === 200 && snapshot.complete === true && fresh(snapshot.observed_at, clock), 'official snapshot is not a fresh complete origin response');
  ensure(typeof snapshot.html === 'string' && Buffer.byteLength(snapshot.html) <= 8 * 1024 * 1024 && snapshot.bytes === Buffer.byteLength(snapshot.html) && hex(snapshot.sha256) && sha(snapshot.html) === snapshot.sha256, 'official HTML bytes/hash differ');
  const parsed = parseOfficialHtml(snapshot.html, { sourceUrl: OFFICIAL, observedAt: snapshot.observed_at });
  return { ...parsed, status: 'ok', observedAt: parsed.observed_at, sourceUrl: parsed.source_url, url: parsed.source_url, rows: parsed.records };
}

/** Explicit reviewed import of retained cards; never fetches or appends raw. */
export async function collectReviewedCache({ mappingsDocument, rawPlayers, rawPacks, cachedEvidence, officialSnapshot, checkedAt, rulesIdentity, approval } = {}) {
  ensure(iso(checkedAt) && Array.isArray(rawPlayers) && Array.isArray(rawPacks), 'invalid baseline or execution clock');
  const rules = await activeRules();
  ensure(!rulesIdentity || canonical(rulesIdentity) === canonical(rules), 'rules identity differs');
  assertApprovedMappings(mappingsDocument, approval);
  const officialObservation = validateOfficialSnapshot(officialSnapshot, checkedAt);
  ensure(Array.isArray(cachedEvidence) && cachedEvidence.length > 0, 'cached extraction evidence is required');
  const orderedEvidence = [...cachedEvidence].sort((a, b) => compareText(cachedEvidenceDigest(a), cachedEvidenceDigest(b)));
  const rosters = orderedEvidence.flatMap(evidence => {
    ensure(fresh(evidence.retrievedAt, checkedAt), 'cached retrieval timestamp is stale');
    return parseCachedRosters(evidence);
  }).sort((a, b) => compareText(a.packSlug, b.packSlug));
  ensure(new Set(rosters.map(roster => roster.packSlug)).size === rosters.length, 'duplicate cached pack evidence');
  const playerMap = new Map(rawPlayers.map(player => [player.id, player]));
  const packMap = new Map(rawPacks.filter(pack => pack.slug).map(pack => [pack.slug, pack]));
  ensure(playerMap.size === rawPlayers.length, 'duplicate baseline card IDs');
  const candidates = rosters.map(roster => {
    const mappings = mappingsDocument.mappings.filter(mapping => mapping.packSlug === roster.packSlug);
    ensure(mappings.length === 1, 'cache pack is not explicitly reviewed');
    const mapping = mappings[0];
    ensure(mapping.matchEvidence.cachedEvidenceSha256 === roster.evidenceSha256, 'reviewed evidence hash differs');
    const pack = packMap.get(roster.packSlug);
    assertRawPack(pack);
    ensure(pack.name === roster.title && pack.date === roster.date && pack.playerCount === roster.reportedCount, 'cache pack metadata differs from retained raw');
    ensure(mapping.expectedSpecialCount === roster.members.length && mapping.memberIds.length === roster.members.length && mapping.memberIds.every(id => roster.members.some(member => member.id === id)), 'reviewed membership differs from complete cached links');
    for (const member of roster.members) {
      const player = playerMap.get(member.id);
      ensure(player, 'cached member is missing from retained raw');
      assertRawPlayer(player, member.id);
      ensure(player.name === member.name && player.overallRating === member.overallRating && player.position === member.position, 'cached member display fields differ from retained raw');
    }
    const officialMatches = officialObservation.rows.filter(row => row.title === mapping.officialTitle);
    ensure(officialMatches.length === 1, 'official sale is missing or ambiguous');
    const official = officialMatches[0];
    ensure(Date.parse(official.endsAt) > Date.parse(checkedAt) && official.endsAt === mapping.expectedEndsAt.replace('.000Z', 'Z') && official.totalPlayerCount === mapping.expectedTotalPlayerCount, 'official release guards differ');
    const memberIds = roster.members.map(member => member.id).sort(compareText);
    return { saleId: mapping.saleId, officialTitle: official.title, packSlug: pack.slug, endsAt: official.endsAt,
      totalPlayerCount: official.totalPlayerCount, specialCount: memberIds.length, expectedSpecialCount: memberIds.length,
      memberIds, rawPlayers: [], rawPack: structuredClone(pack), matchVerified: true, membershipComplete: true,
      countCorrection: mapping.countCorrection ?? null,
      evidence: { match: mapping.matchEvidence,
        official: { sourceUrl: OFFICIAL, observedAt: officialObservation.observedAt, sha256: officialObservation.sha256 },
        efhub: { sourceUrl: roster.sourceUrl, sourceKind: 'reviewed_cached_html_extraction', retrievedAt: roster.retrievedAt,
          originObservedAt: null, crawlLabel: roster.crawlLabel, evidenceSha256: roster.evidenceSha256,
          freshness: 'Exact historical release membership; origin was not requested or declared fresh.' }, memberIds } };
  }).sort((a, b) => compareText(a.saleId, b.saleId));
  const knownTitles = new Set(mappingsDocument.mappings.map(mapping => mapping.officialTitle));
  const pending = officialObservation.rows.filter(row => !knownTitles.has(row.title)).map(row => ({ officialTitle: row.title, endsAt: row.endsAt, reason: 'unmapped_official_product' })).sort((a, b) => compareText(a.officialTitle, b.officialTitle));
  const result = { checkedAt, officialObservation, candidates, pending, sources: [
    { source_url: OFFICIAL, observed_at: officialSnapshot.observed_at, status: 'ok', complete: true, bytes: officialSnapshot.bytes, sha256: officialSnapshot.sha256 },
    ...rosters.map(roster => ({ source_url: roster.sourceUrl, status: 'cached', source_kind: 'reviewed_cached_html_extraction', retrieved_at: roster.retrievedAt, origin_observed_at: null, crawl_label: roster.crawlLabel, evidence_sha256: roster.evidenceSha256, complete: true })),
  ], requestCount: 0 };
  result.receipt = { schemaVersion: 2, kind: 'reviewed_cached_html', checkedAt, rulesIdentity: rules,
    mappingsDocument: structuredClone(mappingsDocument), baselineSha256: baselineFingerprint(rawPlayers, rawPacks),
    cachedEvidence: structuredClone(orderedEvidence), officialSnapshot: structuredClone(officialSnapshot), resultSha256: receiptResultHash(result) };
  return result;
}

export async function replayReviewedCacheReceipt({ receipt, rawPlayers, rawPacks, now, approval, rulesIdentity } = {}) {
  ensure(exact(receipt, ['schemaVersion', 'kind', 'checkedAt', 'rulesIdentity', 'mappingsDocument', 'baselineSha256', 'cachedEvidence', 'officialSnapshot', 'resultSha256']) && receipt.schemaVersion === 2 && receipt.kind === 'reviewed_cached_html', 'unsupported receipt schema');
  ensure(iso(now) && now === receipt.checkedAt, 'execution clock differs');
  ensure(hex(receipt.baselineSha256) && receipt.baselineSha256 === baselineFingerprint(rawPlayers, rawPacks), 'raw baseline differs');
  ensure(hex(receipt.resultSha256), 'invalid result hash');
  if (rulesIdentity) ensure(canonical(receipt.rulesIdentity) === canonical(rulesIdentity), 'workspace rules identity differs');
  const replay = await collectReviewedCache({ ...receipt, rawPlayers, rawPacks, approval });
  ensure(receipt.resultSha256 === receiptResultHash(replay), 'recomputed result differs');
  return replay;
}
