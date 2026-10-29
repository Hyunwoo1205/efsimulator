#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonical, compareText, assertProcessedPack, assertProcessedPlayer } from '../../lib/catalog-contract.mjs';

export const SITE_ORIGINS = Object.freeze({
  api: 'https://efsimulator-catalog-api.hyunw09.chatgpt.site',
  viewer: 'https://efsimulator-catalog.hyunw09.chatgpt.site',
  app: 'https://efsimulator.hyunw09.chatgpt.site',
});
const SHA = /^[a-f0-9]{64}$/;
const COLLECTIONS = ['players', 'packs', 'live', 'archive'];
const MAX_RECORDS = 20000;
const MAX_PAGES = 201;
const MAX_BYTES = 2 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => canonical(a) === canonical(b);
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const keys = (value, names) => object(value) && Object.keys(value).sort().join(',') === [...names].sort().join(',');
const countShape = value => keys(value, ['player', 'pack', 'live', 'archive']) && Object.values(value).every(n => Number.isSafeInteger(n) && n >= 0 && n <= MAX_RECORDS) && value.live + value.archive === value.pack;

function validateInput(input) {
  ensure(keys(input, ['expectedVersionId', 'sites']) && typeof input.expectedVersionId === 'string' && SHA.test(input.expectedVersionId), 'Invalid site verification input');
  ensure(keys(input.sites, Object.keys(SITE_ORIGINS)), 'All three site connections are required');
  for (const [name, origin] of Object.entries(SITE_ORIGINS)) {
    const site = input.sites[name];
    ensure(keys(site, ['origin', 'serviceToken']) && site.origin === origin, 'Site origin is not the exact allowed origin');
    ensure(typeof site.serviceToken === 'string' && site.serviceToken.length > 0 && site.serviceToken.length <= 32768 && !/[\r\n]/.test(site.serviceToken), 'Invalid site credential');
  }
}

async function bodyJson(response) {
  ensure(response.body, 'Site response body is missing');
  const reader = response.body.getReader();
  const chunks = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error('Site response exceeds verification limit'); }
      chunks.push(value);
    }
  } catch { throw new Error('Site response is unreadable or exceeds verification limit'); }
  finally { reader.releaseLock(); }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Site response is invalid JSON'); }
  ensure(object(value) && Object.hasOwn(value, 'data') && !value.error, 'Site response has an invalid envelope');
  return value;
}

function createReader(site, fetchImpl, timeoutMs) {
  return async path => {
    // Every path is constructed internally. Credentials never follow redirects.
    const url = new URL(path, site.origin);
    ensure(url.origin === site.origin && /^\/api\/v1\/(?:health|manifest|players|packs|live|archive)$/.test(url.pathname), 'Unexpected verification route');
    let response;
    try {
      response = await fetchImpl(url.href, { method: 'GET', redirect: 'error', credentials: 'omit',
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache', 'OAI-Sites-Authorization': `Bearer ${site.serviceToken}` },
        signal: AbortSignal.timeout(timeoutMs) });
    } catch { throw new Error('Site verification request failed'); }
    ensure(!response.redirected && response.status === 200 && (!response.url || new URL(response.url).origin === site.origin), 'Site verification HTTP response rejected');
    ensure(/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? ''), 'Site verification requires a JSON response');
    return await bodyJson(response);
  };
}

async function collection(read, name, expectedVersionId) {
  const records = []; const cursors = new Set(); let cursor = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await read(`/api/v1/${name}?limit=100${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`);
    ensure(Array.isArray(response.data) && response.data.length <= 100 && response.meta?.catalog_snapshot_id === expectedVersionId && object(response.pagination) && response.pagination.limit === 100, 'Site collection version or pagination is invalid');
    records.push(...response.data);
    ensure(records.length <= MAX_RECORDS, 'Site collection exceeds record limit');
    const next = response.pagination.next_cursor;
    if (next === null) return records.sort((a, b) => compareText(a?.[name === 'players' ? 'id' : 'saleId'] ?? '', b?.[name === 'players' ? 'id' : 'saleId'] ?? ''));
    ensure(typeof next === 'string' && next.length > 0 && next.length <= 550 && !/[\u0000-\u001f]/.test(next) && response.data.length > 0 && !cursors.has(next), 'Site collection pagination did not advance');
    cursors.add(next); cursor = next;
  }
  throw new Error('Site collection exceeds page limit');
}

function validateCatalog(data, manifestCounts) {
  try {
    for (const player of data.players) assertProcessedPlayer(player);
    for (const pack of data.packs) assertProcessedPack(pack);
    const players = new Map(data.players.map(player => [player.id, player]));
    const packs = new Map(data.packs.map(pack => [pack.saleId, pack]));
    ensure(players.size === data.players.length && packs.size === data.packs.length && players.size === manifestCounts.player && packs.size === manifestCounts.pack, 'Catalog duplicate identity or count mismatch');
    const partition = new Set(); const referenced = new Set();
    for (const [name, records] of [['live', data.live], ['archive', data.archive]]) {
      for (const record of records) {
        ensure(object(record) && Array.isArray(record.players), 'Embedded pack is invalid');
        const { players: nested, archivedAt, archiveReason, archivePersisted, ...pack } = record;
        ensure(packs.has(pack.saleId) && !partition.has(pack.saleId) && same(pack, packs.get(pack.saleId)), 'Live/archive does not partition the packs');
        partition.add(pack.saleId);
        if (name === 'live') ensure(!Object.hasOwn(record, 'archivedAt') && !Object.hasOwn(record, 'archiveReason') && !Object.hasOwn(record, 'archivePersisted'), 'Live pack includes archive fields');
        else {
          ensure(typeof archivedAt === 'string' && /Z$/.test(archivedAt) && Number.isFinite(Date.parse(archivedAt)) && ['ended', 'official_removed', 'end_reached'].includes(archiveReason), 'Archive transition is invalid');
          ensure(!Object.hasOwn(record, 'archivePersisted') || archivePersisted === false && archiveReason === 'end_reached', 'Archive persistence marker is invalid');
        }
        const expected = pack.members.map(member => {
          const player = players.get(member.id);
          ensure(player && player.name === member.name, 'Pack references unknown player');
          referenced.add(member.id); return player;
        });
        ensure(same(nested, expected), 'Embedded player content differs');
      }
    }
    ensure(partition.size === packs.size && referenced.size === players.size, 'Catalog partition or player references are incomplete');
  } catch { throw new Error('Site catalog contract validation failed'); }
}

async function verifyOne(site, expectedVersionId, options) {
  const read = createReader(site, options.fetchImpl, options.timeoutMs);
  const health = (await read('/api/v1/health')).data;
  ensure(health?.ready === true && health.database === 'connected' && health.raw_in_runtime === false && health.latest_snapshot_id === expectedVersionId && countShape(health.counts), 'Site health does not match the expected publication');
  const manifest = (await read('/api/v1/manifest')).data;
  ensure(manifest?.version_id === expectedVersionId && manifest.raw_in_runtime === false && manifest.scope === 'processed_official_products' && countShape(manifest.counts) && same(manifest.counts, health.counts), 'Site manifest does not match the expected publication');
  const data = {};
  for (const name of COLLECTIONS) data[name] = await collection(read, name, expectedVersionId);
  validateCatalog(data, manifest.counts);
  const finalManifest = (await read('/api/v1/manifest')).data;
  ensure(same(manifest, finalManifest), 'Site publication changed during verification');
  return { data, manifestCounts: manifest.counts };
}

/** Read-only end-to-end verification; returns hashes/counts and never source data or credentials. */
export async function verifySites(input, { fetchImpl = globalThis.fetch, timeoutMs = 30000, now = () => new Date() } = {}) {
  validateInput(input);
  ensure(Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 120000 && typeof fetchImpl === 'function', 'Invalid verification transport options');
  const results = {};
  for (const name of Object.keys(SITE_ORIGINS)) results[name] = await verifyOne(input.sites[name], input.expectedVersionId, { fetchImpl, timeoutMs });
  const baseline = results.api;
  for (const name of ['viewer', 'app']) ensure(same(results[name], baseline), 'Site relay content differs from the API publication');
  const verifiedAt = now().toISOString();
  return { schemaVersion: 1, operation: 'verify_sites', publicationVersion: input.expectedVersionId, verifiedAt, verified: true,
    counts: { player: baseline.data.players.length, pack: baseline.data.packs.length, live: baseline.data.live.length, archive: baseline.data.archive.length },
    manifestCounts: baseline.manifestCounts,
    collectionSha256: Object.fromEntries(COLLECTIONS.map(name => [name, digest(baseline.data[name])])),
    sites: Object.fromEntries(Object.entries(SITE_ORIGINS).map(([name, origin]) => [name, { origin, verified: true }])) };
}

async function main() {
  ensure(process.argv.length === 2, 'Pass verification options as JSON on stdin only');
  const chunks = []; let bytes = 0;
  for await (const chunk of process.stdin) { bytes += chunk.length; ensure(bytes <= 128 * 1024, 'Verification input exceeds limit'); chunks.push(chunk); }
  let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Invalid verification JSON input'); }
  process.stdout.write(`${JSON.stringify(await verifySites(input), null, 2)}\n`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
