import { createHash, timingSafeEqual } from 'node:crypto';
import { assertProcessedPlayer, assertProcessedPack, canonical, compareText } from './catalog-contract.mjs';
import { assertPublicationState } from '../scripts/lifecycle/publication.mjs';

const KINDS = ['player', 'pack', 'live', 'archive'];
const MAX_RECORDS = 20000;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_PUBLICATION_BYTES = 16 * 1024 * 1024;
const SHA = /^[a-f0-9]{64}$/;
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
class AdminError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const fail = (status, code, message) => { throw new AdminError(status, code, message); };
const requireValue = (condition, message) => { if (!condition) fail(400, 'invalid_publication', message); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function fields(value, names) { requireValue(plain(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)), 'Unexpected request fields.'); }
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: HEADERS });

function authorize(request, env) {
  // This explicit mode is valid only while Sites dispatch enforces owner-private
  // access. Unattended callers obtain a supported Site service credential for
  // each run; they never persist it in source or schedule prompts.
  if (env.PUBLISH_ACCESS_MODE === 'owner-private') {
    if (request.headers.has('Origin') || request.headers.get('X-Catalog-Publisher') !== '1') fail(401, 'publisher_unauthorized', 'Publisher authentication is required.');
    return;
  }
  const expected = env.ADMIN_PUBLISH_TOKEN;
  if (typeof expected !== 'string' || expected.length < 32) fail(503, 'publisher_unavailable', 'Publisher access is not configured.');
  const supplied = /^Bearer ([^\s]{1,2048})$/.exec(request.headers.get('Authorization') ?? '')?.[1] ?? '';
  const digest = value => createHash('sha256').update(value).digest();
  if (!supplied || !timingSafeEqual(digest(expected), digest(supplied))) fail(401, 'publisher_unauthorized', 'Publisher authentication is required.');
  if (request.headers.has('Origin')) fail(403, 'publisher_origin_forbidden', 'Browser-origin publication requests are not supported.');
}

async function bodyJson(request) {
  if (!(request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase().endsWith('/json')) fail(415, 'json_required', 'Use application/json.');
  const length = request.headers.get('Content-Length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_REQUEST_BYTES)) fail(413, 'request_too_large', 'Publication request exceeds the size limit.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'invalid_json', 'A JSON request body is required.');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) { await reader.cancel(); fail(413, 'request_too_large', 'Publication request exceeds the size limit.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail(400, 'invalid_json', 'The JSON request body is invalid.'); }
}

function assertManifest(value) {
  fields(value, ['schema_version', 'version_id', 'created_at', 'scope', 'counts', 'raw_in_runtime']);
  fields(value.counts, KINDS);
  requireValue(value.schema_version === 2 && SHA.test(value.version_id) && value.scope === 'processed_official_products' && value.raw_in_runtime === false, 'Unsupported publication manifest.');
  requireValue(typeof value.created_at === 'string' && /(?:Z|\+00:00)$/.test(value.created_at) && Number.isFinite(Date.parse(value.created_at)), 'Publication creation time must be UTC.');
  for (const kind of KINDS) requireValue(Number.isSafeInteger(value.counts[kind]) && value.counts[kind] >= 0, 'Publication counts must be nonnegative integers.');
  requireValue(value.counts.live + value.counts.archive === value.counts.pack && Object.values(value.counts).reduce((a, b) => a + b, 0) <= MAX_RECORDS, 'Publication counts exceed the supported scope.');
  return value;
}
function assertRecord(record) {
  fields(record, ['kind', 'key', 'payload']);
  requireValue(KINDS.includes(record.kind) && typeof record.key === 'string' && record.key.length > 0 && record.key.length <= 512 && !/[\u0000-\u001f]/.test(record.key), 'Invalid publication record identity.');
  try {
    if (record.kind === 'player') assertProcessedPlayer(record.payload);
    else if (record.kind === 'pack') assertProcessedPack(record.payload);
    else {
      const { players, archivedAt, archiveReason, ...pack } = record.payload ?? {};
      assertPublicationState({ players, packs: [pack], active: record.kind === 'live' ? [record.payload] : [], archive: record.kind === 'archive' ? [record.payload] : [] });
    }
    requireValue(record.key === (record.kind === 'player' ? record.payload.id : record.payload.saleId), 'Publication record key differs from its payload.');
  } catch (error) { if (error instanceof AdminError) throw error; fail(400, 'invalid_publication', 'A publication record violates the processed data contract.'); }
  return record;
}
async function first(db, sql, values = []) { return db.prepare(sql).bind(...values).first(); }
async function all(db, sql, values = []) { const result = await db.prepare(sql).bind(...values).all(); if (result.success === false) throw new Error('Read failed'); return result.results ?? []; }
async function current(db) { return (await first(db, "SELECT v.version_id,v.manifest_json FROM api_current c JOIN api_versions v ON c.version_id=v.version_id WHERE c.singleton='current'")) ?? null; }
async function version(db, id) {
  const row = await first(db, 'SELECT manifest_json FROM api_versions WHERE version_id=?', [id]);
  if (!row) fail(404, 'publication_not_found', 'The requested publication does not exist.');
  return assertManifest(JSON.parse(row.manifest_json));
}
async function counts(db, id) {
  const result = Object.fromEntries(KINDS.map(kind => [kind, 0]));
  for (const row of await all(db, 'SELECT kind,COUNT(*) AS n FROM api_records WHERE version_id=? GROUP BY kind', [id])) {
    if (!KINDS.includes(row.kind)) fail(409, 'publication_invalid', 'Stored publication contains an unsupported record kind.');
    result[row.kind] = row.n;
  }
  return result;
}
async function verify(db, id) {
  const manifest = await version(db, id);
  const sizes = await first(db, 'SELECT COUNT(*) AS n,COALESCE(SUM(length(CAST(payload_json AS BLOB))),0) AS bytes FROM api_records WHERE version_id=?', [id]);
  if (sizes.n > MAX_RECORDS || sizes.bytes > MAX_PUBLICATION_BYTES) fail(413, 'publication_too_large', 'Stored publication exceeds the verification limit.');
  const rows = await all(db, 'SELECT kind,record_key,payload_json FROM api_records WHERE version_id=?', [id]);
  const groups = Object.fromEntries(KINDS.map(kind => [kind, []]));
  try {
    const records = [];
    for (const row of rows) {
      const record = assertRecord({ kind: row.kind, key: row.record_key, payload: JSON.parse(row.payload_json) });
      groups[record.kind].push(record.payload); records.push(record);
    }
    assertPublicationState({ players: groups.player, packs: groups.pack, active: groups.live, archive: groups.archive });
    records.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || compareText(a.key, b.key));
    const actualCounts = Object.fromEntries(KINDS.map(kind => [kind, groups[kind].length]));
    const actualVersion = createHash('sha256').update(canonical({ schemaVersion: 2, records })).digest('hex');
    if (actualVersion !== id || canonical(actualCounts) !== canonical(manifest.counts)) fail(409, 'publication_invalid', 'Stored publication content or counts do not match its version.');
    return { manifest };
  } catch (error) { if (error instanceof AdminError && error.status === 413) throw error; fail(409, 'publication_invalid', 'Stored publication is incomplete or fails its content checksum and data contract.'); }
}

/** Fixed-schema publication writer. It never accepts SQL or accesses raw tables. */
export async function handlePublicationAdminRequest(request, env = {}) {
  try {
    authorize(request, env);
    if (!env.DB) fail(503, 'database_unavailable', 'The publication database is unavailable.');
    const url = new URL(request.url);
    let path;
    try { path = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean).map(decodeURIComponent); } catch { fail(400, 'invalid_path', 'The request path is invalid.'); }
    if (path.slice(0, 2).join('/') !== 'api/admin' || path.some(part => /[\/\\\u0000-\u001f]/.test(part))) fail(404, 'not_found', 'The publisher endpoint does not exist.');
    const tail = path.slice(2); const db = env.DB;
    if (tail.length === 1 && tail[0] === 'current' && request.method === 'GET') {
      requireValue(url.search === '', 'Unexpected query parameters.');
      const row = await current(db);
      return json({ data: { versionId: row?.version_id ?? null, manifest: row ? JSON.parse(row.manifest_json) : null } });
    }
    if (tail[0] !== 'publications' || tail.length > 3) fail(404, 'not_found', 'The publisher endpoint does not exist.');
    if (tail.length === 1 && request.method === 'POST') {
      requireValue(url.search === '', 'Unexpected query parameters.');
      const body = await bodyJson(request); fields(body, ['manifest']); const manifest = assertManifest(body.manifest);
      const encoded = canonical(manifest);
      const existing = await first(db, 'SELECT manifest_json FROM api_versions WHERE version_id=?', [manifest.version_id]);
      if (existing) {
        const stored = assertManifest(JSON.parse(existing.manifest_json));
        if (canonical({ ...stored, created_at: null }) !== canonical({ ...manifest, created_at: null })) fail(409, 'publication_conflict', 'Publication metadata conflicts with the retained version.');
        return json({ data: { versionId: manifest.version_id, manifest: stored, created: false } });
      }
      await db.batch([db.prepare('INSERT OR IGNORE INTO api_versions(version_id,manifest_json) VALUES(?,?)').bind(manifest.version_id, encoded)]);
      const stored = await version(db, manifest.version_id);
      if (canonical({ ...stored, created_at: null }) !== canonical({ ...manifest, created_at: null })) fail(409, 'publication_conflict', 'Publication metadata conflicts with the retained version.');
      return json({ data: { versionId: manifest.version_id, manifest: stored, created: true } }, 201);
    }
    const id = tail[1];
    if (!SHA.test(id ?? '')) fail(400, 'invalid_version', 'A publication version must be a SHA256 string.');
    if (tail.length === 2 && request.method === 'GET') {
      requireValue(url.search === '', 'Unexpected query parameters.');
      const manifest = await version(db, id); const storedCounts = await counts(db, id);
      return json({ data: { versionId: id, manifest, storedCounts, complete: canonical(storedCounts) === canonical(manifest.counts) } });
    }
    if (tail[2] === 'records' && request.method === 'GET') {
      await version(db, id);
      for (const key of url.searchParams.keys()) requireValue(['offset', 'limit'].includes(key) && url.searchParams.getAll(key).length === 1, 'Unexpected query parameters.');
      const offset = url.searchParams.get('offset') ?? '0'; const limit = url.searchParams.get('limit') ?? '100';
      requireValue(/^\d+$/.test(offset) && Number(offset) <= MAX_RECORDS && /^\d+$/.test(limit) && Number(limit) > 0 && Number(limit) <= 100, 'Invalid record pagination.');
      const storedCounts = await counts(db, id); const total = Object.values(storedCounts).reduce((a, b) => a + b, 0);
      const rows = await all(db, 'SELECT kind,record_key,payload_json FROM api_records WHERE version_id=? ORDER BY kind,record_key LIMIT ? OFFSET ?', [id, Number(limit), Number(offset)]);
      return json({ data: rows.map(row => ({ kind: row.kind, key: row.record_key, payload: JSON.parse(row.payload_json) })), pagination: { offset: Number(offset), limit: Number(limit), nextOffset: Number(offset) + rows.length < total ? Number(offset) + rows.length : null, total } });
    }
    if (url.search) fail(400, 'invalid_publication', 'Unexpected query parameters.');
    if (tail[2] === 'records' && request.method === 'PUT') {
      await version(db, id);
      const body = await bodyJson(request); fields(body, ['records']);
      requireValue(Array.isArray(body.records) && body.records.length > 0 && body.records.length <= 50, 'Upload between one and fifty records per request.');
      const records = body.records.map(assertRecord); const keys = records.map(record => `${record.kind}:${record.key}`);
      requireValue(new Set(keys).size === keys.length, 'A record upload contains duplicate keys.');
      // Per-kind capacity prevents append races after a complete version has
      // been checksum-validated. Existing rows can only replay identical bytes.
      const sql = `INSERT INTO api_records(version_id,kind,record_key,payload_json)
        SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM api_records WHERE version_id=? AND kind=? AND record_key=?)
        OR (SELECT COUNT(*) FROM api_records WHERE version_id=? AND kind=?)<(SELECT json_extract(manifest_json,?) FROM api_versions WHERE version_id=?)
        ON CONFLICT(version_id,kind,record_key) DO UPDATE SET payload_json=CASE WHEN api_records.payload_json=excluded.payload_json THEN api_records.payload_json ELSE NULL END`;
      try {
        await db.batch(records.map(record => db.prepare(sql).bind(id, record.kind, record.key, canonical(record.payload), id, record.kind, record.key, id, record.kind, `$.counts.${record.kind}`, id)));
      } catch { fail(409, 'publication_conflict', 'The immutable publication conflicts with the upload.'); }
      const checks = await db.batch(records.map(record => db.prepare('SELECT payload_json FROM api_records WHERE version_id=? AND kind=? AND record_key=?').bind(id, record.kind, record.key)));
      if (checks.some((result, index) => result.results?.[0]?.payload_json !== canonical(records[index].payload))) fail(409, 'publication_capacity', 'The upload exceeds declared publication counts.');
      return json({ data: { versionId: id, accepted: records.length } });
    }
    if (['verify', 'activate', 'rollback'].includes(tail[2]) && request.method === 'POST') {
      const body = await bodyJson(request);
      if (tail[2] === 'verify') {
        fields(body, []); const { manifest } = await verify(db, id);
        return json({ data: { versionId: id, verified: true, counts: manifest.counts } });
      }
      fields(body, ['expectedVersionId']);
      requireValue(body.expectedVersionId === null || typeof body.expectedVersionId === 'string' && SHA.test(body.expectedVersionId), 'expectedVersionId must be null or a SHA256 string.');
      const before = await current(db); const previousVersionId = before?.version_id ?? null;
      if (previousVersionId !== id && previousVersionId !== body.expectedVersionId) fail(409, 'stale_current', 'The active version changed; read it before retrying.');
      const { manifest } = await verify(db, id);
      const values = [id, id];
      const condition = body.expectedVersionId === null ? "NOT EXISTS(SELECT 1 FROM api_current WHERE singleton='current')" : "EXISTS(SELECT 1 FROM api_current WHERE singleton='current' AND version_id=?)";
      if (body.expectedVersionId !== null) values.push(body.expectedVersionId);
      values.push(id);
      if (body.expectedVersionId !== null) values.push(body.expectedVersionId);
      const updateCondition = body.expectedVersionId === null ? 'api_current.version_id=?' : 'api_current.version_id IN(?,?)';
      await db.batch([db.prepare(`INSERT INTO api_current(singleton,version_id) SELECT 'current',? WHERE EXISTS(SELECT 1 FROM api_current WHERE singleton='current' AND version_id=?) OR ${condition} ON CONFLICT(singleton) DO UPDATE SET version_id=excluded.version_id WHERE ${updateCondition}`).bind(...values)]);
      if ((await current(db))?.version_id !== id) fail(409, 'stale_current', 'The active version changed; the publication was not activated.');
      return json({ data: { versionId: id, previousVersionId, changed: previousVersionId !== id, counts: manifest.counts } });
    }
    fail(405, 'method_not_allowed', 'This publisher method is not supported.');
  } catch (error) {
    if (error instanceof AdminError) return json({ error: { code: error.code, message: error.message } }, error.status);
    return json({ error: { code: 'publisher_unavailable', message: 'The publication service is temporarily unavailable.' } }, 503);
  }
}
