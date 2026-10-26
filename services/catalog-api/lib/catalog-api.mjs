/** Read only the processed publication. Raw source/history tables are never queried. */
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
class ApiError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const bad = (code, message) => { throw new ApiError(400, code, message); };
function json(request, value, status = 200, headers = {}) {
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(value), { status, headers: { ...JSON_HEADERS, ...headers } });
}
function routeFor(url) {
  let parts;
  try { parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean).map(decodeURIComponent); } catch { bad('invalid_path', 'The request path is malformed.'); }
  if (parts.some(part => /[\/\\\u0000-\u001f]/.test(part))) bad('invalid_path', 'The request path is malformed.');
  if (parts[0] !== 'api' || parts[1] !== 'v1') throw new ApiError(404, 'not_found', 'The endpoint does not exist.');
  const tail = parts.slice(2);
  if (tail.length === 1 && ['health', 'manifest'].includes(tail[0])) return { name: tail[0] };
  const kind = { cards: 'player', players: 'player', packs: 'pack', live: 'live', archive: 'archive' }[tail[0]];
  if (!kind) throw new ApiError(404, 'not_found', 'The endpoint does not exist.');
  if (tail.length === 1) return { name: 'list', kind };
  if (tail.length > 3 || (tail.length === 3 && (kind !== 'pack' || !['cards', 'players'].includes(tail[2])))) throw new ApiError(404, 'not_found', 'The endpoint does not exist.');
  const id = tail[1];
  if (!id || id.length > 512 || (kind === 'player' && !/^\d+$/.test(id))) bad('invalid_id', 'The identifier is invalid.');
  return { name: tail.length === 3 ? 'members' : 'detail', kind, id };
}
function corsFor(request, env, url) {
  const origin = request.headers.get('Origin');
  if (!origin) return {};
  const allowed = new Set(String(env.CORS_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(value => value && value !== '*'));
  if (origin !== url.origin && !allowed.has(origin)) throw new ApiError(403, 'origin_not_allowed', 'This origin is not allowed.');
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' };
}
const cursorPrefix = kind => kind === 'player' ? 'efhub:card:' : `${kind}:`;
function pagination(url, kind, allowQuery = true) {
  const allowed = new Set(allowQuery ? ['limit', 'cursor', 'q'] : ['limit', 'cursor']);
  for (const key of url.searchParams.keys()) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) bad('invalid_query', 'The query parameters are invalid.');
  const value = url.searchParams.get('limit') ?? '30';
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100) bad('invalid_limit', 'limit must be an integer between 1 and 100.');
  const prefix = cursorPrefix(kind);
  const cursor = url.searchParams.get('cursor') ?? '';
  if (cursor && (!cursor.startsWith(prefix) || cursor.length > 550 || /[\u0000-\u001f]/.test(cursor))) bad('invalid_cursor', 'The cursor does not match this collection.');
  const q = url.searchParams.get('q') ?? '';
  if (q.length > 200 || /[\u0000-\u001f]/.test(q)) bad('invalid_query', 'q is too long or contains control characters.');
  return { limit: Number(value), cursor: cursor.slice(prefix.length), q };
}
async function first(db, sql, values = []) { return db.prepare(sql).bind(...values).first(); }
async function all(db, sql, values = []) {
  const result = await db.prepare(sql).bind(...values).all();
  if (result.success === false) throw new Error('Database query failed.');
  return result.results ?? [];
}
function scope(kind, evaluatedAt) {
  if (kind === 'live') return { sql: "kind='live' AND julianday(json_extract(payload_json,'$.endsAt'))>julianday(?)", values: [evaluatedAt] };
  if (kind === 'archive') return { sql: "(kind='archive' OR (kind='live' AND julianday(json_extract(payload_json,'$.endsAt'))<=julianday(?)))", values: [evaluatedAt] };
  return { sql: 'kind=?', values: [kind] };
}
function payload(row, kind) {
  const result = JSON.parse(row.payload_json);
  if (kind === 'archive' && row.kind === 'live') return { ...result, archivedAt: result.endsAt, archiveReason: 'end_reached', archivePersisted: false };
  return result;
}
function page(rows, limit, kind) {
  const shown = rows.slice(0, limit);
  return { data: shown.map(row => payload(row, kind)), pagination: { limit, next_cursor: rows.length > limit ? cursorPrefix(kind) + shown.at(-1).record_key : null } };
}
async function entity(db, versionId, kind, id, evaluatedAt) {
  const filter = scope(kind, evaluatedAt);
  const exact = await first(db, `SELECT kind,record_key,payload_json FROM api_records WHERE version_id=? AND ${filter.sql} AND record_key=?`, [versionId, ...filter.values, id]);
  if (exact || kind === 'player') return exact;
  // A slug remains a convenient alias only when it identifies exactly one sale round.
  const aliases = await all(db, `SELECT kind,record_key,payload_json FROM api_records WHERE version_id=? AND ${filter.sql} AND json_extract(payload_json,'$.slug')=? LIMIT 2`, [versionId, ...filter.values, id]);
  if (aliases.length > 1) throw new ApiError(409, 'ambiguous_pack', 'Use a saleId to identify the sale round.');
  return aliases[0] ?? null;
}

/** Read one pointer per request and bind every subsequent read to that immutable version. */
export async function handleCatalogRequest(request, env = {}, { now = Date.now() } = {}) {
  let cors = {};
  try {
    const url = new URL(request.url); cors = corsFor(request, env, url);
    const route = routeFor(url);
    if (request.method === 'OPTIONS') {
      const requested = request.headers.get('Access-Control-Request-Method');
      if (requested && !['GET', 'HEAD'].includes(requested)) throw new ApiError(405, 'method_not_allowed', 'Only GET and HEAD are supported.');
      return new Response(null, { status: 204, headers: { ...JSON_HEADERS, ...cors, Allow: 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Methods': 'GET, HEAD', 'Access-Control-Allow-Headers': 'Accept, Content-Type' } });
    }
    if (!['GET', 'HEAD'].includes(request.method)) throw new ApiError(405, 'method_not_allowed', 'Only GET and HEAD are supported.');
    if (!env.DB) throw new ApiError(503, 'database_unavailable', 'The catalog database is not configured.');
    const evaluatedAt = new Date(now).toISOString();
    const db = env.DB;
    const version = await first(db, "SELECT v.version_id,v.manifest_json FROM api_current c JOIN api_versions v ON v.version_id=c.version_id WHERE c.singleton='current'");
    const manifest = version ? JSON.parse(version.manifest_json) : null;
    if (route.name === 'health') {
      return json(request, { data: { service: 'efsimulator-catalog-api', ready: Boolean(version), database: 'connected', counts: manifest?.counts ?? { player: 0, pack: 0, live: 0, archive: 0 }, latest_snapshot_id: version?.version_id ?? null, raw_in_runtime: false } }, 200, cors);
    }
    if (route.name === 'manifest') {
      if (!version) throw new ApiError(404, 'catalog_unavailable', 'No processed catalog version is published.');
      const safe = { schema_version: 2, version_id: version.version_id, snapshot_id: version.version_id, created_at: manifest.created_at ?? null, counts: manifest.counts ?? null, scope: 'processed_official_products', raw_in_runtime: false };
      return json(request, { data: safe }, 200, cors);
    }
    if (!version) throw new ApiError(503, 'catalog_unavailable', 'No processed catalog version is published.');
    const meta = { schema_version: 2, scope: 'processed_official_products', catalog_snapshot_id: version.version_id, evaluated_at: evaluatedAt };
    if (route.name === 'list') {
      const { limit, cursor, q } = pagination(url, route.kind);
      const filter = scope(route.kind, evaluatedAt);
      const escaped = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
      const rows = await all(db, `SELECT kind,record_key,payload_json FROM api_records WHERE version_id=? AND ${filter.sql} AND record_key>? AND (json_extract(payload_json,'$.name') LIKE ? ESCAPE '\\' OR record_key LIKE ? ESCAPE '\\') ORDER BY record_key LIMIT ?`, [version.version_id, ...filter.values, cursor, escaped, escaped, limit + 1]);
      return json(request, { ...page(rows, limit, route.kind), meta }, 200, cors);
    }
    const record = await entity(db, version.version_id, route.kind, route.id, evaluatedAt);
    if (!record) throw new ApiError(404, 'not_found', 'The requested processed record does not exist.');
    if (route.name === 'detail') return json(request, { data: payload(record, route.kind), meta }, 200, cors);
    const { limit, cursor } = pagination(url, 'player', false);
    const pack = JSON.parse(record.payload_json);
    const rows = await all(db, `SELECT c.kind,c.record_key,c.payload_json FROM api_records c WHERE c.version_id=? AND c.kind='player' AND c.record_key>? AND EXISTS(SELECT 1 FROM json_each(?,'$.members') m WHERE json_extract(m.value,'$.id')=c.record_key) ORDER BY c.record_key LIMIT ?`, [version.version_id, cursor, record.payload_json, limit + 1]);
    return json(request, { ...page(rows, limit, 'player'), meta: { ...meta, sale_id: pack.saleId, special_player_count: pack.playerCount, total_player_count: pack.totalPlayerCount } }, 200, cors);
  } catch (error) {
    if (error instanceof ApiError) return json(request, { error: { code: error.code, message: error.message } }, error.status, { ...cors, ...(error.status === 405 ? { Allow: 'GET, HEAD, OPTIONS' } : {}) });
    return json(request, { error: { code: 'database_unavailable', message: 'The processed catalog is temporarily unavailable.' } }, 503, cors);
  }
}
