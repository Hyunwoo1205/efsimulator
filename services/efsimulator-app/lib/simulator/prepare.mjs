import { readDrawOptions } from '../draw-options.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const decimalId = value => typeof value === 'string' && /^\d+$/.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const validType = value => Number.isSafeInteger(value) && value > 0;
const PLAYER_FIELDS = Object.freeze(['id', 'name', 'slug', 'position', 'overallRating', 'playingStyle', 'playingStyleDefensive', 'imageUrl', 'playerType']);
const fieldsAre = (value, fields) => object(value) && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));

function validPlayer(player) {
  if (!fieldsAre(player, PLAYER_FIELDS) || !decimalId(player.id)
    || !['name', 'slug', 'position', 'imageUrl'].every(field => text(player[field]))
    || !count(player.overallRating) || player.overallRating > 200
    || !['playingStyle', 'playingStyleDefensive'].every(field => player[field] === null || typeof player[field] === 'string')) return false;
  try { return new URL(player.imageUrl).protocol === 'https:'; } catch { return false; }
}

function currentDrawOptions(pack) {
  const value = pack.drawOptions;
  const parsed = readDrawOptions(pack);
  if (!parsed || !fieldsAre(value, ['single', 'ten', 'provenance'])
    || !fieldsAre(value.single, ['supported', 'count', 'coinCost'])
    || !fieldsAre(value.ten, ['supported', 'count', 'coinCost', 'minimumRemaining'])
    || !fieldsAre(value.provenance, ['authority', 'reference', 'rule'])) return null;
  if (value.single.supported !== true || value.single.coinCost !== 100
    || value.ten.supported !== (pack.totalPlayerCount > 11) || value.ten.coinCost !== 900
    || value.provenance.authority !== 'direct_user_confirmation'
    || value.provenance.reference !== 'T042' || value.provenance.rule !== 'total_player_count_gt_11') return null;
  return structuredClone(value);
}

/**
 * Validate one pack inside an atomic CatalogProvider snapshot. The caller must
 * supply readCatalogSnapshot's complete live/archive/players result: that reader
 * checks every page's catalog_snapshot_id against manifest.version_id before
 * committing a snapshot. A version string supplied here is not an authentication
 * proof, and this function cannot establish upstream observation freshness.
 *
 * This is data preparation only: no random draw, slot allocation, session write,
 * storage readiness, source request, clock/TTL inference or origin timestamp edit.
 * Every verified member counts toward S regardless of its numeric playerType;
 * valid unknown positive codes are preserved. Anonymous A has no fabricated IDs.
 * @param {{ saleId?: string, catalog?: { manifest?: { version_id?: string }, live?: object[], archive?: object[], players?: object[] } | null, loading?: boolean, error?: string }} [options]
 */
export function prepareSimulatorPack({ saleId, catalog, loading = false, error = '' } = {}) {
  const reasonCodes = [];
  const add = code => { if (!reasonCodes.includes(code)) reasonCodes.push(code); };
  const result = {
    ready: false, status: 'invalid', reasonCodes,
    saleId: text(saleId) ? saleId : null,
    publicationVersionId: text(catalog?.manifest?.version_id) ? catalog.manifest.version_id : null,
    counts: null, specialPlayerIds: [], drawOptions: null, supportedCounts: [],
  };
  if (loading) add('catalog_loading');
  if (error) add('catalog_error');
  if (!text(saleId)) add('sale_id_missing');
  if (result.publicationVersionId === null) add('publication_missing');
  if (!object(catalog) || !Array.isArray(catalog.live) || !Array.isArray(catalog.archive) || !Array.isArray(catalog.players)) {
    add('catalog_incomplete');
    result.status = loading ? 'loading' : 'unavailable';
    return result;
  }
  const matches = [...catalog.live, ...catalog.archive].filter(pack => object(pack) && pack.saleId === saleId);
  if (matches.length !== 1) {
    add(matches.length > 1 ? 'sale_id_ambiguous' : 'sale_id_not_found');
    result.status = loading ? 'loading' : matches.length > 1 ? 'invalid' : 'not_found';
    return result;
  }
  const pack = matches[0];
  const { totalPlayerCount: total, playerCount: special, standardPlayerCount: standard } = pack;
  const countsValid = count(total) && total > 0 && count(special) && count(standard)
    && special <= total && standard === total - special;
  if (!countsValid) add('invalid_counts');
  else result.counts = { totalPlayerCount: total, specialPlayerCount: special, standardPlayerCount: standard };

  const globalPlayers = new Map();
  for (const player of catalog.players) {
    if (!validPlayer(player)) add('invalid_player');
    if (!validType(player?.playerType)) add('invalid_player_type');
    if (!decimalId(player?.id)) continue;
    if (globalPlayers.has(player.id)) add('duplicate_player_ids');
    globalPlayers.set(player.id, player);
  }
  const members = Array.isArray(pack.members) ? pack.members : [];
  const players = Array.isArray(pack.players) ? pack.players : [];
  if (!Array.isArray(pack.members) || !Array.isArray(pack.players)
    || !countsValid || members.length !== special || players.length !== special) add('incomplete_special_roster');
  const memberIds = new Set();
  for (const member of members) {
    if (!fieldsAre(member, ['id', 'name']) || !decimalId(member.id) || !text(member.name)) {
      add('membership_mismatch'); continue;
    }
    if (memberIds.has(member.id)) add('duplicate_player_ids');
    memberIds.add(member.id);
    const globalPlayer = globalPlayers.get(member.id);
    if (!globalPlayer || globalPlayer.name !== member.name) add('membership_mismatch');
  }
  const nestedIds = new Set();
  for (const player of players) {
    if (!validPlayer(player)) add('invalid_player');
    if (!validType(player?.playerType)) add('invalid_player_type');
    if (!decimalId(player?.id)) { add('membership_mismatch'); continue; }
    if (nestedIds.has(player.id)) add('duplicate_player_ids');
    nestedIds.add(player.id);
    const globalPlayer = globalPlayers.get(player.id);
    if (!memberIds.has(player.id) || !globalPlayer
      || !PLAYER_FIELDS.every(field => player[field] === globalPlayer[field])) add('membership_mismatch');
  }
  if (memberIds.size !== nestedIds.size || [...memberIds].some(id => !nestedIds.has(id))) add('membership_mismatch');
  if (!Object.hasOwn(pack, 'drawOptions')) add('draw_options_missing');
  else if (!currentDrawOptions(pack)) add('draw_options_invalid');

  if (reasonCodes.length) {
    result.status = loading ? 'loading' : error ? 'unavailable' : 'invalid';
    return result;
  }
  result.ready = true;
  result.status = 'ready';
  result.specialPlayerIds = [...memberIds].sort();
  result.drawOptions = currentDrawOptions(pack);
  result.supportedCounts = result.drawOptions.ten.supported ? [1, 10] : [1];
  return result;
}
