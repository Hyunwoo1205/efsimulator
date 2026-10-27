#!/usr/bin/env node
import { resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonical, compareText } from '../../lib/catalog-contract.mjs';
import { generatePublication, assertPublicationRows } from './publication.mjs';

const SHA = /^[a-f0-9]{64}$/;
const KINDS = ['player', 'pack', 'live', 'archive'];
const MAX_RECORDS = 20000;
const MAX_BYTES = 16 * 1024 * 1024;
const fail = message => { throw new Error(message); };
const assert = (value, message) => { if (!value) fail(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => canonical(a) === canonical(b);

/** A caller must supply the precise Sites origin; credentials never follow redirects. */
export function validatePublishOrigin(origin) {
  let url;
  try { url = new URL(origin); } catch { fail('A valid API Site origin is required'); }
  assert(url.protocol === 'https:' && url.hostname.endsWith('.chatgpt.site') && url.hostname !== 'chatgpt.site' &&
    !url.username && !url.password && !url.port && url.origin === origin,
  'Use the exact HTTPS chatgpt.site origin without a path, query, credentials, or port');
  return url.origin;
}

function validateToken(token, required, label) {
  if (!required && token === undefined) return;
  assert(typeof token === 'string' && token.length > 0 && token.length <= 32768 && !/[\r\n]/.test(token), `${label} is missing or invalid`);
}

/** Rebuild through the ordinary strict publication contract before any network write. */
export function validateRemotePublication(publication) {
  assert(object(publication) && object(publication.manifest) && Array.isArray(publication.records) && publication.records.length <= MAX_RECORDS,
    'A bounded processed publication is required');
  assert(Buffer.byteLength(JSON.stringify(publication)) <= MAX_BYTES, 'Publication exceeds the remote verification limit');
  const manifest = publication.manifest;
  assert(Object.keys(manifest).sort().join(',') === ['schema_version', 'version_id', 'created_at', 'scope', 'counts', 'raw_in_runtime'].sort().join(','),
    'Publication manifest fields differ from the remote contract');
  const state = { players: [], packs: [], active: [], archive: [] };
  for (const record of publication.records) {
    assert(object(record) && Object.keys(record).sort().join(',') === 'key,kind,payload' && KINDS.includes(record.kind) && typeof record.key === 'string',
      'Publication record fields differ from the remote contract');
    assert(record.key === (record.kind === 'player' ? record.payload?.id : record.payload?.saleId), 'Publication record key does not match payload');
    state[{ player: 'players', pack: 'packs', live: 'active', archive: 'archive' }[record.kind]].push(record.payload);
  }
  const bundle = generatePublication({ state, createdAt: manifest.created_at });
  assert(same(bundle.manifest, manifest) && same(bundle.records, publication.records), 'Publication content or version checksum mismatch');
  return bundle;
}

async function boundedText(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); fail('Remote response exceeds verification limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

export function createPublicationTransport({ origin, serviceToken, adminToken, fetchImpl = fetch, timeoutMs = 30000 }) {
  origin = validatePublishOrigin(origin);
  validateToken(serviceToken, true, 'Site service credential');
  validateToken(adminToken, false, 'Publisher credential');
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 120000, 'Invalid request timeout');
  return async function request(path, { method = 'GET', body } = {}) {
    assert(typeof path === 'string' && /^\/api\/(?:admin\/|v1\/)/.test(path) && !/[\r\n\\#]/.test(path), 'Unexpected publication request path');
    const url = new URL(path, origin);
    assert(url.origin === origin, 'Publication request origin changed');
    const headers = { Accept: 'application/json', 'OAI-Sites-Authorization': `Bearer ${serviceToken}`, 'X-Catalog-Publisher': '1' };
    if (adminToken !== undefined) headers.Authorization = `Bearer ${adminToken}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetchImpl(url.href, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(timeoutMs) });
    } catch { fail('Remote publication request failed; no credential details are logged'); }
    assert(!response.redirected && !(response.status >= 300 && response.status < 400), 'Remote publication redirect refused');
    if (response.url) assert(new URL(response.url).origin === origin, 'Remote publication response origin changed');
    if (!response.ok) fail(`Remote publication request returned HTTP ${response.status}`);
    assert((response.headers.get('content-type') ?? '').toLowerCase().includes('application/json'), 'Remote publication response is not JSON');
    let result;
    try { result = JSON.parse(await boundedText(response)); }
    catch { fail('Remote publication response is invalid or too large'); }
    assert(object(result) && !result.error && Object.hasOwn(result, 'data'), 'Remote publication response has an invalid envelope');
    return result;
  };
}

async function readRows(request, versionId) {
  const records = [];
  let offset = 0;
  let expectedTotal;
  while (true) {
    const result = await request(`/api/admin/publications/${versionId}/records?offset=${offset}&limit=100`);
    assert(Array.isArray(result.data) && object(result.pagination), 'Remote records response is invalid');
    const page = result.pagination;
    assert(page.offset === offset && page.limit === 100 && Number.isSafeInteger(page.total) && page.total >= 0 && page.total <= MAX_RECORDS,
      'Remote record pagination is invalid');
    if (expectedTotal === undefined) expectedTotal = page.total;
    assert(page.total === expectedTotal && result.data.length <= 100, 'Remote record pagination changed during verification');
    records.push(...result.data);
    assert(records.length <= MAX_RECORDS && records.length <= expectedTotal, 'Remote records exceed expected total');
    if (page.nextOffset === null) {
      assert(records.length === expectedTotal, 'Remote publication readback is incomplete');
      return records;
    }
    assert(result.data.length > 0 && page.nextOffset === offset + result.data.length && page.nextOffset < expectedTotal,
      'Remote record pagination did not advance');
    offset = page.nextOffset;
  }
}

async function readCurrent(request) {
  const result = (await request('/api/admin/current')).data;
  assert(object(result) && (result.versionId === null || typeof result.versionId === 'string' && SHA.test(result.versionId)), 'Remote current version is invalid');
  return result.versionId;
}

async function verifyRows(request, bundle) {
  const records = await readRows(request, bundle.versionId);
  assertPublicationRows(records.map(record => ({ kind: record.kind, record_key: record.key, payload_json: JSON.stringify(record.payload) })), bundle);
}

async function readPublicCollection(request, name, snapshotId) {
  const values = [];
  const seen = new Set();
  let cursor = null;
  do {
    const result = await request(`/api/v1/${name}?limit=100${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`);
    assert(Array.isArray(result.data) && result.meta?.catalog_snapshot_id === snapshotId && object(result.pagination), 'Public API snapshot differs from publication');
    values.push(...result.data);
    assert(values.length <= MAX_RECORDS, 'Public API collection exceeds verification limit');
    const next = result.pagination.next_cursor;
    assert(next === null || typeof next === 'string' && next.length > 0 && !seen.has(next), 'Public API pagination did not advance');
    if (next !== null) seen.add(next);
    cursor = next;
  } while (cursor !== null);
  return values;
}

async function verifyPublic(request, bundle) {
  const health = (await request('/api/v1/health')).data;
  assert(health?.ready === true && health.latest_snapshot_id === bundle.versionId && same(health.counts, bundle.manifest.counts), 'Public API is not ready with the verified publication');
  const manifest = (await request('/api/v1/manifest')).data;
  assert(manifest?.version_id === bundle.versionId && same(manifest.counts, bundle.manifest.counts) && manifest.raw_in_runtime === false, 'Public API manifest differs from publication');
  for (const [name, kind, key] of [['players', 'player', 'id'], ['packs', 'pack', 'saleId']]) {
    const actual = await readPublicCollection(request, name, bundle.versionId);
    const expected = bundle.records.filter(record => record.kind === kind).map(record => record.payload);
    const order = (a, b) => compareText(a[key], b[key]);
    assert(same(actual.sort(order), expected.sort(order)), `Public API ${name} differ from verified publication`);
  }
}

/** Upload, read back, then CAS activate. A replay of the current content performs no writes. */
export async function publishRemote(options) {
  const bundle = validateRemotePublication(options.publication);
  const request = createPublicationTransport(options);
  const previousVersionId = await readCurrent(request);
  const expected = Object.hasOwn(options, 'expectedVersionId') ? options.expectedVersionId : previousVersionId;
  assert(expected === null || typeof expected === 'string' && SHA.test(expected), 'Expected remote version is invalid');
  if (previousVersionId !== bundle.versionId) {
    assert(previousVersionId === expected, 'Remote current version changed; publication was not uploaded');
    await request('/api/admin/publications', { method: 'POST', body: { manifest: bundle.manifest } });
    for (let offset = 0; offset < bundle.records.length; offset += 50) {
      await request(`/api/admin/publications/${bundle.versionId}/records`, { method: 'PUT', body: { records: bundle.records.slice(offset, offset + 50) } });
    }
  }
  await verifyRows(request, bundle);
  if (previousVersionId !== bundle.versionId) {
    await request(`/api/admin/publications/${bundle.versionId}/activate`, { method: 'POST', body: { expectedVersionId: expected } });
  }
  assert(await readCurrent(request) === bundle.versionId, 'Remote activation did not select the verified publication');
  await verifyPublic(request, bundle);
  return { operation: 'publish', versionId: bundle.versionId, previousVersionId, changed: previousVersionId !== bundle.versionId,
    counts: bundle.manifest.counts, verified: true };
}

/** Restore only a retained, completely verified publication; never erase current rows. */
export async function rollbackRemote(options) {
  assert(typeof options.versionId === 'string' && SHA.test(options.versionId), 'Rollback publication version is invalid');
  const request = createPublicationTransport(options);
  const previousVersionId = await readCurrent(request);
  const expected = Object.hasOwn(options, 'expectedVersionId') ? options.expectedVersionId : previousVersionId;
  assert(expected === null || typeof expected === 'string' && SHA.test(expected), 'Expected remote version is invalid');
  assert(previousVersionId === options.versionId || previousVersionId === expected, 'Remote current version changed; rollback was not attempted');
  const details = (await request(`/api/admin/publications/${options.versionId}`)).data;
  assert(details?.versionId === options.versionId && object(details.manifest), 'Retained publication metadata is invalid');
  const records = await readRows(request, options.versionId);
  records.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || compareText(a.key, b.key));
  const bundle = validateRemotePublication({ manifest: details.manifest, records });
  if (previousVersionId !== bundle.versionId) {
    await request(`/api/admin/publications/${bundle.versionId}/rollback`, { method: 'POST', body: { expectedVersionId: expected } });
  }
  assert(await readCurrent(request) === bundle.versionId, 'Remote rollback did not select the verified publication');
  await verifyPublic(request, bundle);
  return { operation: 'rollback', versionId: bundle.versionId, previousVersionId, changed: previousVersionId !== bundle.versionId,
    counts: bundle.manifest.counts, verified: true };
}

async function main() {
  const args = process.argv.slice(2);
  assert(args.length === 0 || args.length === 2 && args[0] === '--root' && isAbsolute(args[1]),
    'Usage: publish-remote.mjs [--root ABSOLUTE_WORKSPACE]; pass credentials and options as JSON on stdin');
  let bytes = 0;
  const chunks = [];
  for await (const chunk of process.stdin) { bytes += chunk.length; assert(bytes <= MAX_BYTES, 'Publisher stdin exceeds size limit'); chunks.push(chunk); }
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('Publisher stdin must contain one JSON object'); }
  assert(object(input), 'Publisher stdin must contain one JSON object');
  if (input.operation !== 'rollback' && args.length) {
    assert(input.publication === undefined, 'Choose workspace or explicit publication, not both');
    const { loadWorkspace } = await import('./workspace.mjs');
    const loaded = await loadWorkspace(args[1]);
    assert(loaded.policy?.rulesIdentity && loaded.policy?.approval, 'Workspace must have pinned reviewed rules');
    const bundle = generatePublication({ state: loaded.state, createdAt: loaded.manifest.createdAt });
    input.publication = { manifest: bundle.manifest, records: bundle.records };
  }
  assert(input.operation === undefined || ['publish', 'rollback'].includes(input.operation), 'Unknown publication operation');
  const result = await (input.operation === 'rollback' ? rollbackRemote(input) : publishRemote(input));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
