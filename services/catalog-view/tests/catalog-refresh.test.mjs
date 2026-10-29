import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogRefresh, readCatalogSnapshot, CatalogSnapshotChanged, projectCatalogSales } from '../lib/catalog-refresh.mjs';

class Events {
  listeners = new Map();
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  emit(name) { for (const fn of this.listeners.get(name) ?? []) fn(); }
  count() { return [...this.listeners.values()].reduce((total, values) => total + values.size, 0); }
}
function environment() {
  const documentRef = Object.assign(new Events(), { hidden: false, visibilityState: 'visible' });
  const windowRef = Object.assign(new Events(), { navigator: { onLine: true } });
  const polls = new Map(); const timeouts = new Map(); let id = 0;
  return { documentRef, windowRef, polls, timeouts,
    setIntervalImpl(fn, duration) { assert.equal(duration, 60000); polls.set(++id, fn); return id; },
    clearIntervalImpl(key) { polls.delete(key); },
    setTimeoutImpl(fn) { timeouts.set(++id, fn); return id; },
    clearTimeoutImpl(key) { timeouts.delete(key); },
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function source() {
  const state = { version: 'v1', calls: [], failure: null };
  state.read = async (path, signal) => {
    state.calls.push(path); assert.equal(signal.aborted, false);
    if (state.failure) throw state.failure;
    if (path === 'manifest') return { data: { version_id: state.version, created_at: null } };
    const name = path.split('?')[0];
    return { data: [{ name, version: state.version }], meta: { catalog_snapshot_id: state.version }, pagination: { next_cursor: null } };
  };
  return state;
}
function setup(extra = {}) {
  const env = environment(); const api = source(); const committed = []; const errors = [];
  const updater = createCatalogRefresh({ ...env, read: api.read, onCatalog: value => committed.push(value), onError: value => errors.push(value), ...extra });
  return { env, api, committed, errors, updater };
}

test('initial load commits one whole generation; unchanged refresh only reads manifest', async () => {
  const { updater, api, committed, env } = setup();
  await updater.start();
  assert.equal(committed.length, 1);
  assert.deepEqual(committed[0].live, [{ name: 'live', version: 'v1' }]);
  assert.equal(api.calls.length, 4);
  await updater.refresh();
  assert.equal(api.calls.length, 5);
  assert.equal(committed.length, 1);
  assert.equal(env.timeouts.size, 0);
  updater.dispose();
});

test('visible polling detects a new publication and atomically replaces all lists', async () => {
  const { updater, api, committed, env } = setup();
  await updater.start(); api.version = 'v2';
  for (const poll of env.polls.values()) poll();
  await flush();
  assert.equal(committed.length, 2);
  assert.equal(committed[1].manifest.version_id, 'v2');
  for (const name of ['live', 'archive', 'players']) assert.equal(committed[1][name][0].version, 'v2');
  updater.dispose();
});

test('mixed-generation reads retry from a new manifest and never commit the partial attempt', async () => {
  let manifests = 0; const read = async path => {
    if (path === 'manifest') return { data: { version_id: ++manifests === 1 ? 'v1' : 'v2' } };
    return { data: [path], meta: { catalog_snapshot_id: 'v2' }, pagination: { next_cursor: null } };
  };
  const value = await readCatalogSnapshot({ read, signal: new AbortController().signal });
  assert.equal(manifests, 2);
  assert.equal(value.manifest.version_id, 'v2');
  assert.equal(value.players.length, 1);
});

test('generation races are bounded to the initial attempt and two retries', async () => {
  let manifests = 0;
  await assert.rejects(readCatalogSnapshot({ read: async path => path === 'manifest' ? { data: { version_id: `v${++manifests}` } } : { data: [], meta: { catalog_snapshot_id: 'different' } }, signal: new AbortController().signal }), CatalogSnapshotChanged);
  assert.equal(manifests, 3);
});

test('background failure and rejected validation preserve last-good data and retry later', async () => {
  const { updater, api, committed, errors } = setup({ transform: value => { if (value.manifest.version_id === 'invalid') throw new Error('invalid catalog'); return value; } });
  await updater.start(); api.failure = new Error('connection failed'); await updater.refresh();
  assert.equal(committed.length, 1); assert.equal(errors.at(-1), 'connection failed');
  api.failure = null; api.version = 'invalid'; await updater.refresh();
  assert.equal(committed.length, 1); assert.equal(errors.at(-1), 'invalid catalog');
  api.version = 'v2'; await updater.refresh();
  assert.equal(committed.length, 2); assert.equal(errors.at(-1), '');
  updater.dispose();
});

test('focus, online and visibility events coalesce behind one in-flight operation', async () => {
  const env = environment(); let resolveManifest; let manifests = 0; let active = 0; let maxActive = 0;
  const updater = createCatalogRefresh({ ...env, onCatalog: () => {}, read: async path => {
    active++; maxActive = Math.max(maxActive, active);
    try {
      if (path === 'manifest') { manifests++; if (manifests === 1) await new Promise(resolve => { resolveManifest = resolve; }); return { data: { version_id: 'v1' } }; }
      return { data: [], meta: { catalog_snapshot_id: 'v1' }, pagination: { next_cursor: null } };
    } finally { active--; }
  } });
  const initial = updater.start();
  env.windowRef.emit('focus'); env.windowRef.emit('focus'); env.windowRef.emit('online'); env.documentRef.emit('visibilitychange');
  assert.equal(manifests, 1);
  resolveManifest(); await initial;
  assert.equal(manifests, 2);
  // Collection reads may be parallel; no second manifest starts before they finish.
  assert.equal(maxActive <= 3, true);
  updater.dispose();
});

test('hidden/offline tabs stop polling; returning to a visible online tab checks immediately', async () => {
  const { updater, api, env } = setup(); await updater.start();
  env.documentRef.hidden = true; env.documentRef.visibilityState = 'hidden'; env.documentRef.emit('visibilitychange');
  assert.equal(env.polls.size, 0);
  const before = api.calls.length; env.windowRef.emit('focus'); await flush(); assert.equal(api.calls.length, before);
  env.documentRef.hidden = false; env.documentRef.visibilityState = 'visible'; env.documentRef.emit('visibilitychange'); await flush();
  assert.equal(env.polls.size, 1); assert.equal(api.calls.length, before + 1);
  env.windowRef.navigator.onLine = false; env.windowRef.emit('offline'); assert.equal(env.polls.size, 0);
  env.windowRef.navigator.onLine = true; env.windowRef.emit('online'); await flush(); assert.equal(api.calls.length, before + 2);
  updater.dispose();
});

test('initial hidden tab waits for visibility instead of starting network work', async () => {
  const { updater, api, env } = setup(); env.documentRef.hidden = true;
  await updater.start(); assert.equal(api.calls.length, 0); assert.equal(env.polls.size, 0);
  env.documentRef.hidden = false; env.documentRef.emit('visibilitychange'); await flush();
  assert.equal(api.calls.length, 4); updater.dispose();
});

test('timeout aborts a stalled fetch, reports a bounded message and clears its timer', async () => {
  const env = environment(); const errors = []; let signal;
  const updater = createCatalogRefresh({ ...env, onCatalog: () => assert.fail('stalled data must not commit'), onError: value => errors.push(value), read: (_path, inputSignal) => {
    signal = inputSignal;
    return new Promise((_resolve, reject) => inputSignal.addEventListener('abort', () => reject(inputSignal.reason), { once: true }));
  } });
  const loading = updater.start(); for (const timeout of env.timeouts.values()) timeout(); await loading;
  assert.equal(signal.aborted, true); assert.match(errors.at(-1), /지연/); assert.equal(env.timeouts.size, 0);
  updater.dispose();
});

test('dispose aborts active work, removes listeners/timers and prevents late commits or errors', async () => {
  const env = environment(); const errors = []; let signal; let reads = 0;
  const updater = createCatalogRefresh({ ...env, onCatalog: () => assert.fail('disposed data must not commit'), onError: value => errors.push(value), read: (_path, inputSignal) => {
    reads++; signal = inputSignal;
    return new Promise((_resolve, reject) => inputSignal.addEventListener('abort', () => reject(inputSignal.reason), { once: true }));
  } });
  const initial = updater.start(); updater.dispose(); await initial;
  assert.equal(signal.aborted, true); assert.equal(env.polls.size, 0); assert.equal(env.timeouts.size, 0);
  assert.equal(env.windowRef.count() + env.documentRef.count(), 0); assert.deepEqual(errors, []);
  env.windowRef.emit('focus'); await updater.refresh(); assert.equal(reads, 1);
});

test('pagination detects a repeated cursor instead of hanging or committing a partial list', async () => {
  await assert.rejects(readCatalogSnapshot({ signal: new AbortController().signal, read: async path => path === 'manifest' ? { data: { version_id: 'v1' } } : { data: [], meta: { catalog_snapshot_id: 'v1' }, pagination: { next_cursor: 'same' } } }), /다음 목록/);
});

test('missing or malformed pagination cannot replace the last complete catalog', async () => {
  for (const pagination of [undefined, null, [], {}, { next_cursor: undefined }, { next_cursor: 0 }, { next_cursor: '' }]) {
    const env = environment(); let partial = false; const committed = []; const errors = [];
    const updater = createCatalogRefresh({ ...env, onCatalog: value => committed.push(value), onError: value => errors.push(value), read: async path => {
      const version = partial ? 'v2' : 'v1';
      if (path === 'manifest') return { data: { version_id: version } };
      return { data: [{ version }], meta: { catalog_snapshot_id: version }, ...(partial ? { pagination } : { pagination: { next_cursor: null } }) };
    } });
    await updater.start(); assert.equal(committed.length, 1);
    partial = true; await updater.refresh();
    assert.equal(committed.length, 1); assert.equal(committed[0].manifest.version_id, 'v1');
    assert.ok(errors.at(-1)); updater.dispose();
  }
});

test('known sale ends move locally at the exact boundary without publication change or input mutation', () => {
  const ending = Object.freeze({ saleId: 'ending', endsAt: '2026-10-29T03:00:00.000Z' });
  const future = Object.freeze({ saleId: 'future', endsAt: '2026-10-30T03:00:00.000Z' });
  const old = Object.freeze({ saleId: 'old', endsAt: '2026-10-28T03:00:00.000Z' });
  const catalog = Object.freeze({ manifest: Object.freeze({ version_id: 'same-publication' }), live: Object.freeze([ending, future]), archive: Object.freeze([old]), players: Object.freeze([]) });
  const boundary = Date.parse(ending.endsAt);
  const before = projectCatalogSales(catalog, boundary - 1);
  const after = projectCatalogSales(catalog, boundary);
  assert.deepEqual(before.live, [ending, future]); assert.deepEqual(before.archive, [old]);
  assert.deepEqual(after.live, [future]); assert.deepEqual(after.archive, [old, ending]);
  assert.equal(after.manifest, catalog.manifest); assert.equal(after.players, catalog.players);
  assert.deepEqual(catalog.live, [ending, future]); assert.deepEqual(catalog.archive, [old]);
  assert.deepEqual(projectCatalogSales(after, boundary).archive, [old, ending]);
  assert.equal(projectCatalogSales(null, boundary), null);
});
