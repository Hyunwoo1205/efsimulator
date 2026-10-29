import { createHash } from 'node:crypto';
import { fetchHtmlSnapshot, parseNewPlayersHtml, parseOfficialHtml, parsePackMembershipHtml, parsePlayerHtml, validateHtmlSourceUrl } from './html-sources.mjs';
import { assertRawPlayer, assertRawPack, canonical, compareText } from '../../lib/catalog-contract.mjs';
import { makeCollectionReceipt, receiptResultHash } from './collection-receipt.mjs';
import { activeRules } from './rules.mjs';

const OFFICIAL = 'https://efootball-web.konami.net/probability_kr.php';
const NEW_PLAYERS = 'https://efhub.com/new-players';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
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

/**
 * Check one bounded source cycle and produce append candidates, never write a DB.
 * mappings are explicit reviewed joins; names or heading slugs are never guessed.
 */
export async function collectCycle({ mappings, rawPlayers, rawPacks, fetchHtml = fetchHtmlSnapshot, now = () => new Date(), maxRequests = 30, manualCollection = false, mappingsDocument = null, rulesIdentity = null } = {}) {
  ensure(Array.isArray(mappings) && Array.isArray(rawPlayers) && Array.isArray(rawPacks), 'invalid_collection_inputs');
  ensure(typeof manualCollection === 'boolean', 'invalid_collection_mode');
  ensure(Number.isSafeInteger(maxRequests) && maxRequests >= 2 && maxRequests <= 30, 'invalid_request_budget');
  const startedAt = now().toISOString();
  rulesIdentity ??= await activeRules();
  // Map and roster iteration order must never affect request budgets or append order.
  mappings = structuredClone(mappings).sort((a, b) => compareText(a.saleId ?? '', b.saleId ?? ''));
  const requestsEvidence = [];
  const finish = () => {
    result.requestCount = requests;
    result.candidates.sort((a, b) => compareText(a.saleId, b.saleId));
    result.pending.sort((a, b) => compareText(canonical(a), canonical(b)));
    result.receipt = makeCollectionReceipt({ checkedAt: startedAt, rulesIdentity, mappingsDocument: mappingsDocument ?? { schemaVersion: 1, mappings }, rawPlayers, rawPacks, maxRequests, manualCollection, requests: requestsEvidence, resultSha256: receiptResultHash(result) });
    return result;
  };
  const result = { checkedAt: startedAt, officialObservation: { status: 'error', complete: false, observedAt: startedAt, rows: [] }, candidates: [], pending: [], sources: [] };
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
      const matches = result.officialObservation.rows.filter(row => row.title === mapping.officialTitle);
      ensure(matches.length === 1, matches.length ? 'ambiguous_official_round' : 'official_product_not_listed');
      const official = matches[0];
      ensure(Date.parse(official.endsAt) > Date.parse(startedAt), 'official_product_expired');
      const expectedEnd = mapping.expectedEndsAt ?? mapping.endsAt;
      const expectedTotal = mapping.expectedTotalPlayerCount ?? mapping.totalPlayerCount;
      ensure(text(expectedEnd) && Number.isSafeInteger(expectedTotal), 'missing_official_round_guards');
      ensure(Date.parse(expectedEnd) === Date.parse(official.endsAt) && expectedTotal === official.totalPlayerCount, 'official_round_guard_mismatch');
      const sections = efhub.sections.filter(section => section.title === mapping.newPlayersSection);
      ensure(sections.length <= 1 && (sections.length === 0 || sections[0].complete === true), 'efhub_section_missing_or_ambiguous');
      let section = sections[0];
      if (section) ensure(!section.packSlug || section.packSlug === mapping.packSlug, 'efhub_section_pack_mismatch');
      const retainedPack = existingPacks.get(mapping.packSlug);
      const observedPack = efhub.rawPacks.find(pack => pack.slug === mapping.packSlug);
      if (retainedPack && observedPack) ensure(canonical(retainedPack) === canonical(observedPack), 'raw_pack_conflict');
      let pack = retainedPack ?? observedPack;
      let detailPlayers = [];
      let membershipSource = efhub;
      // The newest-release listing is not a historical catalogue. Only when
      // that complete listing has no section for an explicit reviewed mapping,
      // read the mapping's exact detail URL. A denial or ambiguous section must
      // never be bypassed by trying a different page.
      if (!section) {
        const url = `https://efhub.com/packs/${mapping.packSlug}`;
        const detail = await getPackDetail(url, { mapping, retainedPack: pack,
          expectedMemberCount: pack ? expectedSpecialCount(mapping, pack) : undefined });
        if (pack) ensure(canonical(pack) === canonical(detail.pack), 'raw_pack_conflict');
        pack = detail.pack;
        detailPlayers = detail.players;
        section = { title: pack.name, packSlug: pack.slug, packUrl: url, players: detail.members, complete: detail.membershipComplete };
        membershipSource = detail;
      } else if (!pack) {
        const url = section.packUrl ?? `https://efhub.com/packs/${mapping.packSlug}`;
        const detail = await getPackDetail(url, { mapping });
        pack = detail.pack;
        detailPlayers = detail.players;
        ensure(detail.membershipComplete && detail.playerIds.length === section.players.length
          && detail.playerIds.every(id => section.players.some(player => player.id === id)), 'pack_detail_section_mismatch');
      }
      assertRawPack(pack);
      const members = [...section.players].sort((a, b) => compareText(a.id, b.id));
      const memberIds = members.map(player => player.id);
      ensure(memberIds.length > 0 && new Set(memberIds).size === memberIds.length, 'invalid_member_ids');
      if (mapping.memberIds) ensure(Array.isArray(mapping.memberIds) && mapping.memberIds.length === memberIds.length && mapping.memberIds.every(id => memberIds.includes(id)), 'reviewed_membership_changed');
      const specialCount = expectedSpecialCount(mapping, pack);
      ensure(memberIds.length === specialCount && specialCount <= official.totalPlayerCount, 'incomplete_special_membership');

      const newPlayers = [];
      for (const member of members) {
        if (existingPlayers.has(member.id)) {
          const previous = existingPlayers.get(member.id);
          if (member.name) ensure(previous.name === member.name, 'existing_member_name_conflict');
          const observed = efhub.rawPlayers.find(player => player.id === member.id) ?? detailPlayers.find(player => player.id === member.id);
          if (observed) ensure(canonical(previous) === canonical(observed), 'existing_raw_player_conflict');
          continue;
        }
        let player = efhub.rawPlayers.find(player => player.id === member.id) ?? detailPlayers.find(player => player.id === member.id);
        if (!player) {
          const snapshot = await get(member.detailUrl);
          player = parsePlayerHtml(snapshot.html, { sourceUrl: member.detailUrl, observedAt: snapshot.observed_at ?? startedAt, expectedId: member.id }).player;
        }
        assertRawPlayer(player, member.id);
        if (member.name) ensure(player.name === member.name, 'member_detail_name_mismatch');
        newPlayers.push(player);
      }
      result.candidates.push({ saleId: mapping.saleId, officialTitle: official.title, packSlug: pack.slug, endsAt: official.endsAt, totalPlayerCount: official.totalPlayerCount, specialCount, expectedSpecialCount: specialCount, memberIds, rawPlayers: newPlayers, rawPack: pack, matchVerified: true, membershipComplete: true, countCorrection: mapping.countCorrection ?? null, evidence: { match: mapping.matchEvidence, official: { sourceUrl: result.officialObservation.sourceUrl, observedAt: result.officialObservation.observedAt, sha256: result.officialObservation.sha256 }, efhub: { sourceUrl: membershipSource.source_url, observedAt: membershipSource.observed_at, sha256: membershipSource.sha256, section: section.title }, memberIds } });
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
