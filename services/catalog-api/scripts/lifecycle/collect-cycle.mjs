import { fetchHtmlSnapshot, parseNewPlayersHtml, parseOfficialHtml, parsePackHtml, parsePlayerHtml } from './html-sources.mjs';

const OFFICIAL = 'https://efootball-web.konami.net/probability_kr.php';
const NEW_PLAYERS = 'https://efhub.com/new-players';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const ensure = (condition, reason) => { if (!condition) throw Object.assign(new Error(reason), { code: reason }); };
const sourceMeta = source => {
  const { html: _html, ...metadata } = source;
  return metadata;
};

function validateRawPlayer(player, expectedId) {
  ensure(object(player) && player.id === expectedId && typeof player.id === 'string' && /^\d+$/.test(player.id), 'invalid_raw_player_id');
  // These are the supplied arrays' complete source-export fields. Optional playing styles stay optional.
  ensure(['name', 'nameJa', 'nameZh', 'slug', 'nationality', 'nationalityCode', 'team', 'position', 'imageUrl'].every(key => typeof player[key] === 'string'), 'incomplete_raw_player_shape');
  ensure(['name', 'slug', 'position', 'imageUrl'].every(key => text(player[key])) && Number.isFinite(player.overallRating) && Number.isSafeInteger(player.playerType) && player.playerType > 0, 'invalid_raw_player_fields');
  ensure(new URL(player.imageUrl).protocol === 'https:', 'invalid_raw_player_image');
  for (const key of ['playingStyle', 'playingStyleDefensive']) ensure(!Object.hasOwn(player, key) || typeof player[key] === 'string', 'invalid_raw_player_style');
  return player;
}

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
export async function collectCycle({ mappings, rawPlayers, rawPacks, fetchHtml = fetchHtmlSnapshot, now = () => new Date(), maxRequests = 30 } = {}) {
  ensure(Array.isArray(mappings) && Array.isArray(rawPlayers) && Array.isArray(rawPacks), 'invalid_collection_inputs');
  ensure(Number.isSafeInteger(maxRequests) && maxRequests >= 2 && maxRequests <= 30, 'invalid_request_budget');
  const startedAt = now().toISOString();
  const result = { checkedAt: startedAt, officialObservation: { status: 'error', complete: false, observedAt: startedAt, rows: [] }, candidates: [], pending: [], sources: [] };
  const existingPlayers = new Map(rawPlayers.map(player => [player.id, player]));
  const existingPacks = new Map(rawPacks.filter(pack => text(pack.slug)).map(pack => [pack.slug, pack]));
  const fetched = new Map();
  let requests = 0;
  let deniedEfhub = false;

  async function get(url) {
    if (fetched.has(url)) return fetched.get(url);
    ensure(!deniedEfhub || !url.startsWith('https://efhub.com/'), 'efhub_cycle_blocked');
    ensure(requests < maxRequests, 'request_budget_exhausted');
    requests++;
    try {
      const snapshot = await fetchHtml(url, { now, timeoutMs: 20000 });
      ensure(typeof snapshot.html === 'string' && (!snapshot.status || snapshot.status === 200), 'invalid_html_snapshot');
      result.sources.push({ ...sourceMeta(snapshot), source_url: snapshot.source_url ?? url, status: 'ok' });
      fetched.set(url, snapshot);
      return snapshot;
    } catch (error) {
      if (url.startsWith('https://efhub.com/') && (error.code === 'source_denied' || error.status === 403 || error.status === 429)) deniedEfhub = true;
      result.sources.push({ source_url: url, observed_at: error.observed_at ?? now().toISOString(), status: error.code === 'source_denied' ? 'blocked' : 'error', http_status: error.status ?? null, code: error.code ?? 'source_fetch_failed' });
      throw error;
    }
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
    result.requestCount = requests;
    return result;
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
      ensure(sections.length === 1 && sections[0].complete === true, 'efhub_section_missing_or_ambiguous');
      const section = sections[0];
      ensure(!section.packSlug || section.packSlug === mapping.packSlug, 'efhub_section_pack_mismatch');

      let pack = existingPacks.get(mapping.packSlug) ?? efhub.rawPacks.find(pack => pack.slug === mapping.packSlug);
      let detailPlayers = [];
      if (!pack) {
        const url = section.packUrl ?? `https://efhub.com/packs/${mapping.packSlug}`;
        const snapshot = await get(url);
        const detail = parsePackHtml(snapshot.html, { sourceUrl: url, observedAt: snapshot.observed_at ?? startedAt, expectedSlug: mapping.packSlug });
        pack = detail.pack;
        detailPlayers = detail.players;
        ensure(detail.membershipComplete && detail.playerIds.every(id => section.players.some(player => player.id === id)), 'pack_detail_section_mismatch');
      }
      ensure(pack.slug === mapping.packSlug && typeof pack.name === 'string' && typeof pack.date === 'string' && Number.isSafeInteger(pack.playerCount), 'incomplete_raw_pack_shape');
      const memberIds = section.players.map(player => player.id);
      ensure(memberIds.length > 0 && new Set(memberIds).size === memberIds.length, 'invalid_member_ids');
      if (mapping.memberIds) ensure(Array.isArray(mapping.memberIds) && mapping.memberIds.length === memberIds.length && mapping.memberIds.every(id => memberIds.includes(id)), 'reviewed_membership_changed');
      const specialCount = expectedSpecialCount(mapping, pack);
      ensure(memberIds.length === specialCount && specialCount <= official.totalPlayerCount, 'incomplete_special_membership');

      const newPlayers = [];
      for (const member of section.players) {
        if (existingPlayers.has(member.id)) continue;
        let player = efhub.rawPlayers.find(player => player.id === member.id) ?? detailPlayers.find(player => player.id === member.id);
        if (!player) {
          const snapshot = await get(member.detailUrl);
          player = parsePlayerHtml(snapshot.html, { sourceUrl: member.detailUrl, observedAt: snapshot.observed_at ?? startedAt, expectedId: member.id }).player;
        }
        validateRawPlayer(player, member.id);
        if (member.name) ensure(player.name === member.name, 'member_detail_name_mismatch');
        newPlayers.push(player);
      }
      result.candidates.push({ saleId: mapping.saleId, officialTitle: official.title, packSlug: pack.slug, endsAt: official.endsAt, totalPlayerCount: official.totalPlayerCount, specialCount, expectedSpecialCount: specialCount, memberIds, rawPlayers: newPlayers, rawPack: pack, matchVerified: true, membershipComplete: true, countCorrection: mapping.countCorrection ?? null, evidence: { match: mapping.matchEvidence, official: { sourceUrl: result.officialObservation.sourceUrl, observedAt: result.officialObservation.observedAt, sha256: result.officialObservation.sha256 }, efhub: { sourceUrl: efhub.source_url, observedAt: efhub.observed_at, sha256: efhub.sha256, section: section.title }, memberIds } });
    } catch (error) {
      result.pending.push({ saleId: mapping.saleId, packSlug: mapping.packSlug, reason: error.code ?? 'collection_candidate_invalid', message: error.message });
    }
  }
  // A source denial ends this EFHub cycle, including any candidates prepared before it.
  if (deniedEfhub) {
    for (const candidate of result.candidates) result.pending.push({ saleId: candidate.saleId, packSlug: candidate.packSlug, reason: 'efhub_cycle_blocked' });
    result.candidates = [];
  }
  result.requestCount = requests;
  return result;
}
