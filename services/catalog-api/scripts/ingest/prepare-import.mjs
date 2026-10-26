import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, cp, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const hash = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
  return value;
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function requireValue(ok, message) { if (!ok) throw new Error(message); }
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const nullable = value => value === undefined || value === '' ? null : value;
const quoted = value => `'${String(value).replaceAll("'", "''")}'`;
const rowSql = (table, fields, values, suffix = '') => `INSERT ${suffix === 'ignore' ? 'OR IGNORE ' : ''}INTO ${table} (${fields.join(',')}) VALUES (${values.map(quoted).join(',')})${suffix && suffix !== 'ignore' ? ` ${suffix}` : ''};`;
const knownFields = ['id','name','nameJa','nameZh','slug','nationality','nationalityCode','team','position','overallRating','playingStyle','playingStyleDefensive','imageUrl','playerType'];

function validateCard(card) {
  requireValue(object(card), 'Every player must be an object');
  requireValue(typeof card.id === 'string' && /^\d+$/.test(card.id), 'Player id must be a decimal string');
  for (const key of ['name','slug','position','team','imageUrl']) requireValue(nonempty(card[key]), `Player ${card.id}: missing ${key}`);
  for (const key of ['overallRating','playerType']) requireValue(Number.isSafeInteger(card[key]), `Player ${card.id}: invalid ${key}`);
  requireValue(card.overallRating >= 0 && card.overallRating <= 200 && card.playerType > 0, `Player ${card.id}: invalid numeric field`);
  for (const key of knownFields.filter(key => !['overallRating','playerType'].includes(key))) {
    if (Object.hasOwn(card,key)) requireValue(typeof card[key] === 'string', `Player ${card.id}: ${key} must be string`);
  }
  try { requireValue(new URL(card.imageUrl).protocol === 'https:', 'Player image must use HTTPS'); }
  catch { throw new Error(`Player ${card.id}: invalid image URL`); }
}

function validatePack(pack) {
  requireValue(object(pack), 'Every pack must be an object');
  for (const key of ['name','slug','date']) requireValue(typeof pack[key] === 'string', `Pack ${key} must be string`);
  requireValue(Number.isSafeInteger(pack.playerCount) && pack.playerCount >= 0, 'Pack playerCount must be a nonnegative integer');
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(pack.date) && !Number.isNaN(Date.parse(pack.date)) && new Date(`${pack.date}T00:00:00Z`).toISOString().startsWith(pack.date), 'Invalid pack date');
}

/** Pure normalization; snapshot hashes identify inputs, never their array positions. */
export function buildImport({ players, packs, update = null, relations = null, inputHashes = {}, preparedAt = new Date().toISOString() }) {
  requireValue(Array.isArray(players) && players.length > 0, 'players must be a nonempty array');
  requireValue(Array.isArray(packs) && packs.length > 0, 'packs must be a nonempty array');
  requireValue(!Number.isNaN(Date.parse(preparedAt)), 'Invalid preparation time');
  const snapshotId = hash(canonical({ schema_version:1,input_hashes:inputHashes }));
  const cards = new Map();
  for (const card of players) {
    validateCard(card);
    requireValue(!cards.has(card.id), `Duplicate player id: ${card.id}`);
    cards.set(card.id,card);
  }
  const packMap = new Map();
  const quarantine = [];
  for (let index = 0; index < packs.length; index++) {
    const pack = packs[index];validatePack(pack);
    const reason = !nonempty(pack.name) || !nonempty(pack.slug) ? 'empty_pack_identifier' : pack.slug === 'dummy' ? 'placeholder_pack' : null;
    if (reason) { quarantine.push({ quarantine_id:hash(canonical({snapshotId,index,pack,reason})),snapshot_id:snapshotId,reason,payload:{raw:pack,file:'packs_raw.json',index} });continue; }
    requireValue(!packMap.has(pack.slug), `Duplicate pack slug: ${pack.slug}`);
    packMap.set(pack.slug,pack);
  }
  const groups = new Map();
  function addGroup(slug, ids, evidence, status) {
    requireValue(packMap.has(slug), `Unknown pack in membership: ${slug}`);
    requireValue(Array.isArray(ids) && ids.length > 0 && ids.every(id => typeof id === 'string' && cards.has(id)), `Unknown or invalid member in ${slug}`);
    requireValue(new Set(ids).size === ids.length, `Duplicate card membership: ${slug}`);
    requireValue(!groups.has(slug), `Conflicting membership group: ${slug}`);
    groups.set(slug,{ids,evidence,status});
  }
  if (relations !== null) {
    requireValue(object(relations) && Array.isArray(relations.products), 'relations.products must be an array');
    const observations = new Map((relations.observations ?? []).map(o => [o.id,o]));
    for (const pack of relations.products) {
      requireValue(Array.isArray(pack.players_payload), 'Relation must contain a player payload');
      const observation = observations.get(pack.observation_id);
      addGroup(pack.slug,pack.players_payload.map(c => c.id),{
        kind:'stored_source_roster',source_observation_id:pack.observation_id ?? null,
        source_url:observation?.url ?? null,observed_at:observation?.observed_at ?? null,
        response_sha256:observation?.sha256 ?? null,scope:'source_listed_not_official_full_pool',
        official_round_verified:false,all_special_members_verified:false,
      },'source_listed');
    }
  }
  let updateVerification = null;
  if (update !== null) {
    requireValue(object(update) && update.schemaVersion === 1 && object(update.update) && object(update.packLink), 'Unsupported update structure');
    const delta = update.update;const link = update.packLink;
    requireValue(Array.isArray(delta.addedPlayers), 'update.addedPlayers must be array');
    const addedIds = delta.addedPlayers.map(c => c.id);
    requireValue(new Set(addedIds).size === addedIds.length, 'Duplicate update id');
    requireValue(Number.isSafeInteger(delta.beforeCount) && delta.beforeCount >= 0 && delta.addedCount === addedIds.length && delta.beforeCount + delta.addedCount === players.length && delta.afterCount === players.length, 'Update counts do not match current players');
    requireValue(delta.uniqueIdCount === cards.size && delta.duplicateCount === 0, 'Update uniqueness metadata mismatch');
    requireValue(delta.addedPlayers.every(c => cards.has(c.id) && canonical(cards.get(c.id)) === canonical(c)), 'Update player payload differs from latest raw');
    requireValue(canonical(players.slice(delta.beforeCount)) === canonical(delta.addedPlayers), 'Update append order or original prefix length mismatch');
    requireValue(!players.slice(0,delta.beforeCount).some(c => addedIds.includes(c.id)), 'Update id already exists in original prefix');
    requireValue(Array.isArray(link.playerIds) && new Set(link.playerIds).size === link.playerIds.length && link.playerCount === link.playerIds.length, 'Update membership count mismatch');
    requireValue(packMap.get(link.packSlug)?.playerCount === link.packsRawPlayerCount, 'Update source pack count mismatch');
    if (inputHashes.players && delta.updatedSha256) requireValue(inputHashes.players === delta.updatedSha256, 'Updated players SHA-256 mismatch');
    const correction = link.countDiscrepancy;
    const corrected = correction?.status === 'source_error_confirmed_by_user';
    if (corrected) requireValue(correction.rawCount === link.packsRawPlayerCount && correction.correctedCount === link.playerIds.length, 'Correction count mismatch');
    if (Array.isArray(link.packDetailObservedPlayerIds)) {
      requireValue(new Set(link.packDetailObservedPlayerIds).size === link.packDetailObservedPlayerIds.length && link.packDetailObservedPlayerIds.every(id => link.playerIds.includes(id)), 'Observed detail IDs do not match relation');
      requireValue(link.packDetailObservedPlayerCount === link.packDetailObservedPlayerIds.length, 'Observed detail count mismatch');
    }
    addGroup(link.packSlug,link.playerIds,{
      kind:corrected ? 'user_confirmed_correction' : 'attached_update_roster',
      source_url:link.packDetailUrl ?? null,new_players_url:update.source?.newPlayersUrl ?? null,
      source_section:update.source?.newPlayersSection ?? null,reported_date:update.date ?? null,
      observed_at:null,html_bytes_preserved:false,
      source_reported_count:link.packsRawPlayerCount,
      observed_detail_ids:link.packDetailObservedPlayerIds ?? [],
      user_confirmed_count:corrected ? link.playerIds.length : null,
      correction_reason:corrected ? 'source_count_discrepancy' : null,
      official_round_verified:false,all_special_members_verified:false,
    },corrected ? 'user_confirmed_correction' : 'attached_update');
    updateVerification = { added_count:addedIds.length,previous_count:delta.beforeCount,after_count:players.length,added_records_match:true,original_prefix_reverified:false,original_prefix_note:'No prior file supplied to this CLI; prefix count/order and update payload checked, prior bytes/hash must be checked separately.',reported_previous_sha256:delta.originalSha256 ?? null };
  }
  const entities = [];
  for (let index=0;index<players.length;index++) {
    const card=players[index];
    const content={source:'efhub',source_card_id:card.id,name:card.name,name_ja:nullable(card.nameJa),name_zh:nullable(card.nameZh),slug:card.slug,team:card.team,position:card.position,overall_rating:card.overallRating,overall_rating_condition:null,player_type_code:card.playerType,image_url:card.imageUrl,nationality:nullable(card.nationality),nationality_code:nullable(card.nationalityCode),playing_style:nullable(card.playingStyle),playing_style_defensive:nullable(card.playingStyleDefensive),source_missing_fields:knownFields.filter(k=>!Object.hasOwn(card,k)),source_extra_fields:Object.fromEntries(Object.entries(card).filter(([k])=>!knownFields.includes(k)))};
    entities.push(entity('card',card.id,content,{snapshot_id:snapshotId,file:'players_raw.json',index}));
  }
  for (let index=0;index<packs.length;index++) {
    const pack=packs[index];if(!packMap.has(pack.slug))continue;
    const group=groups.get(pack.slug);const corrected=group?.status==='user_confirmed_correction';
    const content={source:'efhub',source_pack_slug:pack.slug,name:pack.name,date:pack.date,date_meaning:'source_date_not_sale_period',source_reported_count:pack.playerCount,effective_member_count:group?.ids.length ?? null,correction_status:corrected?'user_confirmed':null,membership_status:group?.status ?? 'unknown',official_initial_total:null,official_special_total:null,source_extra_fields:Object.fromEntries(Object.entries(pack).filter(([k])=>!['name','slug','date','playerCount'].includes(k)))};
    entities.push(entity('pack',pack.slug,content,{snapshot_id:snapshotId,file:'packs_raw.json',index}));
  }
  const memberships=[];
  for(const [slug,group] of groups)for(const id of group.ids) memberships.push({pack_key:`efhub:pack:${slug}`,card_key:`efhub:card:${id}`,evidence:group.evidence,snapshot_id:snapshotId});
  const manifest={schema_version:1,snapshot_id:snapshotId,prepared_at:preparedAt,source_collected_at:null,input_hashes:inputHashes,counts:{raw_cards:players.length,cards:cards.size,raw_packs:packs.length,packs:packMap.size,quarantined:quarantine.length,relation_packs:groups.size,memberships:memberships.length},update_verification:updateVerification,source_scope:'user_supplied_efhub_exports',official_current_scope_verified:false,simulation_ready:false};
  return {manifest,entities,memberships,quarantine};
  function entity(kind,id,content,raw) {
    const entity_key=`efhub:${kind}:${id}`;const revision_id=hash(canonical({schema_version:1,entity_key,content}));
    return {entity_key,kind,source_id:id,revision_id,payload:{...content,raw},snapshot_id:snapshotId};
  }
}

export function dataStatements(bundle) {
  const sql=[];
  for(const item of bundle.entities) {
    sql.push(rowSql('entity_revisions',['revision_id','entity_key','payload_json','snapshot_id'],[item.revision_id,item.entity_key,canonical(item.payload),item.snapshot_id],'ignore'));
    sql.push(rowSql('catalog_entities',['entity_key','kind','source_id','current_revision_id'],[item.entity_key,item.kind,item.source_id,item.revision_id],`ON CONFLICT(entity_key) DO UPDATE SET current_revision_id=excluded.current_revision_id WHERE NOT EXISTS (
      SELECT 1 FROM json_each((SELECT payload_json FROM entity_revisions WHERE revision_id=catalog_entities.current_revision_id)) previous
      WHERE previous.key NOT IN ('raw','source_missing_fields','source_extra_fields')
      AND previous.type NOT IN ('null','object','array')
      AND COALESCE(json_type((SELECT payload_json FROM entity_revisions WHERE revision_id=excluded.current_revision_id), '$.' || previous.key), 'null')='null'
    )`));
  }
  for(const item of bundle.memberships)sql.push(rowSql('pack_memberships',['pack_key','card_key','evidence_json','snapshot_id'],[item.pack_key,item.card_key,canonical(item.evidence),item.snapshot_id],'ignore'));
  for(const item of bundle.quarantine)sql.push(rowSql('quarantine',['quarantine_id','snapshot_id','reason','payload_json'],[item.quarantine_id,item.snapshot_id,item.reason,canonical(item.payload)],'ignore'));
  // Initial-import readiness marker is last. Live multi-chunk imports require a
  // staging DB/maintenance window until versioned atomic activation is implemented.
  sql.push(rowSql('source_snapshots',['snapshot_id','manifest_json'],[bundle.manifest.snapshot_id,canonical(bundle.manifest)],'ignore'));
  return sql;
}

export async function prepareImport({playersPath,packsPath,updatePath,relationsPath,outDir}) {
  requireValue(playersPath&&packsPath&&outDir,'--players, --packs and --out are required');
  const files={players:playersPath,packs:packsPath,...(updatePath?{update:updatePath}:{}),...(relationsPath?{relations:relationsPath}:{})};
  const bytes={};const parsed={};
  for(const [key,path] of Object.entries(files)){bytes[key]=await readFile(path);parsed[key]=JSON.parse(bytes[key]);}
  const inputHashes=Object.fromEntries(Object.entries(bytes).map(([key,b])=>[key,hash(b)]));
  const bundle=buildImport({...parsed,inputHashes});const output=resolve(outDir);
  for(const path of Object.values(files))requireValue(!resolve(path).startsWith(`${output}/`),'Output must not contain or replace an input file');
  try { await stat(output);throw new Error('Output directory already exists; choose a new snapshot folder'); } catch(error) {if(error.code!=='ENOENT')throw error;}
  const stage=`${output}.preparing-${process.pid}`;
  try {
    await mkdir(join(stage,'raw'),{recursive:true});await mkdir(join(stage,'sql'),{recursive:true});
    const names={players:'players_raw.json',packs:'packs_raw.json',update:'players_update_20261026.json',relations:'existing_pack_relations.json'};
    for(const [key,path] of Object.entries(files))await cp(path,join(stage,'raw',names[key]));
    const lines=[...bundle.entities.map(x=>({record_type:'entity',...x})),...bundle.memberships.map(x=>({record_type:'membership',...x})),...bundle.quarantine.map(x=>({record_type:'quarantine',...x}))].map(x=>JSON.stringify(x)).join('\n')+'\n';
    await writeFile(join(stage,'records.jsonl'),lines);
    const statements=dataStatements(bundle);const chunks=[];
    for(let start=0;start<statements.length;start+=1000){
      const filename=`sql/${String(chunks.length+1).padStart(4,'0')}.sql`;
      const contents=statements.slice(start,start+1000).join('\n')+'\n';
      await writeFile(join(stage,filename),contents);chunks.push({path:filename,statements:Math.min(1000,statements.length-start),sha256:hash(contents),bytes:Buffer.byteLength(contents)});
    }
    const manifest={...bundle.manifest,files:{records:{path:'records.jsonl',sha256:hash(lines),bytes:Buffer.byteLength(lines)},sql_chunks:chunks},operating_limit:'Initial/staging import only. For existing hosted data use maintenance or implement atomic activation before live updates.'};
    await writeFile(join(stage,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    await rename(stage,output);
    return {out_dir:output,...manifest.counts,snapshot_id:manifest.snapshot_id,sql_chunks:chunks.length};
  }catch(error){await rm(stage,{recursive:true,force:true});throw error;}
}

function options(argv){const out={};const map={'--players':'playersPath','--packs':'packsPath','--update':'updatePath','--relations':'relationsPath','--out':'outDir'};for(let i=0;i<argv.length;i+=2){requireValue(map[argv[i]]&&argv[i+1]&&!argv[i+1].startsWith('--'),'Usage: prepare-import.mjs --players FILE --packs FILE [--update FILE] [--relations FILE] --out NEW_DIR');requireValue(!out[map[argv[i]]],'Duplicate option');out[map[argv[i]]]=argv[i+1];}return out;}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))prepareImport(options(process.argv.slice(2))).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
