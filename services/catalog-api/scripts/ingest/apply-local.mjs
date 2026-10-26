import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from './prepare-import.mjs';

/** Local staging verifier. Never creates connections to a hosted D1 database. */
export function applyLocal({bundleDir,schemaPath,dbPath,replay=true}){
  if(!bundleDir||!schemaPath||!dbPath)throw new Error('--bundle, --schema and --db are required');
  const base=resolve(bundleDir);const manifest=JSON.parse(readFileSync(join(base,'manifest.json'),'utf8'));
  if(!manifest.files?.sql_chunks?.length)throw new Error('No SQL chunks in manifest');
  const chunks=manifest.files.sql_chunks.map(item=>{
    if(typeof item.path!=='string'||isAbsolute(item.path)||item.path.split(/[\\/]/).includes('..'))throw new Error('Unsafe SQL chunk path');
    const bytes=readFileSync(join(base,item.path));if(hash(bytes)!==item.sha256||bytes.length!==item.bytes)throw new Error(`SQL chunk integrity failed: ${item.path}`);return bytes.toString('utf8');
  });
  mkdirSync(dirname(resolve(dbPath)),{recursive:true});const db=new DatabaseSync(resolve(dbPath));
  try{
    const initialized=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='catalog_entities'").get();
    if(!initialized)db.exec(readFileSync(schemaPath,'utf8'));
    const before=counts(db);for(const sql of chunks)transaction(db,sql);
    assertReferences(db);const after=counts(db);const firstFingerprint=fingerprint(db);
    if(replay){for(const sql of chunks)transaction(db,sql);assertReferences(db);if(firstFingerprint!==fingerprint(db))throw new Error('Replay changed persisted data');}
    return {database:resolve(dbPath),snapshot_id:manifest.snapshot_id,before,after,replay_verified:replay,orphan_references:0,hosted_database_touched:false};
  }finally{db.close();}
}
function transaction(db,sql){db.exec('BEGIN');try{db.exec(sql);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
function counts(db){return Object.fromEntries(['source_snapshots','catalog_entities','entity_revisions','pack_memberships','quarantine'].map(table=>[table,db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));}
export function assertReferences(db){
  const missing=db.prepare('SELECT COUNT(*) AS n FROM catalog_entities e LEFT JOIN entity_revisions r ON e.current_revision_id=r.revision_id AND r.entity_key=e.entity_key WHERE r.revision_id IS NULL').get().n;
  const memberships=db.prepare("SELECT COUNT(*) AS n FROM pack_memberships m LEFT JOIN catalog_entities p ON m.pack_key=p.entity_key AND p.kind='pack' LEFT JOIN catalog_entities c ON m.card_key=c.entity_key AND c.kind='card' WHERE p.entity_key IS NULL OR c.entity_key IS NULL").get().n;
  const snapshots=db.prepare('SELECT COUNT(*) AS n FROM entity_revisions r LEFT JOIN source_snapshots s ON r.snapshot_id=s.snapshot_id WHERE s.snapshot_id IS NULL').get().n;
  if(missing||memberships||snapshots)throw new Error(`Orphan references: ${missing+memberships+snapshots}`);
}
function fingerprint(db){return hash(JSON.stringify(['source_snapshots','catalog_entities','entity_revisions','pack_memberships','quarantine'].map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all())));}
function options(argv){const out={};const map={'--bundle':'bundleDir','--schema':'schemaPath','--db':'dbPath'};for(let i=0;i<argv.length;i+=2){if(!map[argv[i]]||!argv[i+1]||argv[i+1].startsWith('--')||out[map[argv[i]]])throw new Error('Usage: apply-local.mjs --bundle DIR --schema FILE --db FILE');out[map[argv[i]]]=argv[i+1];}return out;}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(applyLocal(options(process.argv.slice(2))),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
