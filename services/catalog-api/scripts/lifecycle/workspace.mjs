import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, appendFile, mkdir, rename, rm, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLifecycleState, enrichPackDrawOptions, enrichPlayerTypes, planRawAppend, reconcileCatalog, validateLifecycleState } from '../../lib/catalog-lifecycle.mjs';
import { canonical, compareText } from '../../lib/catalog-contract.mjs';
import { activeRules, loadMappingApprovals, approvalDigest } from './rules.mjs';
import { replayCollectionReceipt } from './collection-receipt.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const jsonBytes = data => Buffer.from(`${JSON.stringify(data, null, 2)}\n`);
const lineBytes = records => Buffer.from(records.map(record => `${JSON.stringify(record)}\n`).join(''));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };
const has = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
export const VERSION_FILES = Object.freeze([
  'raw/players_raw.json', 'raw/packs_raw.json', 'processed/players.json', 'processed/packs.json',
  'live.json', 'archive.json', 'state.json', 'logs/players_raw_updates.jsonl',
  'logs/packs_raw_updates.jsonl', 'logs/api_updates.jsonl',
]);
const SOURCE_PLAYER_UPDATE = 'raw/source_player_update.json';

function validTime(value) {
  return typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}
function readArray(bytes, label) {
  let result;
  try { result = JSON.parse(bytes.toString('utf8')); } catch { fail(`Invalid JSON: ${label}`); }
  if (!Array.isArray(result)) fail(`${label} must be a JSON array`);
  return result;
}
function validateRaw(players, packs) {
  if (!Array.isArray(players) || !Array.isArray(packs)) fail('Raw inputs must be arrays');
  const ids = new Set();
  for (const player of players) {
    if (!object(player) || typeof player.id !== 'string' || !/^\d+$/.test(player.id) || ids.has(player.id)) fail('Invalid or duplicate raw player id');
    ids.add(player.id);
  }
  const slugs = new Set();
  for (const pack of packs) {
    if (!object(pack) || typeof pack.slug !== 'string') fail('Invalid raw pack');
    if (pack.slug && pack.slug !== 'dummy') {
      if (slugs.has(pack.slug)) fail(`Duplicate raw pack slug: ${pack.slug}`);
      slugs.add(pack.slug);
    }
  }
}
function entries(files) {
  return [...files.entries()].sort(([a], [b]) => compareText(a, b)).map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: hash(bytes) }));
}
function versionHash(fileEntries, ruleBindings = null) {
  return hash(Buffer.from(ruleBindings ? canonical({ files: fileEntries, ruleBindings }) : JSON.stringify(fileEntries)));
}
const bindingOf = policy => policy ? { rulesIdentity: policy.rulesIdentity, approvalSha256: policy.approvalSha256 } : null;
async function readPolicy(root, required = false) {
  if (!await has(join(root, 'RULES.json'))) {
    if (required) fail('Workspace rules are not pinned; use data:adopt-rules with the expected CURRENT version first');
    return null;
  }
  const policy = JSON.parse(await readFile(join(root, 'RULES.json'), 'utf8'));
  if (policy.schemaVersion !== 1 || canonical(policy.rulesIdentity) !== canonical(await activeRules()) || policy.approvalSha256 !== approvalDigest(policy.approval)) fail('Workspace rules/review policy changed; explicit reviewed adoption is required');
  return policy;
}
async function makePolicy(approval = loadMappingApprovals()) {
  return { schemaVersion: 1, rulesIdentity: await activeRules(), approvalSha256: approvalDigest(approval), approval: structuredClone(approval) };
}
async function syncedWrite(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function withLock(root, operation) {
  await mkdir(root, { recursive: true });
  const lockPath = join(root, '.write-lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') fail('Workspace is locked by another writer; no update was applied'); throw error; }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    return await operation();
  } finally { await lock.close(); await rm(lockPath, { force: true }); }
}
function generationFiles({ rawPlayerBytes, rawPackBytes, state, sourcePlayerUpdateBytes }) {
  const files = new Map([
    ['raw/players_raw.json', rawPlayerBytes], ['raw/packs_raw.json', rawPackBytes],
    ['processed/players.json', jsonBytes(state.players)], ['processed/packs.json', jsonBytes(state.packs)],
    ['live.json', jsonBytes(state.active)], ['archive.json', jsonBytes(state.archive)], ['state.json', jsonBytes(state)],
    ['logs/players_raw_updates.jsonl', lineBytes(state.rawUpdates.players)],
    ['logs/packs_raw_updates.jsonl', lineBytes(state.rawUpdates.packs)],
    ['logs/api_updates.jsonl', lineBytes(state.updates)],
  ]);
  if (sourcePlayerUpdateBytes) files.set(SOURCE_PLAYER_UPDATE, sourcePlayerUpdateBytes);
  return files;
}
async function publishGeneration({ root, files, state, now, previousVersion = null, policy }) {
  validateLifecycleState(state);
  const fileEntries = entries(files);
  const ruleBindings = bindingOf(policy);
  const version = versionHash(fileEntries, ruleBindings);
  const manifest = {
    schemaVersion: 1, version, createdAt: now, previousVersion,
    ...(ruleBindings ? { ruleBindings } : {}),
    files: fileEntries,
    counts: { rawPlayers: readArray(files.get('raw/players_raw.json'), 'raw players').length,
      rawPacks: readArray(files.get('raw/packs_raw.json'), 'raw packs').length,
      players: state.players.length, packs: state.packs.length, live: state.active.length, archive: state.archive.length },
  };
  const manifestBytes = jsonBytes(manifest);
  const versions = join(root, 'versions');
  const preparation = join(versions, `.prepare-${randomUUID()}`);
  const destination = join(versions, version);
  await mkdir(preparation, { recursive: true });
  try {
    for (const [path, bytes] of files) await syncedWrite(join(preparation, path), bytes);
    await syncedWrite(join(preparation, 'manifest.json'), manifestBytes);
    // Re-read the staged generation before publishing its pointer. A failed
    // write/hash/state validation leaves the previous CURRENT intact.
    await readGeneration(preparation, { schemaVersion: 1, version, manifestSha256: hash(manifestBytes), updatedAt: now });
    if (await has(destination)) {
      const existing = await readFile(join(destination, 'manifest.json'));
      const stored = JSON.parse(existing);
      if (stored.version !== version || JSON.stringify(stored.files) !== JSON.stringify(fileEntries)) fail('Version hash collision or corrupt existing version');
      await readGeneration(destination, { schemaVersion: 1, version, manifestSha256: hash(existing), updatedAt: now });
      await rm(preparation, { recursive: true });
      // A content-identical generation already exists. Its original manifest
      // remains immutable and the pointer must authenticate those exact bytes.
      return await pointCurrent(root, version, hash(existing), now);
    }
    await rename(preparation, destination);
    await syncDirectory(versions);
    return await pointCurrent(root, version, hash(manifestBytes), now);
  } finally { await rm(preparation, { recursive: true, force: true }); }
}
async function pointCurrent(root, version, manifestSha256, now) {
  const pointer = { schemaVersion: 1, version, manifestSha256, updatedAt: now };
  const temporary = join(root, `.CURRENT-${randomUUID()}.json`);
  try {
    await syncedWrite(temporary, jsonBytes(pointer));
    await rename(temporary, join(root, 'CURRENT.json'));
    await syncDirectory(root);
  } finally { await rm(temporary, { force: true }); }
  return pointer;
}
async function readGeneration(versionPath, current) {
  if (current.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(current.version) || !/^[a-f0-9]{64}$/.test(current.manifestSha256)) fail('Invalid CURRENT pointer');
  const manifestPath = join(versionPath, 'manifest.json');
  if ((await lstat(manifestPath)).isSymbolicLink()) fail('Generation manifest may not be a symlink');
  const manifestBytes = await readFile(manifestPath);
  if (hash(manifestBytes) !== current.manifestSha256) fail('Manifest hash mismatch');
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schemaVersion !== 1 || manifest.version !== current.version || !Array.isArray(manifest.files)) fail('Invalid generation manifest');
  const expected = new Set(VERSION_FILES);
  const files = new Map();
  for (const entry of manifest.files) {
    if (!object(entry) || typeof entry.path !== 'string' || (!expected.has(entry.path) && entry.path !== SOURCE_PLAYER_UPDATE) || files.has(entry.path)) fail('Unexpected generation file path');
    const path = join(versionPath, entry.path);
    if ((await lstat(path)).isSymbolicLink()) fail('Generation files may not be symlinks');
    const bytes = await readFile(path);
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) fail(`Generation file hash mismatch: ${entry.path}`);
    files.set(entry.path, bytes);
  }
  if (VERSION_FILES.some(path => !files.has(path))) fail('Incomplete generation file set');
  if (versionHash(entries(files), manifest.ruleBindings ?? null) !== current.version) fail('Generation version hash mismatch');
  const rawPlayers = readArray(files.get('raw/players_raw.json'), 'raw players');
  const rawPacks = readArray(files.get('raw/packs_raw.json'), 'raw packs');
  validateRaw(rawPlayers, rawPacks);
  const state = JSON.parse(files.get('state.json'));
  validateLifecycleState(state);
  for (const [kind, records] of [['players', rawPlayers], ['packs', rawPacks]]) {
    const history = state.rawUpdates[kind];
    if (!history.length || history[0].action !== 'baseline_import') fail(`Missing ${kind} baseline history`);
    for (let index = 1; index < history.length; index++) {
      if (history[index].action !== 'append' || history[index].beforeCount !== history[index - 1].afterCount || history[index].beforeSha256 !== history[index - 1].afterSha256) fail(`Broken ${kind} raw history chain`);
    }
    const terminal = history.at(-1);
    if (terminal.afterCount !== records.length || terminal.afterSha256 !== hash(files.get(`raw/${kind}_raw.json`))) fail(`Raw ${kind} history does not match the preserved file`);
  }
  const expectedFiles = generationFiles({ rawPlayerBytes: files.get('raw/players_raw.json'), rawPackBytes: files.get('raw/packs_raw.json'), state, sourcePlayerUpdateBytes: files.get(SOURCE_PLAYER_UPDATE) });
  for (const [path, bytes] of expectedFiles) if (!files.get(path).equals(bytes)) fail(`State/materialized file mismatch: ${path}`);
  return { rawPlayers, rawPacks, state, current, versionPath, manifest, files };
}
async function loadInternal(root) {
  const pointerPath = join(root, 'CURRENT.json');
  if ((await lstat(pointerPath)).isSymbolicLink()) fail('CURRENT may not be a symlink');
  const current = JSON.parse(await readFile(pointerPath, 'utf8'));
  if (!/^[a-f0-9]{64}$/.test(current?.version)) fail('Invalid CURRENT version');
  const loaded = await readGeneration(join(root, 'versions', current.version), current);
  const policy = await readPolicy(root);
  if (!policy && loaded.manifest.ruleBindings) fail('Workspace rules are not pinned; explicit reviewed adoption is required');
  if (policy && canonical(bindingOf(policy)) !== canonical(loaded.manifest.ruleBindings ?? null)) fail('Workspace rule policy differs from the CURRENT generation; explicit reviewed adoption is required');
  return { ...loaded, policy };
}
export async function loadWorkspace(root) {
  const { files, ...loaded } = await loadInternal(resolve(root));
  return loaded;
}
function rawImportRecord(targetFile, bytes, count, now, sourceUpdate) {
  return {
    id: `baseline-${hash(bytes)}`, at: now, action: 'baseline_import', targetFile,
    beforeCount: null, afterCount: count, importedCount: count, addedIds: [],
    beforeSha256: null, afterSha256: hash(bytes), source: 'provided_raw_file',
    ...(sourceUpdate ? { sourceUpdate } : {}),
  };
}

export async function initializeWorkspace({ root, playersPath, packsPath, now = new Date().toISOString(), playerUpdatePath = null, approval }) {
  root = resolve(root);
  if (!validTime(now)) fail('Invalid initialization time');
  now = new Date(now).toISOString();
  return await withLock(root, async () => {
    if (await has(join(root, 'CURRENT.json'))) fail('Workspace already initialized; existing data was preserved');
    const [rawPlayerBytes, rawPackBytes, sourcePlayerUpdateBytes] = await Promise.all([
      readFile(resolve(playersPath)), readFile(resolve(packsPath)), playerUpdatePath ? readFile(resolve(playerUpdatePath)) : null,
    ]);
    const rawPlayers = readArray(rawPlayerBytes, 'raw players'); const rawPacks = readArray(rawPackBytes, 'raw packs');
    validateRaw(rawPlayers, rawPacks);
    if (sourcePlayerUpdateBytes) JSON.parse(sourcePlayerUpdateBytes.toString('utf8'));
    const state = createLifecycleState();
    const policy = await makePolicy(approval);
    const sourceUpdate = sourcePlayerUpdateBytes ? { targetFile: SOURCE_PLAYER_UPDATE, sha256: hash(sourcePlayerUpdateBytes) } : null;
    state.rawUpdates.players.push(rawImportRecord('raw/players_raw.json', rawPlayerBytes, rawPlayers.length, now, sourceUpdate));
    state.rawUpdates.packs.push(rawImportRecord('raw/packs_raw.json', rawPackBytes, rawPacks.length, now));
    const files = generationFiles({ rawPlayerBytes, rawPackBytes, sourcePlayerUpdateBytes, state });
    if (await has(join(root, 'RULES.json'))) fail('Workspace already has a rule policy; existing data was preserved');
    await syncedWrite(join(root, 'RULES.json'), jsonBytes(policy));
    await publishGeneration({ root, files, state, now, policy });
    return await loadWorkspace(root);
  });
}
function appendRawRecord(kind, before, after, added, beforeBytes, afterBytes, now, officialObservation, sources) {
  return {
    id: `raw-${hash(afterBytes)}`, at: now, action: 'append', targetFile: `raw/${kind}_raw.json`,
    beforeCount: before.length, afterCount: after.length, addedCount: added.length,
    addedIds: added.map(record => record[kind === 'players' ? 'id' : 'slug']), addedRecords: structuredClone(added),
    beforeSha256: hash(beforeBytes), afterSha256: hash(afterBytes),
    evidence: { officialObservedAt: officialObservation?.observedAt ?? null, officialSha256: officialObservation?.sha256 ?? null, sources: sources ?? null },
  };
}
async function appendCheck(root, check) {
  await appendFile(join(root, 'checks.jsonl'), lineBytes([check]), { mode: 0o600 });
}

/** One locked read -> append -> reconcile -> validated immutable generation. */
export async function applyCycle({ root, officialObservation, candidates, pending = [], sources = null, receipt = null, now = new Date().toISOString(), expectedVersion = null }) {
  root = resolve(root);
  if (!validTime(now)) fail('Invalid cycle time');
  now = new Date(now).toISOString();
  if (candidates !== undefined && !Array.isArray(candidates) || !Array.isArray(pending)) fail('Candidates/pending must be arrays');
  return await withLock(root, async () => {
    let loaded;
    try {
      loaded = await loadInternal(root);
      const policy = await readPolicy(root, true);
      if (expectedVersion !== null && expectedVersion !== loaded.current.version) fail('Workspace revision changed; expectedVersion does not match CURRENT');
      let receiptSha256 = null;
      if (receipt) {
        const verified = await replayCollectionReceipt({ receipt, rawPlayers: loaded.rawPlayers, rawPacks: loaded.rawPacks, now, approval: policy.approval, rulesIdentity: policy.rulesIdentity });
        if (candidates !== undefined && canonical(candidates) !== canonical(verified.candidates)) fail('Caller candidates differ from replayed HTML');
        if (officialObservation !== undefined && canonical(officialObservation) !== canonical(verified.officialObservation)) fail('Caller official observation differs from replayed HTML');
        candidates = verified.candidates; officialObservation = verified.officialObservation;
        pending = verified.pending; sources = verified.sources;
        const receiptBytes = Buffer.from(canonical(receipt) + '\n'); receiptSha256 = hash(receiptBytes);
        const receiptPath = join(root, 'receipts', `${receiptSha256}.json`);
        if (await has(receiptPath)) {
          if (!(await readFile(receiptPath)).equals(receiptBytes)) fail('Preserved receipt content differs');
        } else await syncedWrite(receiptPath, receiptBytes);
      } else if ((candidates?.length ?? 0) > 0 || officialObservation?.status === 'ok') {
        fail('Verified HTML receipt is required; caller verification flags are not evidence');
      }
      candidates ??= []; officialObservation ??= null;
      const knownPacks = new Map(loaded.rawPacks.filter(pack => pack.slug).map(pack => [pack.slug, pack]));
      const enriched = candidates.map(candidate => ({ ...candidate, rawPack: candidate.rawPack ?? knownPacks.get(candidate.packSlug), rawPlayers: candidate.rawPlayers ?? [] }));
      const rawPlan = planRawAppend({ rawPlayers: loaded.rawPlayers, rawPacks: loaded.rawPacks, candidates: enriched, officialObservation, now });
      const rejected = new Set(rawPlan.pending.map(item => item.packSlug));
      const approved = enriched.filter(candidate => !rejected.has(candidate.packSlug));
      const result = reconcileCatalog({ state: loaded.state, rawPlayers: rawPlan.rawPlayers, rawPacks: rawPlan.rawPacks, candidates: approved, officialObservation, now });
      const allPending = [...pending, ...rawPlan.pending, ...result.pending];
      const changed = rawPlan.addedPlayers.length > 0 || rawPlan.addedPacks.length > 0 || result.changes.length > 0;
      let current = loaded.current;
      if (changed) {
        const oldPlayers = loaded.files.get('raw/players_raw.json'); const oldPacks = loaded.files.get('raw/packs_raw.json');
        const newPlayers = rawPlan.addedPlayers.length ? jsonBytes(rawPlan.rawPlayers) : oldPlayers;
        const newPacks = rawPlan.addedPacks.length ? jsonBytes(rawPlan.rawPacks) : oldPacks;
        if (rawPlan.addedPlayers.length) result.state.rawUpdates.players.push(appendRawRecord('players', loaded.rawPlayers, rawPlan.rawPlayers, rawPlan.addedPlayers, oldPlayers, newPlayers, now, officialObservation, sources));
        if (rawPlan.addedPacks.length) result.state.rawUpdates.packs.push(appendRawRecord('packs', loaded.rawPacks, rawPlan.rawPacks, rawPlan.addedPacks, oldPacks, newPacks, now, officialObservation, sources));
        const files = generationFiles({ rawPlayerBytes: newPlayers, rawPackBytes: newPacks, state: result.state, sourcePlayerUpdateBytes: loaded.files.get(SOURCE_PLAYER_UPDATE) });
        current = await publishGeneration({ root, files, state: result.state, now, previousVersion: loaded.current.version, policy });
      }
      const check = {
        schemaVersion: 1, checkedAt: now, status: changed ? 'changed' : 'no_change',
        rulesIdentity: policy.rulesIdentity, receiptSha256,
        previousVersion: loaded.current.version, currentVersion: current.version,
        official: { status: officialObservation?.status ?? 'unavailable', complete: officialObservation?.complete ?? false, observedAt: officialObservation?.observedAt ?? null, sha256: officialObservation?.sha256 ?? null, usable: result.officialUsable },
        sources, pending: allPending, transitions: result.transitions,
        changes: result.changes.map(change => ({ id: change.id, targetFile: change.targetFile })), invariants: result.invariants,
        rawAdded: { players: rawPlan.addedPlayers.length, packs: rawPlan.addedPacks.length },
      };
      await appendCheck(root, check);
      const { files, ...after } = changed ? await loadInternal(root) : loaded;
      return { ...after, changed, pending: allPending, changes: result.changes, check };
    } catch (error) {
      await appendCheck(root, { schemaVersion: 1, checkedAt: now, status: 'error', previousVersion: loaded?.current?.version ?? null, error: error.message, sources, pending });
      throw error;
    }
  });
}

/** An explicit migration of the local rule binding; normal cycles never call it. */
export async function adoptRules({ root, expectedVersion, reviewId, reason, now = new Date().toISOString() }) {
  if (!validTime(now) || !/^[a-f0-9]{64}$/.test(expectedVersion ?? '') || !reviewId?.trim() || !reason?.trim()) fail('Rule adoption requires expected version, review ID, reason and valid UTC time');
  root = resolve(root);
  return await withLock(root, async () => {
    const current = JSON.parse(await readFile(join(root, 'CURRENT.json'), 'utf8'));
    if (current.version !== expectedVersion) fail('Rule adoption CURRENT revision changed');
    const loaded = await readGeneration(join(root, 'versions', current.version), current);
    const previous = await has(join(root, 'RULES.json')) ? JSON.parse(await readFile(join(root, 'RULES.json'), 'utf8')) : null;
    const policy = await makePolicy();
    if (previous && canonical(previous) === canonical(policy) && canonical(loaded.manifest.ruleBindings ?? null) === canonical(bindingOf(policy))) return { policy, changed: false, current };
    const temporary = join(root, `.RULES-${randomUUID()}.json`);
    try {
      await syncedWrite(temporary, jsonBytes(policy));
      await appendFile(join(root, 'rule-adoptions.jsonl'), lineBytes([{ at: new Date(now).toISOString(), reviewId, reason, expectedVersion, previous: bindingOf(previous), next: bindingOf(policy) }]), { mode: 0o600 });
      await rename(temporary, join(root, 'RULES.json')); await syncDirectory(root);
      const adopted = await publishGeneration({ root, files: loaded.files, state: loaded.state, now: new Date(now).toISOString(), previousVersion: current.version, policy });
      return { policy, changed: true, current: adopted };
    } finally { await rm(temporary, { force: true }); }
  });
}

/** Explicit reviewed draw-option migration after adopting the current rules. */
export async function migrateDrawOptions({ root, expectedVersion, now = new Date().toISOString() }) {
  if (!validTime(now) || !/^[a-f0-9]{64}$/.test(expectedVersion ?? '')) fail('Draw-option migration requires expected version and valid UTC time');
  root = resolve(root); now = new Date(now).toISOString();
  return await withLock(root, async () => {
    const loaded = await loadInternal(root);
    await readPolicy(root, true);
    if (loaded.current.version !== expectedVersion) fail('Draw-option migration CURRENT revision changed');
    const result = enrichPackDrawOptions(loaded.state, now);
    if (!result.changed) return { ...loaded, changed: false, changes: [] };
    const files = generationFiles({ rawPlayerBytes: loaded.files.get('raw/players_raw.json'), rawPackBytes: loaded.files.get('raw/packs_raw.json'), sourcePlayerUpdateBytes: loaded.files.get(SOURCE_PLAYER_UPDATE), state: result.state });
    await publishGeneration({ root, files, state: result.state, now, previousVersion: loaded.current.version, policy: loaded.policy });
    await appendCheck(root, { schemaVersion: 1, checkedAt: now, status: 'changed', operation: 'draw_options_migration', previousVersion: loaded.current.version, changes: result.changes.map(change => ({ id: change.id, targetFile: change.targetFile })), rawAdded: { players: 0, packs: 0 }, invariants: result.invariants });
    const { files: ignored, ...after } = await loadInternal(root);
    return { ...after, changed: true, changes: result.changes };
  });
}

/** Explicit T041 migration binds every existing card to its retained raw type. */
export async function migratePlayerTypes({ root, expectedVersion, now = new Date().toISOString() }) {
  if (!validTime(now) || !/^[a-f0-9]{64}$/.test(expectedVersion ?? '')) fail('Player-type migration requires expected version and valid UTC time');
  root = resolve(root); now = new Date(now).toISOString();
  return await withLock(root, async () => {
    const loaded = await loadInternal(root);
    await readPolicy(root, true);
    if (loaded.current.version !== expectedVersion) fail('Player-type migration CURRENT revision changed');
    const result = enrichPlayerTypes(loaded.state, loaded.rawPlayers, now);
    if (!result.changed) return { ...loaded, changed: false, changes: [] };
    const files = generationFiles({ rawPlayerBytes: loaded.files.get('raw/players_raw.json'), rawPackBytes: loaded.files.get('raw/packs_raw.json'), sourcePlayerUpdateBytes: loaded.files.get(SOURCE_PLAYER_UPDATE), state: result.state });
    await publishGeneration({ root, files, state: result.state, now, previousVersion: loaded.current.version, policy: loaded.policy });
    await appendCheck(root, { schemaVersion: 1, checkedAt: now, status: 'changed', operation: 'T041_player_types_migration', previousVersion: loaded.current.version, changes: result.changes.map(change => ({ id: change.id, targetFile: change.targetFile })), rawAdded: { players: 0, packs: 0 }, invariants: result.invariants });
    const { files: ignored, ...after } = await loadInternal(root);
    return { ...after, changed: true, changes: result.changes };
  });
}

async function cli() {
  const [command, ...args] = process.argv.slice(2);
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!key.startsWith('--') || !args[index + 1] || own(values, key)) fail('Expected unique --key value options');
    values[key] = args[index + 1];
  }
  const allowed = command === 'init' ? ['--root', '--players', '--packs', '--now', '--player-update'] : command === 'adopt-rules' ? ['--root', '--expected-version', '--review-id', '--reason', '--now'] : ['migrate-draw-options', 'migrate-player-types'].includes(command) ? ['--root', '--expected-version', '--now'] : ['--root', '--receipt', '--now', '--expected-version'];
  if (Object.keys(values).some(key => !allowed.includes(key))) fail('Unknown option');
  if (!values['--root']) fail('Missing --root');
  let result;
  if (command === 'init') {
    if (!values['--players'] || !values['--packs']) fail('init requires --players and --packs');
    result = await initializeWorkspace({ root: values['--root'], playersPath: values['--players'], packsPath: values['--packs'], playerUpdatePath: values['--player-update'], now: values['--now'] });
  } else if (command === 'apply') {
    const input = async key => values[key] ? JSON.parse(await readFile(resolve(values[key]), 'utf8')) : undefined;
    result = await applyCycle({ root: values['--root'], receipt: await input('--receipt'), now: values['--now'], expectedVersion: values['--expected-version'] });
  } else if (command === 'adopt-rules') {
    result = await adoptRules({ root: values['--root'], expectedVersion: values['--expected-version'], reviewId: values['--review-id'], reason: values['--reason'], now: values['--now'] });
    process.stdout.write(`${JSON.stringify(result)}\n`); return;
  } else if (command === 'migrate-draw-options') {
    result = await migrateDrawOptions({ root: values['--root'], expectedVersion: values['--expected-version'], now: values['--now'] });
  } else if (command === 'migrate-player-types') {
    result = await migratePlayerTypes({ root: values['--root'], expectedVersion: values['--expected-version'], now: values['--now'] });
  } else fail('Usage: workspace.mjs init|apply|adopt-rules|migrate-draw-options|migrate-player-types --root DIR ...');
  process.stdout.write(`${JSON.stringify({ version: result.current.version, versionPath: result.versionPath, counts: result.manifest.counts, changed: result.changed ?? true, pending: result.pending ?? [] }, null, 2)}\n`);
}
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
