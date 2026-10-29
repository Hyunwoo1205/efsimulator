#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, lstat, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const UPDATE_RECORD_PATH = 'data/updates/catalog-latest.json';
const SHA = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const TARGETS = ['raw/players_raw.json', 'raw/packs_raw.json', 'processed/players.json', 'processed/packs.json', 'live.json', 'archive.json', 'logs/players_raw_updates.jsonl', 'logs/packs_raw_updates.jsonl', 'logs/api_updates.jsonl'];
const COUNTS = ['rawPlayers', 'rawPacks', 'players', 'packs', 'live', 'archive'];
const CHANGES = ['rawPlayersAdded', 'rawPacksAdded', 'playersAdded', 'playersUpdated', 'packsAdded', 'packsUpdated', 'archivedPacks'];
const PHASES = ['bundle', 'api', 'sites', 'github'];
const EVIDENCE = ['bundleSha256', 'sourceReceiptSha256', 'sitesReceiptSha256', 'officialHtmlSha256', 'efhubHtmlSha256'];
const STATUS = ['verified', 'pending', 'failed', 'not_required'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
const keys = (value, names) => object(value) && Object.keys(value).sort().join(',') === [...names].sort().join(',');
const natural = value => Number.isSafeInteger(value) && value >= 0;
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  ensure(object(value), 'Update record must contain only JSON values');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');

/** Whitelist-only Git evidence. This is not a source-data or credential container. */
export function buildCatalogUpdateRecord(input) {
  ensure(keys(input, ['schemaVersion', 'operation', 'observedAt', 'sourceCommit', 'runtimeVersion', 'publicationVersion', 'rulesIdentity', 'counts', 'changes', 'phases', 'evidence']), 'Invalid update record fields');
  ensure(input.schemaVersion === 1 && ['data_update', 'verification'].includes(input.operation), 'Invalid update record operation');
  ensure(typeof input.observedAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.observedAt) && Number.isFinite(Date.parse(input.observedAt)) && new Date(input.observedAt).toISOString() === input.observedAt, 'Update record time must be canonical UTC');
  ensure(typeof input.sourceCommit === 'string' && COMMIT.test(input.sourceCommit) && ['runtimeVersion', 'publicationVersion'].every(key => typeof input[key] === 'string' && SHA.test(input[key])), 'Update record identities must be hashes');
  ensure(keys(input.rulesIdentity, ['version', 'sha256']) && typeof input.rulesIdentity.version === 'string' && /^catalog-rules-\d+\.\d+\.\d+$/.test(input.rulesIdentity.version) && typeof input.rulesIdentity.sha256 === 'string' && SHA.test(input.rulesIdentity.sha256), 'Invalid update record rules identity');
  ensure(keys(input.counts, COUNTS) && Object.values(input.counts).every(natural) && input.counts.live + input.counts.archive === input.counts.packs && input.counts.players <= input.counts.rawPlayers && input.counts.packs <= input.counts.rawPacks, 'Invalid update record counts');
  ensure(keys(input.changes, [...CHANGES, 'targetFiles']) && CHANGES.every(key => natural(input.changes[key])) && Array.isArray(input.changes.targetFiles) && input.changes.targetFiles.every(path => TARGETS.includes(path)) && new Set(input.changes.targetFiles).size === input.changes.targetFiles.length, 'Invalid update record changes');
  ensure(keys(input.phases, PHASES) && Object.values(input.phases).every(value => STATUS.includes(value)) && input.phases.github === 'pending', 'GitHub phase must remain pending until external commit verification');
  ensure(keys(input.evidence, EVIDENCE) && Object.values(input.evidence).every(value => value === null || typeof value === 'string' && SHA.test(value)), 'Invalid update record evidence hashes');
  if (input.operation === 'verification') ensure(CHANGES.every(key => input.changes[key] === 0) && input.changes.targetFiles.length === 0, 'Verification cannot claim data changes');
  if (input.operation === 'data_update') ensure(input.changes.targetFiles.length > 0, 'A data update requires changed target files');
  ensure(input.phases.bundle !== 'verified' || input.evidence.bundleSha256 !== null, 'Verified bundle requires a saved archive hash');
  ensure(input.phases.sites !== 'verified' || input.evidence.sitesReceiptSha256 !== null && input.phases.api === 'verified', 'Verified sites require API and site verification evidence');
  const record = structuredClone(input);
  record.changes.targetFiles.sort();
  // Status/retry timestamps can advance without inventing a new data operation.
  const runId = digest({ operation: record.operation, runtimeVersion: record.runtimeVersion, publicationVersion: record.publicationVersion });
  return { ...record, runId };
}

export function assertCatalogUpdateRecord(record) {
  ensure(object(record) && typeof record.runId === 'string' && SHA.test(record.runId), 'Invalid stored update record identity');
  const { runId: _runId, ...input } = record;
  const expected = buildCatalogUpdateRecord(input);
  ensure(canonical(record) === canonical(expected), 'Stored update record differs from its validated canonical schema');
  return expected;
}

export async function checkCatalogUpdateRecord(repositoryRoot) {
  const destination = join(resolve(repositoryRoot), UPDATE_RECORD_PATH);
  ensure(!(await lstat(destination)).isSymbolicLink(), 'Update record may not be a symlink');
  const bytes = await readFile(destination, 'utf8');
  ensure(Buffer.byteLength(bytes) <= 64 * 1024, 'Stored update record exceeds limit');
  const record = assertCatalogUpdateRecord(JSON.parse(bytes));
  return { path: UPDATE_RECORD_PATH, runId: record.runId, valid: true };
}

/** Write exactly one registered repository path; never stage files or push Git. */
export async function writeCatalogUpdateRecord(input, repositoryRoot) {
  const record = buildCatalogUpdateRecord(input);
  const root = resolve(repositoryRoot);
  const destination = join(root, UPDATE_RECORD_PATH);
  // Refuse symlinked path components so a fixed logical path cannot write elsewhere.
  for (const path of [root, join(root, 'data'), dirname(destination), destination]) {
    try { ensure(!(await lstat(path)).isSymbolicLink(), 'Update record path may not use symlinks'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const bytes = `${JSON.stringify(record, null, 2)}\n`;
  try {
    const existing = assertCatalogUpdateRecord(JSON.parse(await readFile(destination, 'utf8')));
    // A retry cannot create a Git change solely from a fresh check time, a new
    // developer commit or new packaging/source-check evidence. Preserve the
    // first receipt until a data identity, rule/count/change or phase changes.
    const material = value => ({ runId: value.runId, rulesIdentity: value.rulesIdentity, counts: value.counts, changes: value.changes, phases: value.phases });
    if (canonical(material(existing)) === canonical(material(record))) return { path: UPDATE_RECORD_PATH, runId: record.runId, changed: false };
  }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    await rename(temporary, destination);
  } finally { await rm(temporary, { force: true }); }
  return { path: UPDATE_RECORD_PATH, runId: record.runId, changed: true };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 2 && args[0] === '--check') {
    ensure(args[1] === UPDATE_RECORD_PATH, 'Only the fixed registered update record path may be checked');
    process.stdout.write(`${JSON.stringify(await checkCatalogUpdateRecord(process.cwd()))}\n`); return;
  }
  ensure(args.length === 0 || args.length === 2 && args[0] === '--write-root', 'Usage: catalog-update-record.mjs [--write-root REPOSITORY]; JSON on stdin');
  const chunks = []; let bytes = 0;
  for await (const chunk of process.stdin) { bytes += chunk.length; ensure(bytes <= 64 * 1024, 'Update record input exceeds limit'); chunks.push(chunk); }
  let input; try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Invalid update record JSON input'); }
  const result = args.length ? await writeCatalogUpdateRecord(input, args[1]) : buildCatalogUpdateRecord(input);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(() => { console.error('Catalog update record validation or write failed'); process.exitCode = 1; });
