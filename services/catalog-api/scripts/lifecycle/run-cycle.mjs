#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { collectCycle } from './collect-cycle.mjs';
import { loadWorkspace, applyCycle } from './workspace.mjs';
import { generatePublication, assertPublicationRows } from './publication.mjs';
import { canonical } from '../../lib/catalog-contract.mjs';
import { assertApprovedMappings } from './rules.mjs';
import { collectReviewedCache } from './reviewed-cache.mjs';

async function writeImmutable(path, bytes) {
  try { await writeFile(path, bytes, { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!(await readFile(path)).equals(Buffer.from(bytes))) throw new Error(`Immutable publication file differs: ${path}`);
  }
}

/** Offline/local only. Hosted D1 imports require the authenticated Sites path. */
export async function preparePublication({ state, out, dbPath, now = new Date().toISOString() }) {
  let db;
  let expectedVersionId = null;
  if (dbPath) {
    await mkdir(resolve(dbPath, '..'), { recursive: true });
    db = new DatabaseSync(dbPath);
    for (const migration of ['0000_productive_khan.sql', '0001_api_publications.sql']) {
      // Apply once, in order. Existing tables indicate an already applied schema.
      const marker = migration.startsWith('0000') ? 'source_snapshots' : 'api_versions';
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(marker)) {
        const sql = await readFile(new URL(`../../drizzle/${migration}`, import.meta.url), 'utf8');
        db.exec(sql);
      }
    }
    expectedVersionId = db.prepare("SELECT version_id FROM api_current WHERE singleton='current'").get()?.version_id ?? null;
  }
  try {
    let bundle = generatePublication({ state, createdAt: now, expectedVersionId });
    const folder = join(out, bundle.versionId);
    let existingManifest;
    try { existingManifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existingManifest) {
      if (existingManifest.version_id !== bundle.versionId || canonical(existingManifest.counts) !== canonical(bundle.manifest.counts) || existingManifest.scope !== bundle.manifest.scope) throw new Error('Existing publication manifest differs from verified content');
      // Observation-only replays retain the first export timestamp and bytes.
      bundle = generatePublication({ state, createdAt: existingManifest.created_at, expectedVersionId });
    }
    await mkdir(join(folder, 'sql'), { recursive: true });
    for (const chunk of bundle.sqlChunks) {
      if (createHash('sha256').update(chunk.sql).digest('hex') !== chunk.sha256) throw new Error('Publication chunk checksum mismatch');
      await writeImmutable(join(folder, 'sql', chunk.name), chunk.sql);
    }
    const manifest = { ...bundle.manifest, expected_version_id: existingManifest ? existingManifest.expected_version_id : expectedVersionId,
      chunks: bundle.sqlChunks.map(({ sql: _sql, ...metadata }) => metadata) };
    if (existingManifest && canonical(existingManifest) !== canonical(manifest)) throw new Error('Immutable publication manifest differs');
    await writeImmutable(join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    const firstActivation = generatePublication({ state, createdAt: manifest.created_at, expectedVersionId: manifest.expected_version_id });
    await writeImmutable(join(folder, 'activate.sql'), firstActivation.activateSql);
    // Activation leases can differ while content is identical; keep each lease
    // separately instead of overwriting the immutable version's first export.
    await mkdir(join(folder, 'activations'), { recursive: true });
    const activationFile = join(folder, 'activations', `${createHash('sha256').update(bundle.activateSql).digest('hex')}.sql`);
    await writeImmutable(activationFile, bundle.activateSql);
    if (db) {
      for (const chunk of bundle.sqlChunks) {
        db.exec('BEGIN IMMEDIATE');
        try { db.exec(chunk.sql); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
      }
      const rows = db.prepare('SELECT kind,record_key,payload_json FROM api_records WHERE version_id=?').all(bundle.versionId);
      assertPublicationRows(rows, bundle);
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec(bundle.activateSql);
        if (db.prepare("SELECT version_id FROM api_current WHERE singleton='current'").get()?.version_id !== bundle.versionId) throw new Error('Publication activation rejected: stale version or incomplete import');
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    return { versionId: bundle.versionId, counts: bundle.manifest.counts, folder, activationFile, locallyActivated: Boolean(db), hostedActivated: false };
  } finally { db?.close(); }
}

export async function runCycle({ root, mappingsPath, publicationOut = join(root, 'publications'), dbPath, fetchHtml, reviewedCachePath, now = new Date().toISOString() }) {
  const before = await loadWorkspace(root);
  const mappingFile = JSON.parse(await readFile(mappingsPath, 'utf8'));
  if (!before.policy?.approval || !before.policy?.rulesIdentity) throw new Error('Workspace has no pinned rules/mapping policy; explicitly adopt the reviewed policy before a cycle');
  assertApprovedMappings(mappingFile, before.policy.approval);
  const mappings = mappingFile.mappings;
  const source = reviewedCachePath
    ? await collectReviewedCache({ ...JSON.parse(await readFile(reviewedCachePath, 'utf8')), mappingsDocument: mappingFile,
      rulesIdentity: before.policy.rulesIdentity, approval: before.policy.approval, rawPlayers: before.rawPlayers, rawPacks: before.rawPacks, checkedAt: now })
    : await collectCycle({ mappings, mappingsDocument: mappingFile, rulesIdentity: before.policy.rulesIdentity, rawPlayers: before.rawPlayers, rawPacks: before.rawPacks, fetchHtml, now: () => new Date(now) });
  const applied = await applyCycle({ root, candidates: source.candidates, officialObservation: source.officialObservation,
    pending: source.pending, sources: source.sources, receipt: source.receipt, now, expectedVersion: before.current.version });
  const publication = await preparePublication({ state: applied.state, out: publicationOut, dbPath, now });
  return { checkedAt: now, changed: applied.changed, pending: applied.pending, sources: source.sources,
    requestCount: source.requestCount, publication, runtimeVersion: applied.current.version };
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--root', '--mappings', '--publication-out', '--db', '--now', '--reviewed-cache'].includes(args[index]) || !args[index + 1]) throw new Error('Use --root DIR --mappings FILE [--publication-out DIR] [--db LOCAL_SQLITE] [--now ISO] [--reviewed-cache FILE]');
    options[args[index]] = args[index + 1];
  }
  if (!options['--root'] || !options['--mappings']) throw new Error('--root and --mappings are required');
  const result = await runCycle({ root: resolve(options['--root']), mappingsPath: resolve(options['--mappings']),
    publicationOut: options['--publication-out'] && resolve(options['--publication-out']), dbPath: options['--db'] && resolve(options['--db']), now: options['--now'], reviewedCachePath: options['--reviewed-cache'] && resolve(options['--reviewed-cache']) });
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
