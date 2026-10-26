/**
 * Pure application catalogue reconciliation. Raw JSON is never queried by the
 * HTTP API: it is input to this materialization step only.
 */
export const PLAYER_FIELDS = Object.freeze(['id', 'name', 'slug', 'position', 'overallRating', 'playingStyle', 'playingStyleDefensive', 'imageUrl']);
export const CATALOG_FILES = Object.freeze({ players: 'processed/players.json', packs: 'processed/packs.json', active: 'live.json', archive: 'archive.json' });
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => structuredClone(value);
const canonical = value => JSON.stringify(sorted(value));
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  return object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
}
const same = (left, right) => canonical(left) === canonical(right);
const nonempty = value => typeof value === 'string' && value.trim() !== '';
const integer = value => Number.isSafeInteger(value) && value >= 0;
const timestamp = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const fail = message => { throw new Error(message); };
function indexUnique(records, key, label) {
  if (!Array.isArray(records)) fail(`${label} must be an array`);
  const result = new Map();
  for (const record of records) {
    if (!object(record) || !nonempty(record[key])) fail(`Invalid ${label} ${key}`);
    if (result.has(record[key])) fail(`Duplicate ${label} ${record[key]}`);
    result.set(record[key], record);
  }
  return result;
}
function eventId(value) {
  // Stable event deduplication key, deliberately not a cryptographic signature.
  let hash = 2166136261;
  for (const char of canonical(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return `catalog-${hash.toString(16).padStart(8, '0')}`;
}

export function createLifecycleState() {
  return { schemaVersion: 1, players: [], packs: [], active: [], archive: [], rawUpdates: { players: [], packs: [] }, updates: [], observations: [] };
}

export function projectPlayer(raw) {
  if (!object(raw) || typeof raw.id !== 'string' || !/^\d+$/.test(raw.id)) fail('Player id must remain a decimal string');
  for (const field of ['name', 'slug', 'position', 'imageUrl']) if (!nonempty(raw[field])) fail(`Player ${raw.id} lacks ${field}`);
  if (!integer(raw.overallRating) || raw.overallRating > 200) fail(`Invalid player rating: ${raw.id}`);
  let image;
  try { image = new URL(raw.imageUrl); } catch { fail(`Invalid player image: ${raw.id}`); }
  if (image.protocol !== 'https:') fail(`Player image must use HTTPS: ${raw.id}`);
  for (const field of ['playingStyle', 'playingStyleDefensive']) if (raw[field] !== undefined && raw[field] !== null && typeof raw[field] !== 'string') fail(`Invalid ${field}: ${raw.id}`);
  return Object.fromEntries(PLAYER_FIELDS.map(field => [field, raw[field] === undefined || raw[field] === '' ? null : raw[field]]));
}

function officialHealth(observation, now, maxAgeMs) {
  if (!object(observation) || observation.status !== 'ok' || observation.complete !== true || !timestamp(observation.observedAt) || !Array.isArray(observation.rows) || observation.rows.length === 0) return { usable: false, reason: 'official_observation_incomplete' };
  const age = now - Date.parse(observation.observedAt);
  if (age < -60_000 || age > maxAgeMs) return { usable: false, reason: 'official_observation_stale' };
  const rows = observation.rows;
  if (rows.some(row => !object(row) || !nonempty(row.title) || !integer(row.totalPlayerCount) || row.totalPlayerCount === 0 || !timestamp(row.endsAt))) return { usable: false, reason: 'official_observation_invalid' };
  const keys = rows.map(row => canonical([row.title, row.endsAt, row.totalPlayerCount]));
  if (new Set(keys).size !== keys.length) return { usable: false, reason: 'official_observation_ambiguous' };
  return { usable: true, reason: null };
}

function matchingOfficial(candidate, observation) {
  return observation.rows.filter(row => row.title === candidate.officialTitle && row.totalPlayerCount === candidate.totalPlayerCount && Date.parse(row.endsAt) === Date.parse(candidate.endsAt));
}

function candidateProblem(candidate, observation, health, rawPlayers, rawPacks) {
  if (!health.usable) return health.reason;
  if (!object(candidate) || !nonempty(candidate.saleId) || !nonempty(candidate.packSlug)) return 'invalid_candidate_identity';
  if (candidate.matchVerified !== true) return 'cross_source_match_unverified';
  if (candidate.membershipComplete !== true) return 'special_membership_incomplete';
  if (!nonempty(candidate.officialTitle) || !integer(candidate.totalPlayerCount) || candidate.totalPlayerCount === 0 || !timestamp(candidate.endsAt)) return 'invalid_official_fields';
  if (matchingOfficial(candidate, observation).length !== 1) return 'official_product_not_matched';
  if (!object(candidate.evidence) || Object.keys(candidate.evidence).length === 0) return 'missing_match_evidence';
  const pack = rawPacks.get(candidate.packSlug);
  if (!pack) return 'raw_pack_missing';
  if (!nonempty(pack.name) || !nonempty(pack.date) || !integer(pack.playerCount)) return 'invalid_raw_pack';
  if (!Array.isArray(candidate.memberIds) || candidate.memberIds.length === 0 || candidate.memberIds.some(id => typeof id !== 'string' || !/^\d+$/.test(id))) return 'invalid_member_ids';
  if (new Set(candidate.memberIds).size !== candidate.memberIds.length) return 'duplicate_member_ids';
  if (!integer(candidate.expectedSpecialCount) || candidate.expectedSpecialCount !== candidate.memberIds.length) return 'special_count_mismatch';
  if (candidate.expectedSpecialCount > candidate.totalPlayerCount) return 'special_count_exceeds_total';
  const reported = candidate.sourceReportedSpecialCount ?? pack.playerCount;
  if (!integer(reported) || reported !== pack.playerCount) return 'source_reported_count_mismatch';
  if (reported !== candidate.expectedSpecialCount && !(object(candidate.countCorrection) && ['user_confirmed', 'source_error_confirmed_by_user', 'verified_source_correction'].includes(candidate.countCorrection.status) && nonempty(candidate.countCorrection.reason))) return 'count_correction_unverified';
  for (const id of candidate.memberIds) {
    if (!rawPlayers.has(id)) return `raw_player_missing:${id}`;
    try { projectPlayer(rawPlayers.get(id)); } catch (error) { return `invalid_raw_player:${id}:${error.message}`; }
  }
  return null;
}

function processedPack(candidate, raw, observation) {
  return {
    saleId: candidate.saleId, name: raw.name, slug: raw.slug, date: raw.date,
    playerCount: candidate.expectedSpecialCount,
    sourceReportedPlayerCount: raw.playerCount,
    totalPlayerCount: candidate.totalPlayerCount,
    standardPlayerCount: candidate.totalPlayerCount - candidate.expectedSpecialCount,
    endsAt: new Date(candidate.endsAt).toISOString(), officialTitle: candidate.officialTitle,
    members: [],
    countCorrection: raw.playerCount === candidate.expectedSpecialCount ? null : copy(candidate.countCorrection),
    provenance: {
      ...copy(candidate.evidence),
      official: {
        url: observation.url ?? 'https://efootball-web.konami.net/probability_kr.php',
        observedAt: observation.observedAt, sha256: observation.sha256 ?? null,
        title: candidate.officialTitle, totalPlayerCount: candidate.totalPlayerCount,
        endsAt: new Date(candidate.endsAt).toISOString(),
      },
    },
  };
}

function packData(pack) {
  const { provenance, ...data } = pack;
  return data;
}

/** Throws if a generation cannot be published as one consistent unit. */
export function validateLifecycleState(state) {
  if (!object(state) || state.schemaVersion !== 1) fail('Unsupported lifecycle state');
  const players = indexUnique(state.players, 'id', 'processed players');
  const packs = indexUnique(state.packs, 'saleId', 'processed packs');
  const active = indexUnique(state.active, 'saleId', 'live packs');
  const archive = indexUnique(state.archive, 'saleId', 'archive packs');
  const referenced = new Set();
  for (const [id, player] of players) {
    if (!same(Object.keys(player).sort(), [...PLAYER_FIELDS].sort())) fail(`Unexpected processed player fields: ${id}`);
    if (!same(projectPlayer(player), player)) fail(`Invalid processed player: ${id}`);
  }
  for (const [id, pack] of packs) {
    if (!timestamp(pack.endsAt) || !integer(pack.totalPlayerCount) || !integer(pack.playerCount) || pack.playerCount > pack.totalPlayerCount || pack.standardPlayerCount !== pack.totalPlayerCount - pack.playerCount || !Array.isArray(pack.members) || pack.members.length !== pack.playerCount) fail(`Invalid processed pack: ${id}`);
    const ids = new Set();
    for (const member of pack.members) {
      if (!object(member) || !same(Object.keys(member).sort(), ['id', 'name']) || !players.has(member.id) || players.get(member.id).name !== member.name || ids.has(member.id)) fail(`Invalid member in ${id}`);
      ids.add(member.id); referenced.add(member.id);
    }
    if (active.has(id) === archive.has(id)) fail(`Pack must occur in exactly one of live/archive: ${id}`);
    const embedded = active.get(id) ?? archive.get(id);
    const { players: nestedPlayers, archivedAt, archiveReason, ...embeddedPack } = embedded;
    if (!same(embeddedPack, pack) || !same(nestedPlayers, pack.members.map(member => players.get(member.id)))) fail(`Incomplete embedded pack: ${id}`);
    if (archive.has(id) && (!timestamp(archivedAt) || !nonempty(archiveReason))) fail(`Missing archive transition: ${id}`);
  }
  if (active.size + archive.size !== packs.size || [...active.keys(), ...archive.keys()].some(id => !packs.has(id))) fail('Unknown live/archive pack');
  if (referenced.size !== players.size) fail('Processed players include orphan records');
  for (const key of ['updates', 'observations']) if (!Array.isArray(state[key])) fail(`Invalid ${key}`);
  if (!object(state.rawUpdates) || !Array.isArray(state.rawUpdates.players) || !Array.isArray(state.rawUpdates.packs)) fail('Invalid raw update history');
  return { packs: packs.size, players: players.size, active: active.size, archive: archive.size, orphanPlayers: 0 };
}

function fileChange(before, after, key, targetFile, at, observation, transitions) {
  const oldMap = indexUnique(before, key, targetFile);
  const newMap = indexUnique(after, key, targetFile);
  const added = [...newMap.keys()].filter(id => !oldMap.has(id));
  const updated = [...newMap.keys()].filter(id => oldMap.has(id) && !same(oldMap.get(id), newMap.get(id)));
  const removed = [...oldMap.keys()].filter(id => !newMap.has(id));
  if (!added.length && !updated.length && !removed.length) return null;
  const event = {
    at, targetFile, action: 'reconcile', added, updated, removed,
    beforeCount: before.length, afterCount: after.length,
    transitions: transitions.filter(item => [...added, ...updated, ...removed].includes(item.saleId)),
    evidence: { officialObservedAt: observation?.observedAt ?? null, officialSha256: observation?.sha256 ?? null },
  };
  return { id: eventId(event), ...event };
}

/**
 * Only source-verified candidates may grow the cumulative processed catalogue.
 * Expiry uses an already verified UTC deadline even while either source fails.
 */
export function reconcileCatalog({ state = createLifecycleState(), rawPlayers, rawPacks, candidates = [], officialObservation = null, now = new Date().toISOString(), maxAgeMs = 2 * 60 * 60 * 1000 } = {}) {
  validateLifecycleState(state);
  if (!timestamp(now) || !integer(maxAgeMs)) fail('Invalid reconciliation clock/freshness');
  if (!Array.isArray(candidates)) fail('candidates must be an array');
  const playerRaw = indexUnique(rawPlayers, 'id', 'raw players');
  // Preserve raw malformed/dummy packs outside the serving catalogue. They are
  // retained in raw input and never silently assigned fabricated identifiers.
  const packRaw = indexUnique(rawPacks.filter(raw => object(raw) && nonempty(raw.slug) && raw.slug !== 'dummy'), 'slug', 'raw packs');
  const next = copy(state);
  const packMap = indexUnique(next.packs, 'saleId', 'processed packs');
  const playerMap = indexUnique(next.players, 'id', 'processed players');
  const oldActive = indexUnique(state.active, 'saleId', 'live packs');
  const oldArchive = indexUnique(state.archive, 'saleId', 'archive packs');
  const clock = Date.parse(now);
  const at = new Date(now).toISOString();
  const health = officialHealth(officialObservation, clock, maxAgeMs);
  const pending = [];
  const accepted = [];
  const candidateCounts = new Map();
  for (const candidate of candidates) if (object(candidate) && nonempty(candidate.saleId)) candidateCounts.set(candidate.saleId, (candidateCounts.get(candidate.saleId) ?? 0) + 1);
  for (const candidate of candidates) {
    const reason = candidateCounts.get(candidate?.saleId) > 1 ? 'duplicate_sale_candidates' : candidateProblem(candidate, officialObservation, health, playerRaw, packRaw);
    if (reason) { pending.push({ saleId: candidate?.saleId ?? null, packSlug: candidate?.packSlug ?? null, reason }); continue; }
    if (Date.parse(candidate.endsAt) <= clock && !packMap.has(candidate.saleId)) {
      pending.push({ saleId: candidate.saleId, packSlug: candidate.packSlug, reason: 'new_product_already_ended' }); continue;
    }
    const previous = packMap.get(candidate.saleId);
    if (previous && previous.slug !== candidate.packSlug) {
      pending.push({ saleId: candidate.saleId, packSlug: candidate.packSlug, reason: 'sale_identity_conflict' }); continue;
    }
    if (previous && previous.members.some(member => !candidate.memberIds.includes(member.id))) {
      pending.push({ saleId: candidate.saleId, packSlug: candidate.packSlug, reason: 'cumulative_membership_removal_requires_review' }); continue;
    }
    const pack = processedPack(candidate, packRaw.get(candidate.packSlug), officialObservation);
    for (const id of candidate.memberIds) {
      const player = projectPlayer(playerRaw.get(id));
      playerMap.set(id, player);
      pack.members.push({ id, name: player.name });
    }
    // A fresh observation alone is not a data revision. Preserve original
    // provenance until a substantive field or membership actually changes.
    packMap.set(candidate.saleId, previous && same(packData(previous), packData(pack)) ? previous : pack);
    accepted.push(candidate.saleId);
  }
  // Names may be shared across historical/active products. Propagate one card
  // revision into every referring pack and both materializations together.
  for (const [id, pack] of packMap) {
    const members = pack.members.map(member => ({ id: member.id, name: playerMap.get(member.id).name }));
    if (!same(pack.members, members)) packMap.set(id, { ...pack, members });
  }
  const ownedPlayerIds = new Set([...packMap.values()].flatMap(pack => pack.members.map(member => member.id)));
  next.players = [...playerMap.values()].filter(player => ownedPlayerIds.has(player.id));
  next.packs = [...packMap.values()];
  next.active = []; next.archive = [];
  const transitions = [];
  const officialRows = health.usable ? officialObservation.rows : [];
  for (const pack of next.packs) {
    const expired = Date.parse(pack.endsAt) <= clock;
    const matchingRows = officialRows.filter(row => row.title === pack.officialTitle && Date.parse(row.endsAt) === Date.parse(pack.endsAt) && row.totalPlayerCount === pack.totalPlayerCount);
    // A changed deadline/count for the same title requires a new verified
    // candidate, not an inference that the prior offer was removed.
    const sameTitle = officialRows.some(row => row.title === pack.officialTitle);
    const removed = health.usable && matchingRows.length === 0 && !sameTitle;
    const wasArchived = oldArchive.has(pack.saleId);
    const mayReactivate = wasArchived && accepted.includes(pack.saleId) && matchingRows.length === 1 && !expired;
    const archive = expired || removed || (wasArchived && !mayReactivate);
    const embedded = { ...copy(pack), players: pack.members.map(member => copy(playerMap.get(member.id))) };
    if (archive) {
      const reason = expired ? 'ended' : removed ? 'official_removed' : oldArchive.get(pack.saleId).archiveReason;
      const old = oldArchive.get(pack.saleId);
      next.archive.push({ ...embedded, archivedAt: old?.archivedAt ?? at, archiveReason: reason });
      if (!wasArchived) transitions.push({ saleId: pack.saleId, action: 'archived', reason });
    } else {
      next.active.push(embedded);
      if (wasArchived) transitions.push({ saleId: pack.saleId, action: 'reactivated', reason: 'verified_official_return' });
      else if (!oldActive.has(pack.saleId)) transitions.push({ saleId: pack.saleId, action: 'activated', reason: 'verified_new_product' });
    }
  }
  const observationRecord = {
    observedAt: officialObservation?.observedAt ?? at, sha256: officialObservation?.sha256 ?? null,
    usable: health.usable, reason: health.reason, pending: copy(pending),
  };
  if (!next.observations.some(record => same(record, observationRecord))) next.observations.push(observationRecord);
  const changes = [];
  for (const [key, target] of Object.entries(CATALOG_FILES)) {
    const change = fileChange(state[key], next[key], key === 'players' ? 'id' : 'saleId', target, at, officialObservation, transitions);
    if (change) { changes.push(change); next.updates.push(change); }
  }
  const invariants = validateLifecycleState(next);
  return { state: next, changes, pending, accepted, transitions, invariants, officialUsable: health.usable, sourceStatus: health.reason };
}

/** Plan append-only raw growth; existing raw entries are never overwritten. */
export function planRawAppend({ rawPlayers, rawPacks, candidates = [], officialObservation, now = new Date().toISOString(), maxAgeMs = 2 * 60 * 60 * 1000 }) {
  const players = copy(rawPlayers); const packs = copy(rawPacks);
  const playerMap = indexUnique(players, 'id', 'raw players');
  const packMap = indexUnique(packs.filter(pack => nonempty(pack?.slug) && pack.slug !== 'dummy'), 'slug', 'raw packs');
  const health = officialHealth(officialObservation, Date.parse(now), maxAgeMs);
  const pending = []; const addedPlayers = []; const addedPacks = [];
  for (const candidate of candidates) {
    if (!health.usable || candidate?.matchVerified !== true || matchingOfficial(candidate, officialObservation).length !== 1) {
      pending.push({ packSlug: candidate?.packSlug ?? null, reason: health.reason ?? 'cross_source_match_unverified' }); continue;
    }
    const suppliedPlayers = candidate.rawPlayers ?? [];
    if (!Array.isArray(suppliedPlayers) || !object(candidate.rawPack) || candidate.rawPack.slug !== candidate.packSlug) {
      pending.push({ packSlug: candidate.packSlug, reason: 'raw_payload_missing' }); continue;
    }
    const testPlayers = new Map(playerMap); const testPacks = new Map(packMap);
    let problem = null;
    for (const player of suppliedPlayers) {
      try { projectPlayer(player); } catch (error) { problem = error.message; break; }
      if (testPlayers.has(player.id) && !same(testPlayers.get(player.id), player)) { problem = `raw_player_conflict:${player.id}`; break; }
      testPlayers.set(player.id, player);
    }
    if (testPacks.has(candidate.packSlug) && !same(testPacks.get(candidate.packSlug), candidate.rawPack)) problem = 'raw_pack_conflict';
    testPacks.set(candidate.packSlug, candidate.rawPack);
    problem ??= candidateProblem(candidate, officialObservation, health, testPlayers, testPacks);
    if (problem) { pending.push({ packSlug: candidate.packSlug, reason: problem }); continue; }
    for (const player of suppliedPlayers) if (!playerMap.has(player.id)) { const record = copy(player); players.push(record); playerMap.set(player.id, record); addedPlayers.push(record); }
    if (!packMap.has(candidate.packSlug)) { const pack = copy(candidate.rawPack); packs.push(pack); packMap.set(pack.slug, pack); addedPacks.push(pack); }
  }
  return { rawPlayers: players, rawPacks: packs, addedPlayers, addedPacks, pending };
}
