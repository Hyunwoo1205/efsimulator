import { createHash } from 'node:crypto';
import { fetchHtmlSnapshot, parseNewPlayersHtml, parseOfficialHtml, parsePackMembershipHtml, parsePlayerHtml, validateHtmlSourceUrl } from './html-sources.mjs';
import { assertRawPlayer, assertRawPack, canonical, compareText } from '../../lib/catalog-contract.mjs';
import { makeCollectionReceipt, receiptResultHash } from './collection-receipt.mjs';
import { activeRules } from './rules.mjs';

const OFFICIAL = 'https://efootball-web.konami.net/probability_kr.php';
const NEW_PLAYERS = 'https://efhub.com/new-players';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const exact = (value, keys) => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const ensure = (condition, reason) => { if (!condition) throw Object.assign(new Error(reason), { code: reason }); };
const sourceMeta = source => {
  const { html: _html, ...metadata } = source;
  return metadata;
};

function expectedSpecialCount(mapping, pack) {
  const correction = mapping.countCorrection;
  const corrected = correction?.effectiveCount ?? correction?.effectiveMemberCount ?? correction?.effective_member_count;
  if (corrected !== undefined) {
    ensure(correction.userConfirmed === true || correction.status === 'user_confirmed' || correction.correctionStatus === 'user_confirmed', 'unconfirmed_count_correction');
    ensure(Number.isSafeInteger(corrected) && corrected > 0, 'invalid_special_count');
    return corrected;
  }
  const count = mapping.expectedSpecialCount ?? pack.playerCount;
  ensure(Number.isSafeInteger(count) && count > 0 && count === pack.playerCount, 'special_count_needs_correction');
  return count;
}

function historicalSnapshot(value, expectedUrl) {
  ensure(exact(value, ['source_url', 'observed_at', 'status', 'source_kind', 'complete', 'bytes', 'sha256', 'html']), 'invalid_historical_snapshot_shape');
  validateHtmlSourceUrl(value.source_url);
  ensure(value.source_url === expectedUrl && value.source_kind === 'browser_dom' && value.status === null
    && value.complete === true && iso(value.observed_at), 'invalid_historical_snapshot_metadata');
  const bytes = Buffer.byteLength(value.html ?? '');
  const sha256 = createHash('sha256').update(value.html ?? '').digest('hex');
  ensure(typeof value.html === 'string' && bytes > 0 && bytes <= 8 * 1024 * 1024
    && value.bytes === bytes && hex(value.sha256) && value.sha256 === sha256, 'historical_snapshot_bytes_or_hash_differ');
  return structuredClone(value);
}

function prepareHistoricalArchive({ historicalArchive, mappings, startedAt }) {
  if (historicalArchive === null || historicalArchive === undefined) return null;
  ensure(exact(historicalArchive, ['saleId', 'official', 'listing', 'pack', 'playerDetails'])
    && text(historicalArchive.saleId) && Array.isArray(historicalArchive.playerDetails), 'invalid_historical_archive_envelope');
  const matches = mappings.filter(mapping => mapping.saleId === historicalArchive.saleId);
  ensure(matches.length === 1, 'historical_archive_sale_not_exactly_mapped');
  const mapping = matches[0];
  ensure(object(mapping.countCorrection), 'historical_archive_requires_count_correction');
  const binding = mapping.matchEvidence?.historicalArchive;
  ensure(exact(binding, ['officialSha256', 'listingSha256', 'packSha256', 'playerDetailSha256'])
    && hex(binding.officialSha256) && hex(binding.listingSha256) && hex(binding.packSha256)
    && object(binding.playerDetailSha256), 'invalid_historical_archive_binding');

  const expectedPackUrl = `https://efhub.com/packs/${mapping.packSlug}`;
  const officialSnapshot = historicalSnapshot(historicalArchive.official, OFFICIAL);
  const listingSnapshot = historicalSnapshot(historicalArchive.listing, NEW_PLAYERS);
  const packSnapshot = historicalSnapshot(historicalArchive.pack, expectedPackUrl);
  ensure(officialSnapshot.sha256 === binding.officialSha256 && listingSnapshot.sha256 === binding.listingSha256
    && packSnapshot.sha256 === binding.packSha256, 'historical_archive_binding_hash_differs');
  ensure(officialSnapshot.observed_at === mapping.matchEvidence?.official?.observedAt
    && listingSnapshot.observed_at === mapping.matchEvidence?.newPlayers?.observedAt
    && packSnapshot.observed_at === mapping.matchEvidence?.pack?.observedAt,
  'historical_archive_binding_timestamp_differs');

  const detailSnapshots = new Map();
  for (const value of historicalArchive.playerDetails) {
    ensure(object(value) && typeof value.source_url === 'string', 'invalid_historical_player_snapshot');
    const match = /^https:\/\/efhub\.com\/players\/(\d+)$/.exec(value.source_url);
    ensure(match && !detailSnapshots.has(match[1]), 'invalid_or_duplicate_historical_player_url');
    const snapshot = historicalSnapshot(value, `https://efhub.com/players/${match[1]}`);
    ensure(binding.playerDetailSha256[match[1]] === snapshot.sha256, 'historical_player_binding_hash_differs');
    detailSnapshots.set(match[1], snapshot);
  }
  ensure(Object.keys(binding.playerDetailSha256).sort(compareText).every((id, index) => id === [...detailSnapshots.keys()].sort(compareText)[index])
    && Object.keys(binding.playerDetailSha256).length === detailSnapshots.size, 'historical_player_binding_set_differs');

  const officialParsed = parseOfficialHtml(officialSnapshot.html, { sourceUrl: OFFICIAL, observedAt: officialSnapshot.observed_at });
  const officialMatches = officialParsed.records.filter(row => row.title === mapping.officialTitle);
  ensure(officialMatches.length === 1, 'historical_official_sale_missing_or_ambiguous');
  const official = officialMatches[0];
  const expectedEnd = mapping.expectedEndsAt ?? mapping.endsAt;
  const expectedTotal = mapping.expectedTotalPlayerCount ?? mapping.totalPlayerCount;
  ensure(text(expectedEnd) && Number.isSafeInteger(expectedTotal)
    && Date.parse(expectedEnd) === Date.parse(official.endsAt) && expectedTotal === official.totalPlayerCount,
  'historical_official_round_guard_mismatch');
  ensure(Date.parse(official.endsAt) <= Date.parse(startedAt), 'historical_archive_sale_is_not_ended');

  const listing = parseNewPlayersHtml(listingSnapshot.html, { sourceUrl: NEW_PLAYERS, observedAt: listingSnapshot.observed_at });
  const sections = listing.sections.filter(section => section.title === mapping.newPlayersSection);
  ensure(sections.length === 1 && sections[0].complete === true, 'historical_listing_section_missing_or_ambiguous');
  const section = sections[0];
  ensure(!section.packSlug || section.packSlug === mapping.packSlug, 'historical_listing_pack_mismatch');
  const detail = parsePackMembershipHtml(packSnapshot.html, { sourceUrl: expectedPackUrl,
    observedAt: packSnapshot.observed_at, expectedSlug: mapping.packSlug, allowPagination: false });
  ensure(detail.membershipComplete && !detail.pagination, 'historical_pack_membership_incomplete');

  const historicalTimes = [officialSnapshot, listingSnapshot, packSnapshot, ...detailSnapshots.values()]
    .map(snapshot => Date.parse(snapshot.observed_at));
  ensure(Math.max(...historicalTimes) - Math.min(...historicalTimes) <= 2 * 60 * 60 * 1000,
    'historical_archive_observations_not_within_two_hours');
  ensure(historicalTimes.every(time => time < Date.parse(official.endsAt)), 'historical_archive_observation_after_sale');

  const sectionIds = section.players.map(player => player.id);
  const specialCount = expectedSpecialCount(mapping, detail.pack);
  ensure(detail.playerIds.length === detail.pack.playerCount && sectionIds.length === specialCount
    && detail.playerIds.length < sectionIds.length && detail.playerIds.every(id => sectionIds.includes(id)),
  'historical_pack_detail_section_mismatch');
  const missingIds = new Set(sectionIds.filter(id => !detail.playerIds.includes(id)));
  ensure([...detailSnapshots.keys()].every(id => missingIds.has(id)), 'historical_player_is_not_missing_section_member');
  const historicalPlayers = new Map();
  for (const [id, snapshot] of detailSnapshots) {
    historicalPlayers.set(id, parsePlayerHtml(snapshot.html, { sourceUrl: snapshot.source_url,
      observedAt: snapshot.observed_at, expectedId: id }).player);
  }

  return { mapping, official, officialSnapshot, listingSnapshot, packSnapshot, listing, section, detail,
    historicalPlayers, specialCount, historicalOfficial: { status: 'ok', complete: true,
      observedAt: officialParsed.observed_at, sourceUrl: officialParsed.source_url, url: officialParsed.source_url,
      sha256: officialParsed.sha256, rows: [official] } };
}

/**
 * Check one bounded source cycle and produce append candidates, never write a DB.
 * mappings are explicit reviewed joins; names or heading slugs are never guessed.
 */
export async function collectCycle({ mappings, rawPlayers, rawPacks, fetchHtml = fetchHtmlSnapshot, now = () => new Date(), maxRequests = 30, manualCollection = false, mappingsDocument = null, rulesIdentity = null, historicalArchive = null } = {}) {
  ensure(Array.isArray(mappings) && Array.isArray(rawPlayers) && Array.isArray(rawPacks), 'invalid_collection_inputs');
  ensure(typeof manualCollection === 'boolean', 'invalid_collection_mode');
  ensure(Number.isSafeInteger(maxRequests) && maxRequests >= 2 && maxRequests <= 30, 'invalid_request_budget');
  const startedAt = now().toISOString();
  rulesIdentity ??= await activeRules();
  // Map and roster iteration order must never affect request budgets or append order.
  mappings = structuredClone(mappings).sort((a, b) => compareText(a.saleId ?? '', b.saleId ?? ''));
  ensure(historicalArchive === null || historicalArchive === undefined || manualCollection, 'historical_archive_requires_manual_collection');
  const historical = prepareHistoricalArchive({ historicalArchive, mappings, startedAt });
  const requestsEvidence = [];
  const finish = () => {
    result.requestCount = requests;
    result.candidates.sort((a, b) => compareText(a.saleId, b.saleId));
    result.pending.sort((a, b) => compareText(canonical(a), canonical(b)));
    result.receipt = makeCollectionReceipt({ checkedAt: startedAt, rulesIdentity, mappingsDocument: mappingsDocument ?? { schemaVersion: 1, mappings }, rawPlayers, rawPacks, maxRequests, manualCollection, requests: requestsEvidence, historicalArchive, resultSha256: receiptResultHash(result) });
    return result;
  };
  const result = { checkedAt: startedAt, officialObservation: { status: 'error', complete: false, observedAt: startedAt, rows: [] },
    ...(historical ? { historicalOfficial: { [historical.mapping.saleId]: historical.historicalOfficial } } : {}),
    candidates: [], pending: [], sources: [] };
  const existingPlayers = new Map(rawPlayers.map(player => [player.id, player]));
  const existingPacks = new Map(rawPacks.filter(pack => text(pack.slug)).map(pack => [pack.slug, pack]));
  const fetched = new Map();
  const fetchFailures = new Map();
  let requests = 0;
  let deniedEfhub = false;

  async function get(url) {
    if (fetched.has(url)) return fetched.get(url);
    if (fetchFailures.has(url)) throw fetchFailures.get(url);
    ensure(!deniedEfhub || !url.startsWith('https://efhub.com/'), 'efhub_cycle_blocked');
    ensure(requests < maxRequests, 'request_budget_exhausted');
    validateHtmlSourceUrl(url);
    requests++;
    try {
      const fetchedSnapshot = await fetchHtml(url, { now: () => new Date(startedAt), timeoutMs: 20000 });
      ensure(typeof fetchedSnapshot.html === 'string' && Buffer.byteLength(fetchedSnapshot.html) <= 8 * 1024 * 1024, 'invalid_html_snapshot');
      const browserDom = fetchedSnapshot.source_kind === 'browser_dom';
      ensure(fetchedSnapshot.source_kind === undefined || browserDom, 'invalid_source_kind');
      ensure(!fetchedSnapshot.source_url || fetchedSnapshot.source_url === url, 'source_url_mismatch');
      const observedAt = fetchedSnapshot.observed_at ?? startedAt;
      ensure(typeof observedAt === 'string' && Number.isFinite(Date.parse(observedAt)), 'invalid_source_timestamp');
      const bytes = Buffer.byteLength(fetchedSnapshot.html);
      const sha256 = createHash('sha256').update(fetchedSnapshot.html).digest('hex');
      if (browserDom) {
        // A DOM observation establishes page content, never an HTTP status.
        ensure(manualCollection && fetchedSnapshot.status === null && fetchedSnapshot.complete === true
          && fetchedSnapshot.source_url === url && fetchedSnapshot.observed_at === new Date(observedAt).toISOString()
          && fetchedSnapshot.bytes === bytes && fetchedSnapshot.sha256 === sha256, 'invalid_browser_dom_snapshot');
      } else ensure(fetchedSnapshot.status === undefined || fetchedSnapshot.status === 200, 'invalid_html_snapshot');
      const snapshot = { source_url: url, observed_at: new Date(observedAt).toISOString(), status: browserDom ? null : 200,
        ...(browserDom ? { source_kind: 'browser_dom' } : {}), complete: true, bytes, sha256, html: fetchedSnapshot.html };
      requestsEvidence.push({ url, snapshot: structuredClone(snapshot) });
      result.sources.push({ ...sourceMeta(snapshot), source_url: snapshot.source_url ?? url, status: 'ok' });
      fetched.set(url, snapshot);
      return snapshot;
    } catch (error) {
      const normalized = { code: typeof error.code === 'string' ? error.code : 'source_fetch_failed', message: typeof error.message === 'string' ? error.message : 'Source fetch failed', status: Number.isSafeInteger(error.status) ? error.status : null, observed_at: new Date(error.observed_at ?? startedAt).toISOString() };
      requestsEvidence.push({ url, error: normalized });
      if (url.startsWith('https://efhub.com/') && (error.code === 'source_denied' || error.status === 403 || error.status === 429)) deniedEfhub = true;
      result.sources.push({ source_url: url, observed_at: normalized.observed_at, status: normalized.code === 'source_denied' || normalized.status === 403 || normalized.status === 429 ? 'blocked' : 'error', http_status: normalized.status, code: normalized.code });
      const recordedError = Object.assign(new Error(normalized.message), normalized);
      fetchFailures.set(url, recordedError);
      throw recordedError;
    }
  }


  async function getPackDetail(url, { mapping, retainedPack, expectedMemberCount }) {
    const parse = async pageUrl => {
      const snapshot = await get(pageUrl);
      return parsePackMembershipHtml(snapshot.html, { sourceUrl: pageUrl, observedAt: snapshot.observed_at ?? startedAt,
        expectedSlug: mapping.packSlug, retainedPack, expectedMemberCount, allowPagination: true });
    };
    const first = await parse(url);
    if (!first.pagination) {
      ensure(first.membershipComplete, 'pack_membership_incomplete');
      return first;
    }
    const pageUrls = first.pagination.pageUrls;
    ensure(Array.isArray(pageUrls) && pageUrls.length >= 1 && pageUrls.length <= maxRequests
      && new Set(pageUrls).size === pageUrls.length && pageUrls.includes(url), 'invalid_pack_pagination');
    const pageSet = canonical([...pageUrls].sort(compareText));
    const pageNumber = pageUrl => {
      const parsed = validateHtmlSourceUrl(pageUrl);
      ensure(parsed.origin === 'https://efhub.com' && parsed.pathname === new URL(url).pathname, 'pack_pagination_url_mismatch');
      return parsed.searchParams.has('page') ? Number(parsed.searchParams.get('page')) : 1;
    };
    const expectedPages = pageUrls.map(pageNumber).sort((a, b) => a - b);
    ensure(expectedPages.every((page, index) => page === index + 1), 'pack_pagination_page_gap');
    const parts = [];
    for (const pageUrl of [...pageUrls].sort((a, b) => pageNumber(a) - pageNumber(b))) {
      const part = pageUrl === url ? first : await parse(pageUrl);
      ensure(canonical(part.pack) === canonical(first.pack), 'pack_pagination_metadata_changed');
      ensure(part.pagination && part.pagination.page === pageNumber(pageUrl)
        && canonical([...part.pagination.pageUrls].sort(compareText)) === pageSet, 'pack_pagination_changed');
      parts.push(part);
    }
    const members = parts.flatMap(part => part.members);
    const memberIds = members.map(member => member.id);
    const players = parts.flatMap(part => part.players);
    const count = expectedMemberCount ?? first.pack.playerCount;
    ensure(memberIds.length === count && new Set(memberIds).size === memberIds.length, 'pack_pagination_membership_incomplete');
    ensure(new Set(players.map(player => player.id)).size === players.length, 'pack_pagination_player_conflict');
    return { ...first, members, players, playerIds: memberIds, membershipComplete: true,
      pagination: { ...first.pagination, complete: true },
      membershipPages: parts.map(({ source_url, observed_at, sha256 }) => ({ sourceUrl: source_url, observedAt: observed_at, sha256 })) };
  }

  try {
    const snapshot = await get(OFFICIAL);
    const parsed = parseOfficialHtml(snapshot.html, { sourceUrl: OFFICIAL, observedAt: snapshot.observed_at ?? startedAt });
    result.officialObservation = { ...parsed, status: 'ok', observedAt: parsed.observed_at, sourceUrl: parsed.source_url, url: parsed.source_url, rows: parsed.records };
  } catch (error) {
    result.officialObservation = { ...result.officialObservation, code: error.code ?? 'official_source_failed', message: error.message };
  }

  let efhub;
  try {
    const snapshot = await get(NEW_PLAYERS);
    efhub = parseNewPlayersHtml(snapshot.html, { sourceUrl: NEW_PLAYERS, observedAt: snapshot.observed_at ?? startedAt });
  } catch (error) {
    result.pending.push({ reason: error.code ?? 'efhub_source_failed', sourceUrl: NEW_PLAYERS, message: error.message });
  }

  const knownTitles = new Set(mappings.map(mapping => mapping.officialTitle));
  if (result.officialObservation.status === 'ok') for (const row of result.officialObservation.rows) {
    if (!knownTitles.has(row.title)) result.pending.push({ officialTitle: row.title, endsAt: row.endsAt, reason: 'unmapped_official_product' });
  }

  if (!efhub || result.officialObservation.status !== 'ok') {
    for (const mapping of mappings) result.pending.push({ saleId: mapping.saleId, packSlug: mapping.packSlug, reason: !efhub ? 'efhub_source_unavailable' : 'official_source_unavailable' });
    return finish();
  }

  for (const mapping of mappings) {
    try {
      ensure(!deniedEfhub, 'efhub_cycle_blocked');
      ensure(text(mapping.saleId) && text(mapping.officialTitle) && text(mapping.packSlug) && text(mapping.newPlayersSection), 'incomplete_explicit_mapping');
      ensure(/^[a-z\d-]+$/.test(mapping.packSlug), 'invalid_explicit_pack_slug');
      ensure(mapping.matchEvidence && (text(mapping.matchEvidence) || (object(mapping.matchEvidence) && Object.keys(mapping.matchEvidence).length > 0)), 'missing_match_evidence');
      const historicalSale = historical?.mapping.saleId === mapping.saleId ? historical : null;
      const matches = historicalSale ? [historicalSale.official]
        : result.officialObservation.rows.filter(row => row.title === mapping.officialTitle);
      ensure(matches.length === 1, matches.length ? 'ambiguous_official_round' : 'official_product_not_listed');
      const official = matches[0];
      if (!historicalSale) ensure(Date.parse(official.endsAt) > Date.parse(startedAt), 'official_product_expired');
      const expectedEnd = mapping.expectedEndsAt ?? mapping.endsAt;
      const expectedTotal = mapping.expectedTotalPlayerCount ?? mapping.totalPlayerCount;
      ensure(text(expectedEnd) && Number.isSafeInteger(expectedTotal), 'missing_official_round_guards');
      ensure(Date.parse(expectedEnd) === Date.parse(official.endsAt) && expectedTotal === official.totalPlayerCount, 'official_round_guard_mismatch');
      const listing = historicalSale?.listing ?? efhub;
      const sections = listing.sections.filter(section => section.title === mapping.newPlayersSection);
      ensure(sections.length <= 1 && (sections.length === 0 || sections[0].complete === true), 'efhub_section_missing_or_ambiguous');
      let section = sections[0];
      if (section) ensure(!section.packSlug || section.packSlug === mapping.packSlug, 'efhub_section_pack_mismatch');
      const retainedPack = existingPacks.get(mapping.packSlug);
      const observedPack = listing.rawPacks.find(pack => pack.slug === mapping.packSlug);
      if (retainedPack && observedPack) ensure(canonical(retainedPack) === canonical(observedPack), 'raw_pack_conflict');
      let pack = retainedPack ?? observedPack;
      let detailPlayers = [];
      let membershipSource = listing;
      let correctedFirstImport = false;
      if (historicalSale) {
        const correctedPack = { ...historicalSale.detail.pack, playerCount: historicalSale.specialCount };
        if (retainedPack) ensure(canonical(retainedPack) === canonical(correctedPack), 'historical_archive_raw_pack_conflict');
        pack = historicalSale.detail.pack;
        detailPlayers = historicalSale.detail.players;
        membershipSource = { source_url: historicalSale.packSnapshot.source_url,
          observed_at: historicalSale.packSnapshot.observed_at, sha256: historicalSale.packSnapshot.sha256 };
        correctedFirstImport = true;
      }
      // The newest-release listing is not a historical catalogue. Only when
      // that complete listing has no section for an explicit reviewed mapping,
      // read the mapping's exact detail URL. A denial or ambiguous section must
      // never be bypassed by trying a different page.
      if (!historicalSale && !section) {
        const url = `https://efhub.com/packs/${mapping.packSlug}`;
        const detail = await getPackDetail(url, { mapping, retainedPack: pack,
          expectedMemberCount: pack ? expectedSpecialCount(mapping, pack) : undefined });
        if (pack) ensure(canonical(pack) === canonical(detail.pack), 'raw_pack_conflict');
        pack = detail.pack;
        detailPlayers = detail.players;
        section = { title: pack.name, packSlug: pack.slug, packUrl: url, players: detail.members, complete: detail.membershipComplete };
        membershipSource = detail;
      } else if (!historicalSale && !pack) {
        const url = section.packUrl ?? `https://efhub.com/packs/${mapping.packSlug}`;
        const detail = await getPackDetail(url, { mapping });
        pack = detail.pack;
        detailPlayers = detail.players;
        const sectionIds = section.players.map(player => player.id);
        const exactMembership = detail.playerIds.length === sectionIds.length;
        const reviewedCorrectedSubset = mapping.countCorrection !== undefined
          && detail.playerIds.length === detail.pack.playerCount
          && sectionIds.length === expectedSpecialCount(mapping, detail.pack)
          && detail.playerIds.length < sectionIds.length;
        ensure(detail.membershipComplete && new Set(detail.playerIds).size === detail.playerIds.length
          && detail.playerIds.every(id => sectionIds.includes(id))
          && (exactMembership || reviewedCorrectedSubset), 'pack_detail_section_mismatch');
        correctedFirstImport = reviewedCorrectedSubset;
      }
      assertRawPack(pack);
      const members = [...section.players].sort((a, b) => compareText(a.id, b.id));
      const memberIds = members.map(player => player.id);
      ensure(memberIds.length > 0 && new Set(memberIds).size === memberIds.length, 'invalid_member_ids');
      if (mapping.memberIds) ensure(Array.isArray(mapping.memberIds) && mapping.memberIds.length === memberIds.length && mapping.memberIds.every(id => memberIds.includes(id)), 'reviewed_membership_changed');
      const specialCount = expectedSpecialCount(mapping, pack);
      ensure(memberIds.length === specialCount && specialCount <= official.totalPlayerCount, 'incomplete_special_membership');
      const reviewedReportedCount = mapping.countCorrection && Number.isSafeInteger(mapping.matchEvidence?.pack?.originalPlayerCount)
        ? mapping.matchEvidence.pack.originalPlayerCount
        : pack.playerCount;
      const sourceReportedSpecialCount = reviewedReportedCount;
      const rawPack = correctedFirstImport ? { ...pack, playerCount: specialCount } : pack;

      const newPlayers = [];
      for (const member of members) {
        if (existingPlayers.has(member.id)) {
          const previous = existingPlayers.get(member.id);
          if (member.name) ensure(previous.name === member.name, 'existing_member_name_conflict');
          const observed = listing.rawPlayers.find(player => player.id === member.id) ?? detailPlayers.find(player => player.id === member.id)
            ?? historicalSale?.historicalPlayers.get(member.id);
          if (observed) ensure(canonical(previous) === canonical(observed), 'existing_raw_player_conflict');
          continue;
        }
        let player = listing.rawPlayers.find(player => player.id === member.id) ?? detailPlayers.find(player => player.id === member.id)
          ?? historicalSale?.historicalPlayers.get(member.id);
        if (!player) {
          const snapshot = await get(member.detailUrl);
          player = parsePlayerHtml(snapshot.html, { sourceUrl: member.detailUrl, observedAt: snapshot.observed_at ?? startedAt, expectedId: member.id }).player;
        }
        assertRawPlayer(player, member.id);
        if (member.name) ensure(player.name === member.name, 'member_detail_name_mismatch');
        newPlayers.push(player);
      }
      const officialEvidence = historicalSale?.historicalOfficial ?? result.officialObservation;
      result.candidates.push({ saleId: mapping.saleId, officialTitle: official.title, packSlug: pack.slug, endsAt: official.endsAt, totalPlayerCount: official.totalPlayerCount, specialCount, expectedSpecialCount: specialCount, sourceReportedSpecialCount, memberIds, rawPlayers: newPlayers, rawPack, matchVerified: true, membershipComplete: true, countCorrection: mapping.countCorrection ?? null, evidence: { match: mapping.matchEvidence,
        ...(historicalSale ? { historicalArchive: true } : {}),
        official: { sourceUrl: officialEvidence.sourceUrl, observedAt: officialEvidence.observedAt, sha256: officialEvidence.sha256 },
        efhub: { sourceUrl: membershipSource.source_url, observedAt: membershipSource.observed_at, sha256: membershipSource.sha256, section: section.title }, memberIds } });
    } catch (error) {
      if (error.code === 'source_denied' || error.status === 403 || error.status === 429) deniedEfhub = true;
      result.pending.push({ saleId: mapping.saleId, packSlug: mapping.packSlug, reason: error.code ?? 'collection_candidate_invalid', message: error.message });
    }
  }
  // A source denial ends this EFHub cycle, including any candidates prepared before it.
  if (deniedEfhub) {
    for (const candidate of result.candidates) result.pending.push({ saleId: candidate.saleId, packSlug: candidate.packSlug, reason: 'efhub_cycle_blocked' });
    result.candidates = [];
  }
  return finish();
}
