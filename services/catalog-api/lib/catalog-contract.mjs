/** Shared, deterministic validation for every catalog mutation entry point. */
export const PLAYER_FIELDS = Object.freeze(['id', 'name', 'slug', 'position', 'overallRating', 'playingStyle', 'playingStyleDefensive', 'imageUrl']);
export const RAW_PLAYER_FIELDS = Object.freeze(['id', 'name', 'nameJa', 'nameZh', 'slug', 'nationality', 'nationalityCode', 'team', 'position', 'overallRating', 'playingStyle', 'playingStyleDefensive', 'imageUrl', 'playerType']);
export const RAW_PACK_FIELDS = Object.freeze(['name', 'slug', 'date', 'playerCount']);
export const PROCESSED_PACK_FIELDS = Object.freeze(['saleId', 'name', 'slug', 'date', 'playerCount', 'sourceReportedPlayerCount', 'totalPlayerCount', 'standardPlayerCount', 'endsAt', 'officialTitle', 'members', 'countCorrection', 'provenance', 'drawOptions']);
const LEGACY_PACK_FIELDS = PROCESSED_PACK_FIELDS.filter(field => field !== 'drawOptions');
export const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = value => typeof value === 'string' && value.trim().length > 0;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const timestamp = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const decimalId = value => typeof value === 'string' && /^\d+$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const plainJson = value => { canonical(value); return true; };
function keys(value, required, allowed = required, label = 'record') {
  requireValue(object(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => allowed.includes(key)), `Invalid ${label} fields`);
  plainJson(value);
}
function idList(value, label, predicate = text) {
  requireValue(Array.isArray(value) && value.every(predicate) && new Set(value).size === value.length, `Invalid ${label} IDs`);
}
function date(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort(compareText).map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  throw new Error('Only finite, defined JSON values are valid catalog data');
}
export function assertProcessedPlayer(player) {
  keys(player, PLAYER_FIELDS, PLAYER_FIELDS, 'processed player eight public');
  requireValue(decimalId(player.id), 'Player id must remain a decimal string');
  for (const key of ['name', 'slug', 'position', 'imageUrl']) requireValue(text(player[key]), `Invalid processed player ${key}`);
  requireValue(integer(player.overallRating) && player.overallRating <= 200, 'Invalid processed player rating');
  for (const key of ['playingStyle', 'playingStyleDefensive']) requireValue(player[key] === null || typeof player[key] === 'string', 'Invalid processed player playing style');
  let image; try { image = new URL(player.imageUrl); } catch { throw new Error('Invalid processed player image URL'); }
  requireValue(image.protocol === 'https:', 'Invalid processed player image URL');
  return player;
}
export function assertRawPlayer(player, expectedId = player?.id) {
  const required = RAW_PLAYER_FIELDS.filter(key => !['playingStyle', 'playingStyleDefensive'].includes(key));
  keys(player, required, RAW_PLAYER_FIELDS, 'raw player');
  requireValue(decimalId(player.id) && player.id === expectedId, 'Invalid raw player decimal string id');
  requireValue(['name', 'nameJa', 'nameZh', 'slug', 'nationality', 'nationalityCode', 'team', 'position', 'imageUrl'].every(key => typeof player[key] === 'string'), 'Invalid raw player string fields');
  requireValue(['name', 'slug', 'position', 'imageUrl'].every(key => text(player[key])), 'Incomplete raw player fields');
  requireValue(integer(player.overallRating) && player.overallRating <= 200 && Number.isSafeInteger(player.playerType) && player.playerType > 0, 'Invalid raw player rating or type');
  let image; try { image = new URL(player.imageUrl); } catch { throw new Error('Invalid raw player image URL'); }
  requireValue(image.protocol === 'https:', 'Invalid raw player image URL');
  for (const key of ['playingStyle', 'playingStyleDefensive']) requireValue(!Object.hasOwn(player, key) || typeof player[key] === 'string', 'Invalid raw player playing style');
  return player;
}
export function assertRawPack(pack) {
  keys(pack, RAW_PACK_FIELDS, RAW_PACK_FIELDS, 'raw pack');
  requireValue(text(pack.name) && typeof pack.slug === 'string' && /^[a-z\d-]+$/.test(pack.slug) && pack.slug !== 'dummy' && date(pack.date) && integer(pack.playerCount) && pack.playerCount > 0, 'Invalid raw pack values');
  return pack;
}
/** T040 user-confirmed support rule. Prices have no per-sale evidence yet. */
export function createDrawOptions(totalPlayerCount) {
  requireValue(integer(totalPlayerCount) && totalPlayerCount > 0, 'Invalid draw option total player count');
  return {
    single: { supported: true, count: 1, coinCost: null },
    ten: { supported: totalPlayerCount > 11, count: 10, coinCost: null, minimumRemaining: 10 },
    provenance: { authority: 'direct_user_confirmation', reference: 'T040', rule: 'total_player_count_gt_11' },
  };
}
export function assertDrawOptions(options, totalPlayerCount) {
  keys(options, ['single', 'ten', 'provenance'], undefined, 'pack draw options');
  keys(options.single, ['supported', 'count', 'coinCost'], undefined, 'single draw option');
  keys(options.ten, ['supported', 'count', 'coinCost', 'minimumRemaining'], undefined, 'ten draw option');
  keys(options.provenance, ['authority', 'reference', 'rule'], undefined, 'draw option provenance');
  requireValue(canonical(options) === canonical(createDrawOptions(totalPlayerCount)), 'Pack draw options differ from the reviewed total-count rule or contain unverified prices');
  return options;
}
export function assertProcessedPack(pack) {
  // Existing immutable publications stay readable during staged deployment.
  // All newly materialized records include drawOptions; explicit migration
  // adds them to older processed/live/archive generations together.
  keys(pack, LEGACY_PACK_FIELDS, PROCESSED_PACK_FIELDS, 'processed pack');
  requireValue(text(pack.saleId) && text(pack.officialTitle), 'Invalid processed pack identity');
  assertRawPack({ name: pack.name, slug: pack.slug, date: pack.date, playerCount: pack.playerCount });
  requireValue(timestamp(pack.endsAt) && /(?:Z|\+00:00)$/.test(pack.endsAt), 'Pack endsAt must be explicit UTC');
  requireValue(integer(pack.sourceReportedPlayerCount) && integer(pack.totalPlayerCount) && pack.totalPlayerCount > 0, 'Invalid processed pack source/total count');
  requireValue(Array.isArray(pack.members) && pack.members.length === pack.playerCount && pack.playerCount <= pack.totalPlayerCount, 'Effective special count must equal the verified linked cards');
  requireValue(integer(pack.standardPlayerCount) && pack.standardPlayerCount === pack.totalPlayerCount - pack.playerCount, 'Anonymous Standard count must equal official total minus special cards');
  if (Object.hasOwn(pack, 'drawOptions')) assertDrawOptions(pack.drawOptions, pack.totalPlayerCount);
  const ids = [];
  for (const member of pack.members) {
    keys(member, ['id', 'name'], ['id', 'name'], 'pack member');
    requireValue(decimalId(member.id) && text(member.name), 'Invalid processed pack member'); ids.push(member.id);
  }
  idList(ids, 'pack member', decimalId);
  requireValue(object(pack.provenance) && Object.keys(pack.provenance).length > 0, 'Missing processed pack provenance');
  if (pack.sourceReportedPlayerCount === pack.playerCount) requireValue(pack.countCorrection === null, 'Unnecessary count correction');
  else requireValue(object(pack.countCorrection) && ['user_confirmed', 'source_error_confirmed_by_user', 'verified_source_correction'].includes(pack.countCorrection.status) && text(pack.countCorrection.reason), 'Invalid processed pack count correction');
  return pack;
}
export function assertApiUpdateLog(record) {
  keys(record, ['id', 'at', 'targetFile', 'action', 'added', 'updated', 'removed', 'beforeCount', 'afterCount', 'transitions', 'evidence'], undefined, 'API update log');
  requireValue(text(record.id) && timestamp(record.at) && record.action === 'reconcile' && ['processed/players.json', 'processed/packs.json', 'live.json', 'archive.json'].includes(record.targetFile), 'Invalid API update log identity/targetFile');
  for (const key of ['added', 'updated', 'removed']) idList(record[key], key, record.targetFile === 'processed/players.json' ? decimalId : text);
  const all = [...record.added, ...record.updated, ...record.removed];
  requireValue(new Set(all).size === all.length && integer(record.beforeCount) && integer(record.afterCount) && record.afterCount === record.beforeCount + record.added.length - record.removed.length, 'Invalid API update log counts');
  requireValue(Array.isArray(record.transitions), 'Invalid API update log transitions');
  for (const transition of record.transitions) {
    keys(transition, ['saleId', 'action', 'reason'], undefined, 'transition');
    const reasons = { activated: ['verified_new_product'], archived: ['ended', 'official_removed'], reactivated: ['verified_official_return'] };
    requireValue(text(transition.saleId) && all.includes(transition.saleId) && reasons[transition.action]?.includes(transition.reason) && record.targetFile !== 'processed/players.json', 'Invalid API update log transition');
  }
  keys(record.evidence, ['officialObservedAt', 'officialSha256'], undefined, 'API log evidence');
  requireValue(record.evidence.officialObservedAt === null || timestamp(record.evidence.officialObservedAt), 'Invalid API log observation timestamp');
  requireValue(record.evidence.officialSha256 === null || text(record.evidence.officialSha256), 'Invalid API log source hash');
  return record;
}
export function assertRawUpdateLog(record, kind) {
  requireValue(['players', 'packs'].includes(kind), 'Invalid raw log kind');
  const common = ['id', 'at', 'action', 'targetFile', 'beforeCount', 'afterCount', 'addedIds', 'beforeSha256', 'afterSha256'];
  if (record?.action === 'baseline_import') {
    keys(record, [...common, 'importedCount', 'source'], [...common, 'importedCount', 'source', 'sourceUpdate'], 'raw baseline log');
    requireValue(record.beforeCount === null && record.beforeSha256 === null && integer(record.importedCount) && record.importedCount === record.afterCount && record.addedIds.length === 0 && record.source === 'provided_raw_file', 'Invalid raw baseline log values');
    if (Object.hasOwn(record, 'sourceUpdate')) {
      keys(record.sourceUpdate, ['targetFile', 'sha256'], undefined, 'source update evidence');
      requireValue(record.sourceUpdate.targetFile === 'raw/source_player_update.json' && sha(record.sourceUpdate.sha256), 'Invalid source update evidence');
    }
  } else {
    keys(record, [...common, 'addedCount', 'addedRecords', 'evidence'], undefined, 'raw append log');
    requireValue(record.action === 'append' && integer(record.beforeCount) && integer(record.addedCount) && record.addedCount > 0 && record.afterCount === record.beforeCount + record.addedCount && sha(record.beforeSha256), 'Invalid raw append log counts');
    requireValue(Array.isArray(record.addedRecords) && record.addedRecords.length === record.addedCount && record.addedIds.length === record.addedCount, 'Invalid raw append log records');
    record.addedRecords.forEach((value, index) => { if (kind === 'players') assertRawPlayer(value); else assertRawPack(value); requireValue(value[kind === 'players' ? 'id' : 'slug'] === record.addedIds[index], 'Raw append log IDs differ from records'); });
    keys(record.evidence, ['officialObservedAt', 'officialSha256', 'sources'], undefined, 'raw log evidence');
    requireValue(record.evidence.officialObservedAt === null || timestamp(record.evidence.officialObservedAt), 'Invalid raw log timestamp');
    requireValue(record.evidence.officialSha256 === null || text(record.evidence.officialSha256), 'Invalid raw log source hash');
    requireValue(record.evidence.sources === null || Array.isArray(record.evidence.sources), 'Invalid raw log sources');
  }
  idList(record.addedIds, 'raw update', kind === 'players' ? decimalId : text);
  requireValue(text(record.id) && timestamp(record.at) && record.targetFile === `raw/${kind}_raw.json` && integer(record.afterCount) && sha(record.afterSha256), 'Invalid raw update log targetFile/metadata');
  return record;
}
