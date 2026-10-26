#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { collectCycle } from './collect-cycle.mjs';
import { loadWorkspace, applyCycle } from './workspace.mjs';
import { generatePublication, assertPublicationRows } from './publication.mjs';

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
    const bundle = generatePublication({ state, createdAt: now, expectedVersionId });
    const folder = join(out, bundle.versionId);
    await mkdir(join(folder, 'sql'), { recursive: true });
    for (const chunk of bundle.sqlChunks) {
      if (createHash('sha256').update(chunk.sql).digest('hex') !== chunk.sha256) throw new Error('Publication chunk checksum mismatch');
      await writeFile(join(folder, 'sql', chunk.name), chunk.sql);
    }
    await writeFile(join(folder, 'activate.sql'), bundle.activateSql);
    await writeFile(join(folder, 'manifest.json'), JSON.stringify({ ...bundle.manifest, expected_version_id: expectedVersionId,
      chunks: bundle.sqlChunks.map(({ sql: _sql, ...metadata }) => metadata) }, null, 2) + '\n');
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
    return { versionId: bundle.versionId, counts: bundle.manifest.counts, folder, locallyActivated: Boolean(db), hostedActivated: false };
  } finally { db?.close(); }
}

export async function runCycle({ root, mappingsPath, publicationOut = join(root, 'publications'), dbPath, fetchHtml, now = new Date().toISOString() }) {
  const before = await loadWorkspace(root);
  const mappingFile = JSON.parse(await readFile(mappingsPath, 'utf8'));
  const mappings = Array.isArray(mappingFile) ? mappingFile : mappingFile.mappings;
  const source = await collectCycle({ mappings, rawPlayers: before.rawPlayers, rawPacks: before.rawPacks, fetchHtml, now: () => new Date(now) });
  const applied = await applyCycle({ root, candidates: source.candidates, officialObservation: source.officialObservation,
    pending: source.pending, sources: source.sources, now, expectedVersion: before.current.version });
  const publication = await preparePublication({ state: applied.state, out: publicationOut, dbPath, now });
  return { checkedAt: now, changed: applied.changed, pending: applied.pending, sources: source.sources,
    requestCount: source.requestCount, publication, runtimeVersion: applied.current.version };
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--root', '--mappings', '--publication-out', '--db', '--now'].includes(args[index]) || !args[index + 1]) throw new Error('Use --root DIR --mappings FILE [--publication-out DIR] [--db LOCAL_SQLITE] [--now ISO]');
    options[args[index]] = args[index + 1];
  }
  if (!options['--root'] || !options['--mappings']) throw new Error('--root and --mappings are required');
  const result = await runCycle({ root: resolve(options['--root']), mappingsPath: resolve(options['--mappings']),
    publicationOut: options['--publication-out'] && resolve(options['--publication-out']), dbPath: options['--db'] && resolve(options['--db']), now: options['--now'] });
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
