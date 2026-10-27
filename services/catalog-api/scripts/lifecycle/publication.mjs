import { createHash } from 'node:crypto';
import { assertProcessedPack, assertProcessedPlayer, PROCESSED_PACK_FIELDS, canonical, compareText } from '../../lib/catalog-contract.mjs';
export { canonical } from '../../lib/catalog-contract.mjs';

export const PLAYER_FIELDS = ['id', 'name', 'slug', 'position', 'overallRating', 'playingStyle', 'playingStyleDefensive', 'imageUrl'];
const KINDS = ['player', 'pack', 'live', 'archive'];
const hash = value => createHash('sha256').update(value).digest('hex');
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const requireValue = (value, message) => { if (!value) throw new Error(message); };
const uniqueMap = (values, key, label) => {
  requireValue(Array.isArray(values), `${label} must be an array`);
  const result = new Map();
  for (const value of values) {
    requireValue(value && typeof value[key] === 'string' && value[key], `${label} has an invalid ${key}`);
    requireValue(!result.has(value[key]), `${label} has a duplicate ${key}`);
    result.set(value[key], value);
  }
  return result;
};

/** Validate the complete processed catalog; raw collections are intentionally ignored. */
export function assertPublicationState(state) {
  requireValue(state && typeof state === 'object', 'Publication state is required');
  const players = uniqueMap(state.players, 'id', 'players');
  const packs = uniqueMap(state.packs, 'saleId', 'packs');
  const live = uniqueMap(state.active, 'saleId', 'active');
  const archive = uniqueMap(state.archive, 'saleId', 'archive');
  for (const player of players.values()) {
    requireValue(/^\d+$/.test(player.id), 'Player IDs must remain decimal strings');
    requireValue(Object.keys(player).sort().join(',') === [...PLAYER_FIELDS].sort().join(','), 'Processed players must contain exactly the eight public fields');
    assertProcessedPlayer(player);
  }
  requireValue(live.size + archive.size === packs.size, 'Live and archive must partition processed packs');
  const linked = new Set();
  for (const [saleId, pack] of packs) {
    assertProcessedPack(pack);
    requireValue(!(live.has(saleId) && archive.has(saleId)), 'A sale cannot occur in both live and archive');
    const entry = live.get(saleId) ?? archive.get(saleId);
    requireValue(entry, 'A processed pack is missing from live/archive');
    const expectedFields = [...PROCESSED_PACK_FIELDS, 'players', ...(archive.has(saleId) ? ['archivedAt', 'archiveReason'] : [])].sort(compareText);
    requireValue(canonical(Object.keys(entry).sort(compareText)) === canonical(expectedFields), 'Nested pack fields differ from expected contract');
    if (archive.has(saleId)) requireValue(typeof entry.archivedAt === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(entry.archivedAt) && Number.isFinite(Date.parse(entry.archivedAt)) && ['ended', 'official_removed'].includes(entry.archiveReason), 'Invalid archive transition metadata');
    requireValue(Number.isFinite(Date.parse(pack.endsAt)) && /(?:Z|\+00:00)$/.test(pack.endsAt), 'Pack endsAt must be explicit UTC');
    requireValue(Number.isSafeInteger(pack.totalPlayerCount) && pack.totalPlayerCount >= 0, 'Invalid total player count');
    requireValue(Array.isArray(pack.members), 'Pack members must be an array');
    const memberIds = new Set();
    for (const member of pack.members) {
      requireValue(typeof member.id === 'string' && !memberIds.has(member.id), 'Pack members must have unique string IDs');
      const player = players.get(member.id);
      requireValue(player && member.name === player.name, 'Pack member does not match a processed player');
      memberIds.add(member.id); linked.add(member.id);
    }
    requireValue(memberIds.size <= pack.totalPlayerCount, 'Linked special cards exceed the official total');
    requireValue(pack.playerCount === memberIds.size, 'Effective special count must equal the verified linked cards');
    requireValue(pack.standardPlayerCount === pack.totalPlayerCount - memberIds.size, 'Anonymous Standard count must equal the official total minus verified special cards');
    const nested = uniqueMap(entry.players, 'id', 'nested players');
    requireValue(nested.size === memberIds.size, 'Nested players do not match pack memberships');
    for (const id of memberIds) requireValue(canonical(nested.get(id)) === canonical(players.get(id)), 'Nested player fields differ from the processed player');
    for (const [key, value] of Object.entries(pack)) requireValue(canonical(entry[key]) === canonical(value), `Nested pack field differs: ${key}`);
  }
  requireValue(linked.size === players.size, 'Processed players must equal the deduplicated union of pack memberships');
  return { players, packs, live, archive };
}

/** Produce immutable D1 rows and a separately guarded, single-statement activation. */
export function generatePublication({ state, createdAt = new Date().toISOString(), expectedVersionId = null, chunkSize = 300 } = {}) {
  requireValue(Number.isFinite(Date.parse(createdAt)), 'createdAt must be a timestamp');
  requireValue(Number.isSafeInteger(chunkSize) && chunkSize > 0 && chunkSize <= 1000, 'Invalid SQL chunk size');
  const maps = assertPublicationState(state);
  const records = [];
  for (const [kind, map] of [['player', maps.players], ['pack', maps.packs], ['live', maps.live], ['archive', maps.archive]]) {
    for (const [key, payload] of [...map].sort(([a], [b]) => compareText(a, b))) records.push({ kind, key, payload });
  }
  const versionId = hash(canonical({ schemaVersion: 2, records }));
  const counts = Object.fromEntries(KINDS.map(kind => [kind, records.filter(row => row.kind === kind).length]));
  const manifest = { schema_version: 2, version_id: versionId, created_at: createdAt, scope: 'processed_official_products', counts, raw_in_runtime: false };
  const statements = [`INSERT OR IGNORE INTO api_versions(version_id,manifest_json) VALUES(${literal(versionId)},${literal(canonical(manifest))});`];
  for (const record of records) {
    statements.push(`INSERT INTO api_records(version_id,kind,record_key,payload_json) VALUES(${literal(versionId)},${literal(record.kind)},${literal(record.key)},${literal(canonical(record.payload))}) ON CONFLICT(version_id,kind,record_key) DO UPDATE SET payload_json=CASE WHEN api_records.payload_json=excluded.payload_json THEN api_records.payload_json ELSE NULL END;`);
  }
  const sqlChunks = [];
  for (let offset = 0; offset < statements.length; offset += chunkSize) {
    const sql = statements.slice(offset, offset + chunkSize).join('\n') + '\n';
    sqlChunks.push({ name: `${String(sqlChunks.length).padStart(4, '0')}.sql`, sql, sha256: hash(sql), bytes: Buffer.byteLength(sql) });
  }
  const id = literal(versionId);
  const old = expectedVersionId === null ? null : literal(expectedVersionId);
  const countChecks = KINDS.map(kind => `(SELECT COUNT(*) FROM api_records WHERE version_id=${id} AND kind=${literal(kind)})=${counts[kind]}`);
  const checks = [
    `(SELECT COUNT(*) FROM api_records WHERE version_id=${id})=${records.length}`,
    ...countChecks,
    `NOT EXISTS(SELECT 1 FROM api_records p,json_each(p.payload_json,'$.members') m WHERE p.version_id=${id} AND p.kind='pack' AND NOT EXISTS(SELECT 1 FROM api_records c WHERE c.version_id=${id} AND c.kind='player' AND c.record_key=json_extract(m.value,'$.id')))`,
    `NOT EXISTS(SELECT 1 FROM api_records p WHERE p.version_id=${id} AND p.kind='pack' AND (SELECT COUNT(*) FROM api_records v WHERE v.version_id=${id} AND v.kind IN('live','archive') AND v.record_key=p.record_key)<>1)`,
    old === null
      ? `(NOT EXISTS(SELECT 1 FROM api_current WHERE singleton='current') OR EXISTS(SELECT 1 FROM api_current WHERE singleton='current' AND version_id=${id}))`
      : `EXISTS(SELECT 1 FROM api_current WHERE singleton='current' AND version_id IN(${id},${old}))`,
  ];
  const activateSql = `INSERT INTO api_current(singleton,version_id) SELECT 'current',${id} WHERE EXISTS(SELECT 1 FROM api_versions WHERE version_id=${id}) AND ${checks.join(' AND ')} ON CONFLICT(singleton) DO UPDATE SET version_id=excluded.version_id WHERE api_current.version_id=${id}${old === null ? '' : ` OR api_current.version_id=${old}`};\n`;
  return { versionId, manifest, records, sqlChunks, activateSql, expectedVersionId };
}

/** Call after uploading SQL chunks and before activation, using rows read from the DB. */
export function assertPublicationRows(rows, bundle) {
  const actual = rows.map(row => ({ kind: row.kind, key: row.record_key, payload: JSON.parse(row.payload_json) }))
    .sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || compareText(a.key, b.key));
  requireValue(canonical(actual) === canonical(bundle.records), 'Uploaded publication rows do not match the verified bundle');
  requireValue(hash(canonical({ schemaVersion: 2, records: actual })) === bundle.versionId, 'Publication version checksum mismatch');
}
