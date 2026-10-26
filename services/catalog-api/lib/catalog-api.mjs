/** Read-only catalog API. Platform authentication stays owned by Sites. */
const PREFIX = '/api/v1';
const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  Vary: 'Origin',
};

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function json(request, value, status = 200, headers = {}) {
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(value), {
    status, headers: { ...JSON_HEADERS, ...headers },
  });
}

function routeFor(url) {
  let parts;
  try { parts = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean).map(decodeURIComponent); }
  catch { throw new ApiError(400, 'invalid_path', 'The request path is malformed.'); }
  if (parts.some(part => /[\/\\\u0000-\u001f]/.test(part))) throw new ApiError(400, 'invalid_path', 'The request path is malformed.');
  if (parts[0] !== 'api' || parts[1] !== 'v1') throw new ApiError(404, 'not_found', 'The endpoint does not exist.');
  const tail = parts.slice(2);
  if (tail.length === 1 && ['health', 'manifest'].includes(tail[0])) return { name: tail[0] };
  if (!['cards', 'packs'].includes(tail[0])) throw new ApiError(404, 'not_found', 'The endpoint does not exist.');
  const kind = tail[0] === 'cards' ? 'card' : 'pack';
  if (tail.length === 1) return { name: 'list', kind };
  if (tail.length > 3 || (tail.length === 3 && (kind !== 'pack' || tail[2] !== 'cards'))) throw new ApiError(404, 'not_found', 'The endpoint does not exist.');
  const id = tail[1];
  if (!id || id.length > 200 || (kind === 'card' && !/^\d+$/.test(id))) throw new ApiError(400, 'invalid_id', 'The source identifier is invalid.');
  return { name: tail.length === 3 ? 'members' : 'detail', kind, id, key: `efhub:${kind}:${id}` };
}

function corsFor(request, env, url) {
  const origin = request.headers.get('Origin');
  if (!origin) return {};
  const allowed = new Set(String(env.CORS_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(value => value && value !== '*'));
  if (origin !== url.origin && !allowed.has(origin)) throw new ApiError(403, 'origin_not_allowed', 'This origin is not allowed.');
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' };
}

function pagination(url, kind, allowQuery = true) {
  const allowed = new Set(allowQuery ? ['limit', 'cursor', 'q'] : ['limit', 'cursor']);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw new ApiError(400, 'invalid_query', 'The query parameters are invalid.');
  }
  const rawLimit = url.searchParams.get('limit') ?? '30';
  if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100) throw new ApiError(400, 'invalid_limit', 'limit must be an integer between 1 and 100.');
  const cursor = url.searchParams.get('cursor') ?? '';
  if (cursor && (!cursor.startsWith(`efhub:${kind}:`) || cursor.length > 240 || /[\u0000-\u001f]/.test(cursor))) throw new ApiError(400, 'invalid_cursor', 'The cursor does not match this collection.');
  const q = url.searchParams.get('q') ?? '';
  if (q.length > 200 || /[\u0000-\u001f]/.test(q)) throw new ApiError(400, 'invalid_query', 'q is too long or contains control characters.');
  return { limit: Number(rawLimit), cursor, q };
}

async function first(db, sql, values = []) { return db.prepare(sql).bind(...values).first(); }
async function all(db, sql, values = []) {
  const result = await db.prepare(sql).bind(...values).all();
  if (result.success === false) throw new Error('Database query failed.');
  return result.results ?? [];
}

async function latestSnapshot(db) {
  return first(db, `SELECT snapshot_id, manifest_json FROM source_snapshots
    ORDER BY json_extract(manifest_json, '$.prepared_at') DESC, snapshot_id DESC LIMIT 1`);
}

function record(row) {
  return {
    ...JSON.parse(row.payload_json),
    _meta: { entity_key: row.entity_key, revision_id: row.revision_id, source_snapshot_id: row.snapshot_id },
  };
}

function page(rows, limit) {
  const hasMore = rows.length > limit;
  const shown = rows.slice(0, limit);
  return { shown, pagination: { limit, next_cursor: hasMore ? shown.at(-1).entity_key : null } };
}

function safeManifest(snapshot) {
  const manifest = JSON.parse(snapshot.manifest_json);
  // Upload manifests may contain local paths. Return only the public contract.
  return {
    snapshot_id: snapshot.snapshot_id,
    schema_version: manifest.schema_version ?? 1,
    prepared_at: manifest.prepared_at ?? null,
    counts: manifest.counts ?? null,
  };
}

/**
 * env.DB follows the D1 prepared statement interface.
 * Import into a fresh/staging database before publishing the first manifest.
 * This endpoint is not an atomic activation mechanism for multi-chunk live writes.
 */
export async function handleCatalogRequest(request, env = {}) {
  let cors = {};
  try {
    const url = new URL(request.url);
    cors = corsFor(request, env, url);
    const route = routeFor(url);
    if (request.method === 'OPTIONS') {
      const requested = request.headers.get('Access-Control-Request-Method');
      if (requested && !['GET', 'HEAD'].includes(requested)) throw new ApiError(405, 'method_not_allowed', 'Only GET and HEAD are supported.');
      return new Response(null, { status: 204, headers: { ...JSON_HEADERS, ...cors, Allow: 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Methods': 'GET, HEAD', 'Access-Control-Allow-Headers': 'Accept, Content-Type' } });
    }
    if (!['GET', 'HEAD'].includes(request.method)) throw new ApiError(405, 'method_not_allowed', 'Only GET and HEAD are supported.');
    if (!env.DB) throw new ApiError(503, 'database_unavailable', 'The catalog database is not configured.');
    const db = env.DB;
    const snapshot = await latestSnapshot(db);
    if (route.name === 'health') {
      const counts = await first(db, `SELECT COALESCE(SUM(kind = 'card'), 0) AS cards,
        COALESCE(SUM(kind = 'pack'), 0) AS packs FROM catalog_entities`);
      return json(request, { data: { service: 'efsimulator-catalog-api', ready: Boolean(snapshot), database: 'connected', counts, latest_snapshot_id: snapshot?.snapshot_id ?? null } }, 200, cors);
    }
    if (route.name === 'manifest') {
      if (!snapshot) throw new ApiError(404, 'catalog_unavailable', 'No imported catalog version is available.');
      return json(request, { data: safeManifest(snapshot) }, 200, cors);
    }
    if (!snapshot) throw new ApiError(503, 'catalog_unavailable', 'No imported catalog version is available.');
    const meta = { schema_version: 1, scope: 'catalog', catalog_snapshot_id: snapshot.snapshot_id };
    if (route.name === 'list') {
      const { limit, cursor, q } = pagination(url, route.kind);
      const escaped = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
      const rows = await all(db, `SELECT e.entity_key, r.revision_id, r.snapshot_id, r.payload_json
        FROM catalog_entities e JOIN entity_revisions r ON r.revision_id = e.current_revision_id
        WHERE e.kind = ? AND e.entity_key > ?
          AND (json_extract(r.payload_json, '$.name') LIKE ? ESCAPE '\\' OR e.source_id LIKE ? ESCAPE '\\')
        ORDER BY e.entity_key LIMIT ?`, [route.kind, cursor, escaped, escaped, limit + 1]);
      const result = page(rows, limit);
      return json(request, { data: result.shown.map(record), pagination: result.pagination, meta }, 200, cors);
    }
    const entity = await first(db, `SELECT e.entity_key, r.revision_id, r.snapshot_id, r.payload_json
      FROM catalog_entities e JOIN entity_revisions r ON r.revision_id = e.current_revision_id
      WHERE e.entity_key = ? AND e.kind = ?`, [route.key, route.kind]);
    if (!entity) throw new ApiError(404, 'not_found', 'The requested catalog record does not exist.');
    if (route.name === 'detail') return json(request, { data: record(entity), meta }, 200, cors);
    const { limit, cursor } = pagination(url, 'card', false);
    const rows = await all(db, `SELECT e.entity_key, r.revision_id, r.snapshot_id, r.payload_json,
        m.evidence_json, m.snapshot_id AS membership_snapshot_id
      FROM pack_memberships m JOIN catalog_entities e ON e.entity_key = m.card_key AND e.kind = 'card'
      JOIN entity_revisions r ON r.revision_id = e.current_revision_id
      WHERE m.pack_key = ? AND m.snapshot_id = (
        SELECT m2.snapshot_id FROM pack_memberships m2
        JOIN source_snapshots s ON s.snapshot_id = m2.snapshot_id WHERE m2.pack_key = ?
        ORDER BY json_extract(s.manifest_json, '$.prepared_at') DESC, m2.snapshot_id DESC LIMIT 1
      ) AND e.entity_key > ? ORDER BY e.entity_key LIMIT ?`, [route.key, route.key, cursor, limit + 1]);
    const result = page(rows, limit);
    return json(request, {
      data: result.shown.map(row => ({ ...record(row), membership: { evidence: JSON.parse(row.evidence_json), source_snapshot_id: row.membership_snapshot_id } })),
      pagination: result.pagination,
      meta: { ...meta, pack_key: route.key, membership_status: JSON.parse(entity.payload_json).membership_status ?? 'unknown' },
    }, 200, cors);
  } catch (error) {
    const known = error instanceof ApiError;
    return json(request, { error: { code: known ? error.code : 'database_unavailable', message: known ? error.message : 'The catalog database is unavailable or not initialized.' } }, known ? error.status : 503, { ...cors, ...(known && error.status === 405 ? { Allow: 'GET, HEAD, OPTIONS' } : {}) });
  }
}
