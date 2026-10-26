import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildImport, dataStatements, prepareImport, canonical, hash } from '../scripts/ingest/prepare-import.mjs';
import { applyLocal, assertReferences } from '../scripts/ingest/apply-local.mjs';

const preparedAt='2026-10-26T12:00:00.000Z';
const schema=`CREATE TABLE source_snapshots(snapshot_id TEXT PRIMARY KEY,manifest_json TEXT NOT NULL);
CREATE TABLE catalog_entities(entity_key TEXT PRIMARY KEY,kind TEXT NOT NULL,source_id TEXT NOT NULL,current_revision_id TEXT NOT NULL);
CREATE TABLE entity_revisions(revision_id TEXT PRIMARY KEY,entity_key TEXT NOT NULL,payload_json TEXT NOT NULL,snapshot_id TEXT NOT NULL);
CREATE TABLE pack_memberships(pack_key TEXT NOT NULL,card_key TEXT NOT NULL,evidence_json TEXT NOT NULL,snapshot_id TEXT NOT NULL,PRIMARY KEY(pack_key,card_key,snapshot_id));
CREATE TABLE quarantine(quarantine_id TEXT PRIMARY KEY,snapshot_id TEXT NOT NULL,reason TEXT NOT NULL,payload_json TEXT NOT NULL);`;
const card=(id,name='Player')=>({id,name,nameJa:'名前',nameZh:'',slug:`player-${id}`,nationality:'',nationalityCode:'',team:'Team',position:'CF',overallRating:81,imageUrl:`https://example.test/${id}.png`,playerType:6});
const pack=(slug,playerCount=1)=>({name:slug,slug,date:'2026-10-26',playerCount});
function simple(overrides={}){return buildImport({players:[card('90071992547409931234')],packs:[pack('sample')],inputHashes:{players:'a',packs:'b'},preparedAt,...overrides});}
const apply=(db,b)=>db.exec(dataStatements(b).join('\n'));
function fixture(){
 const players=[card('1'),...Array.from({length:11},(_,i)=>card(String(100+i)))];
 const added=players.slice(1);
 const update={schemaVersion:1,date:'2026-10-26',source:{newPlayersUrl:'https://example.test/new'},update:{beforeCount:1,addedCount:11,afterCount:12,uniqueIdCount:12,duplicateCount:0,addedPlayers:added},packLink:{packSlug:'new-pack',playerCount:11,packsRawPlayerCount:8,playerIds:added.map(x=>x.id),packDetailObservedPlayerCount:8,packDetailObservedPlayerIds:added.slice(3).map(x=>x.id),countDiscrepancy:{status:'source_error_confirmed_by_user',rawCount:8,correctedCount:11}}};
 return {players,packs:[pack('new-pack',8)],update,preparedAt,inputHashes:{players:'fixture',packs:'fixture'}};
}

test('decimal string IDs beyond safe integers stay exact; optional nulls preserve raw absence provenance',()=>{
 const b=simple();const c=b.entities[0];assert.equal(c.source_id,'90071992547409931234');assert.equal(c.entity_key,'efhub:card:90071992547409931234');assert.equal(c.payload.nationality,null);assert.equal(c.payload.playing_style_defensive,null);assert.ok(c.payload.source_missing_fields.includes('playingStyleDefensive'));assert.equal(c.payload.raw.index,0);assert.equal(c.payload.overall_rating_condition,null);
});
test('ID collisions, numeric IDs, malformed fields, dates and references fail before output',()=>{
 assert.throws(()=>simple({players:[card('1'),card('1')]}),/Duplicate player/);
 assert.throws(()=>simple({players:[card(123)]}),/decimal string/);
 assert.throws(()=>simple({players:[{...card('1'),overallRating:NaN}]}),/invalid overallRating/);
 assert.throws(()=>simple({packs:[pack('x'),pack('x')]}),/Duplicate pack/);
 assert.throws(()=>simple({packs:[{...pack('x'),date:'2026-02-30'}]}),/date/);
 assert.throws(()=>simple({relations:{products:[{slug:'sample',players_payload:[{id:'no-id'}]}]}}),/Unknown or invalid member/);
});
test('11-card update preserves all additions and corrects membership count without changing raw count or official totals',()=>{
 const b=buildImport(fixture());assert.equal(b.manifest.update_verification.added_count,11);assert.equal(b.manifest.counts.cards,12);assert.equal(b.memberships.length,11);
 const p=b.entities.find(x=>x.kind==='pack').payload;assert.equal(p.source_reported_count,8);assert.equal(p.effective_member_count,11);assert.equal(p.correction_status,'user_confirmed');assert.equal(p.membership_status,'user_confirmed_correction');assert.equal(p.official_initial_total,null);assert.equal(p.official_special_total,null);assert.equal(b.manifest.simulation_ready,false);
});
test('delta counts, payload alterations, duplicate and unknown linked IDs are rejected',()=>{
 let x=fixture();x.update.update.afterCount=11;assert.throws(()=>buildImport(x),/counts/);
 x=fixture();x.update=structuredClone(x.update);x.update.update.addedPlayers[0].name='Not the same';assert.throws(()=>buildImport(x),/payload differs/);
 x=fixture();x.update.packLink.playerIds[0]='unknown';assert.throws(()=>buildImport(x),/Unknown or invalid member/);
 x=fixture();x.update.packLink.playerIds[0]=x.update.packLink.playerIds[1];assert.throws(()=>buildImport(x),/membership count/);
 x=fixture();x.update.packLink.countDiscrepancy.correctedCount=8;assert.throws(()=>buildImport(x),/Correction count/);
});
test('empty/dummy packs are quarantined and raw payloads preserved; no fake pack entity is created',()=>{
 const b=simple({packs:[pack('sample'),{...pack(''),name:''},pack('dummy')]});assert.equal(b.manifest.counts.packs,1);assert.equal(b.quarantine.length,2);assert.equal(b.quarantine[0].payload.raw.slug,'');assert.equal(b.quarantine[1].reason,'placeholder_pack');assert.equal(b.entities.filter(x=>x.kind==='pack').length,1);
});
test('revision IDs ignore source position/snapshot observations but change on semantic fields',()=>{
 const a=simple({players:[card('1'),card('2')]}),b=simple({players:[card('2'),card('1')],inputHashes:{players:'changed'},preparedAt:'2026-10-27T00:00:00Z'});
 assert.notEqual(a.manifest.snapshot_id,b.manifest.snapshot_id);for(const x of a.entities)assert.equal(x.revision_id,b.entities.find(y=>x.entity_key===y.entity_key).revision_id);
 const c=simple({players:[{...card('1'),overallRating:90},card('2')]});assert.notEqual(a.entities[0].revision_id,c.entities[0].revision_id);
});
test('SQL quoting does not execute payload text; replay retains immutable first evidence',()=>{
 const db=new DatabaseSync(':memory:');try{
 db.exec(schema);const b=simple({players:[card('1',"O'Neil'); DROP TABLE catalog_entities; --")]});apply(db,b);const first=db.prepare('SELECT payload_json FROM entity_revisions ORDER BY revision_id').all();apply(db,b);assertReferences(db);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalog_entities').get().n,2);assert.deepEqual(db.prepare('SELECT payload_json FROM entity_revisions ORDER BY revision_id').all(),first);assert.equal(JSON.parse(db.prepare("SELECT payload_json FROM entity_revisions WHERE entity_key='efhub:card:1'").get().payload_json).name,"O'Neil'); DROP TABLE catalog_entities; --");
 }finally{db.close();}
});
test('new snapshot omission preserves older entities, revisions and relationships',()=>{
 const db=new DatabaseSync(':memory:');try{
 db.exec(schema);const first=simple({players:[card('1'),card('2')],relations:{products:[{slug:'sample',players_payload:[{id:'1'},{id:'2'}]}]}});apply(db,first);
 const second=simple({players:[card('1','Renamed')],inputHashes:{players:'later'}});apply(db,second);assertReferences(db);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalog_entities').get().n,3);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entity_revisions').get().n,5);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pack_memberships').get().n,2);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM entity_revisions WHERE entity_key='efhub:card:1'").get().n,2);
 }finally{db.close();}
});
test('publication manifest is the final data statement, keeping first import unready until completion',()=>{
 const b=simple();const lines=dataStatements(b);assert.match(lines.at(-1),/^INSERT OR IGNORE INTO source_snapshots/);assert.ok(lines.slice(0,-1).every(x=>!x.includes('INTO source_snapshots')));
});
test('prepared files preserve raw bytes, are integrity checked, and local replay is idempotent',async()=>{
 const root=mkdtempSync(join(tmpdir(),'efsimulator-ingest-'));try{
 const x=fixture();const playersPath=join(root,'players.json'),packsPath=join(root,'packs.json'),updatePath=join(root,'update.json'),schemaPath=join(root,'schema.sql'),outDir=join(root,'bundle');
 const raw=JSON.stringify(x.players,null,2)+'\n';writeFileSync(playersPath,raw);writeFileSync(packsPath,JSON.stringify(x.packs));x.update.update.updatedSha256=hash(raw);writeFileSync(updatePath,JSON.stringify(x.update));writeFileSync(schemaPath,schema);
 const result=await prepareImport({playersPath,packsPath,updatePath,outDir});assert.equal(result.memberships,11);assert.equal(readFileSync(join(outDir,'raw/players_raw.json'),'utf8'),raw);
 const applied=applyLocal({bundleDir:outDir,schemaPath,dbPath:join(root,'stage.sqlite')});assert.equal(applied.after.catalog_entities,13);assert.equal(applied.after.pack_memberships,11);assert.equal(applied.replay_verified,true);assert.equal(applied.hosted_database_touched,false);
 await assert.rejects(prepareImport({playersPath,packsPath,updatePath,outDir}),/already exists/);
 const manifest=JSON.parse(readFileSync(join(outDir,'manifest.json')));writeFileSync(join(outDir,manifest.files.sql_chunks[0].path),'SELECT 1;');assert.throws(()=>applyLocal({bundleDir:outDir,schemaPath,dbPath:join(root,'bad.sqlite')}),/integrity/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('partial later input cannot erase known fields or pack membership readiness',()=>{
 const db=new DatabaseSync(':memory:');try{
 db.exec(schema);
 apply(db,simple({players:[{...card('1'),playingStyle:'Known style'}],relations:{products:[{slug:'sample',players_payload:[{id:'1'}]}]}}));
 apply(db,simple({players:[card('1','New candidate name')],inputHashes:{players:'missing-values'}}));
 const rows=db.prepare('SELECT e.kind,r.payload_json FROM catalog_entities e JOIN entity_revisions r ON r.revision_id=e.current_revision_id').all();
 assert.equal(JSON.parse(rows.find(r=>r.kind==='card').payload_json).playing_style,'Known style');
 assert.equal(JSON.parse(rows.find(r=>r.kind==='pack').payload_json).effective_member_count,1);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entity_revisions').get().n,4);
 }finally{db.close();}
});
