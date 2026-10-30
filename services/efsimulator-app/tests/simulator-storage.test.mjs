import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { prepareSimulatorPack } from '../lib/simulator/prepare.mjs';
import { createSimulatorStore } from '../lib/simulator/storage.mjs';

const NOW = '2026-10-30T12:00:00.000Z';
function fixture({ saleId = 'pack-round-a', total = 12, publication = 'publication-a' } = {}) {
  const player = { id: '99999999999999999999', name: 'Exact Player', slug: 'exact-player', position: 'CF', overallRating: 99, playingStyle: null, playingStyleDefensive: null, imageUrl: 'https://example.com/card.png', playerType: 5 };
  const pack = {
    saleId, name: 'Example', officialTitle: 'Example', playerCount: 1, totalPlayerCount: total,
    standardPlayerCount: total - 1, date: '2026-10-29', endsAt: '2026-11-02T01:59:59.000Z',
    members: [{ id: player.id, name: player.name }], players: [player],
    drawOptions: {
      single: { supported: true, count: 1, coinCost: 100 },
      ten: { supported: total > 11, count: 10, coinCost: 900, minimumRemaining: 10 },
      provenance: { authority: 'direct_user_confirmation', reference: 'T042', rule: 'total_player_count_gt_11' },
    },
  };
  const preparation = prepareSimulatorPack({ saleId, catalog: { manifest: { version_id: publication }, live: [pack], archive: [], players: [player] } });
  assert.equal(preparation.ready, true);
  return { pack, preparation };
}

function setup(t, overrides = {}) {
  const indexedDB = new IDBFactory();
  const databaseName = 'test-sessions';
  let ids = 0, randomCalls = 0;
  const options = { indexedDB, databaseName, now: () => NOW, id: () => `session-${++ids}`, randomInt: () => { randomCalls++; return 0; }, ...overrides };
  const stores = [];
  const makeStore = extra => { const store = createSimulatorStore({ ...options, ...extra }); stores.push(store); return store; };
  t.after(async () => { await Promise.all(stores.map(store => store.close())); });
  return { indexedDB, databaseName, makeStore, get randomCalls() { return randomCalls; }, get ids() { return ids; } };
}

const draw = (session, id = 'draw-command', count = 1) => ({ id, type: 'draw', expectedRevision: session.revision, count, batchId: `${id}-batch` });
const acknowledge = (session, id = 'ack-command') => ({ id, type: 'acknowledge', expectedRevision: session.revision, batchId: session.pendingBatchId });

async function rawDatabase(indexedDB, databaseName, version) {
  return new Promise((resolve, reject) => {
    const request = version === undefined ? indexedDB.open(databaseName) : indexedDB.open(databaseName, version);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('sessions')) request.result.createObjectStore('sessions', { keyPath: 'saleId' }); };
    request.onsuccess = () => resolve(request.result);
  });
}

async function rawRecord(indexedDB, databaseName, saleId, replacement = undefined) {
  const db = await rawDatabase(indexedDB, databaseName);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('sessions', replacement === undefined ? 'readonly' : 'readwrite');
      const request = replacement === undefined ? transaction.objectStore('sessions').get(saleId) : transaction.objectStore('sessions').put(replacement);
      let result;
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

test('IDB commits complete sessions and reload recovers the same pending batch without new randomness', async t => {
  const env = setup(t), source = fixture(), store = env.makeStore();
  assert.equal(await store.load(source.pack.saleId), null);
  const initial = await store.ensure(source);
  const result = await store.execute({ ...source, saleId: initial.saleId, command: draw(initial) });
  assert.equal(result.totals.drawCount, 1); assert.equal(result.totals.coinCost, 100);
  assert.ok(result.pendingBatchId); assert.equal(env.randomCalls, 1);
  await store.close();
  const reopened = env.makeStore();
  assert.deepEqual(await reopened.load(initial.saleId), result);
  assert.equal(env.randomCalls, 1);
});

test('two connections atomically ensure one missing session without overwriting its first identity', async t => {
  const env = setup(t), source = fixture(), a = env.makeStore(), b = env.makeStore();
  const [first, second] = await Promise.all([a.ensure(source), b.ensure(source)]);
  assert.deepEqual(first, second); assert.equal(env.ids, 1);
});

test('cross-tab commands with one expected revision commit only one batch and spend once', async t => {
  const env = setup(t), source = fixture(), a = env.makeStore(), b = env.makeStore();
  const initial = await a.ensure(source);
  const results = await Promise.allSettled([
    a.execute({ ...source, saleId: initial.saleId, command: draw(initial, 'tab-a') }),
    b.execute({ ...source, saleId: initial.saleId, command: draw(initial, 'tab-b') }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  const saved = await b.load(initial.saleId);
  assert.equal(saved.batches.length, 1); assert.equal(saved.totals.drawCount, 1); assert.equal(env.randomCalls, 1);
});

test('simultaneous retries with the same command ID return the committed batch once, before newer context guards', async t => {
  const env = setup(t), source = fixture(), a = env.makeStore(), b = env.makeStore();
  const initial = await a.ensure(source), command = draw(initial);
  const results = await Promise.all([
    a.execute({ ...source, saleId: initial.saleId, command }),
    b.execute({ ...source, saleId: initial.saleId, command }),
  ]);
  assert.deepEqual(results[0], results[1]); assert.equal(env.randomCalls, 1);
  const retryStore = env.makeStore({ now: () => { throw new Error('Replay must not execute a new command'); }, randomInt: () => { throw new Error('Replay must not draw'); } });
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () { throw new Error('Replay must not write'); };
  try {
    const replay = await retryStore.execute({ saleId: initial.saleId, command, preparation: { ready: false }, pack: fixture({ total: 150 }).pack, getContext: () => { throw new Error('Replay must not recheck context'); } });
    assert.deepEqual(replay, results[0]); assert.equal(env.randomCalls, 1);
  } finally { IDBObjectStore.prototype.put = originalPut; }
});

test('pending draw blocks another draw and reset, while acknowledgement works during catalog failure', async t => {
  const env = setup(t), source = fixture(), store = env.makeStore();
  const initial = await store.ensure(source);
  const pending = await store.execute({ ...source, saleId: initial.saleId, command: draw(initial) });
  for (const command of [draw(pending, 'another-draw'), { id: 'reset-pending', type: 'reset', expectedRevision: pending.revision }]) {
    await assert.rejects(store.execute({ ...source, saleId: initial.saleId, command }), error => error.code === 'PENDING_BATCH');
  }
  const confirmed = await store.execute({ saleId: initial.saleId, command: acknowledge(pending), preparation: { ready: false }, pack: null, getContext: () => { throw new Error('Acknowledgement must not recheck context'); } });
  assert.equal(confirmed.pendingBatchId, null); assert.equal(confirmed.totals.drawCount, 1); assert.equal(env.randomCalls, 1);
  assert.deepEqual(await store.load(initial.saleId), confirmed);
});

test('fresh preparation and pool are checked inside the transaction; changed pool preserves old history', async t => {
  const env = setup(t), source = fixture(), store = env.makeStore(), changed = fixture({ total: 150 });
  const initial = await store.ensure(source);
  await assert.rejects(store.execute({ ...source, preparation: { ...source.preparation, ready: false }, saleId: initial.saleId, command: draw(initial) }), error => error.code === 'PREPARATION_INVALID');
  await assert.rejects(store.execute({ ...source, preparation: { ...source.preparation, counts: { ...source.preparation.counts, totalPlayerCount: 150 } }, saleId: initial.saleId, command: draw(initial) }), error => error.code === 'PREPARATION_INVALID');
  await assert.rejects(store.ensure(changed), error => error.code === 'POOL_CHANGED');
  await assert.rejects(store.execute({ ...changed, saleId: initial.saleId, command: draw(initial) }), error => error.code === 'POOL_CHANGED');
  assert.deepEqual(await store.load(initial.saleId), initial); assert.equal(env.randomCalls, 0);
});

test('another publication and display corrections keep the existing session and exact IDs', async t => {
  const env = setup(t), source = fixture(), store = env.makeStore();
  const initial = await store.ensure(source), changed = fixture({ publication: 'publication-b' });
  changed.pack.name = 'Display correction'; changed.pack.players[0].imageUrl = 'https://example.com/new.png';
  assert.deepEqual(await store.ensure(changed), initial);
  assert.equal((await store.load(initial.saleId)).activeRound.remainingSpecialIds[0], '99999999999999999999');
});

test('queued transactions read the latest synchronous context before sampling or writing', async t => {
  const env = setup(t), source = fixture(), store = env.makeStore();
  const initial = await store.ensure(source);
  for (const [nextContext, code] of [
    [{ ...source, preparation: { ...source.preparation, ready: false } }, 'PREPARATION_INVALID'],
    [fixture({ total: 150 }), 'POOL_CHANGED'],
  ]) {
    let context = source;
    const events = [];
    const db = await rawDatabase(env.indexedDB, env.databaseName);
    const blocker = db.transaction('sessions', 'readwrite');
    const blockerComplete = new Promise((resolve, reject) => {
      blocker.oncomplete = resolve;
      blocker.onabort = () => reject(blocker.error);
    });
    const request = blocker.objectStore('sessions').get(initial.saleId);
    request.onsuccess = () => { context = nextContext; events.push('context_changed'); };
    const pending = store.execute({ ...source, saleId: initial.saleId, command: draw(initial), getContext: () => { events.push('context_rechecked'); return context; } });
    await assert.rejects(pending, error => error.code === code);
    await blockerComplete; db.close();
    assert.deepEqual(events, ['context_changed', 'context_rechecked']);
    assert.deepEqual(await store.load(initial.saleId), initial);
  }
  assert.equal(env.randomCalls, 0);
});

test('request success followed by transaction abort cannot expose an uncommitted random result', async t => {
  const env = setup(t), source = fixture(), store = env.makeStore();
  const initial = await store.ensure(source), originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const request = originalPut.apply(this, args), transaction = this.transaction;
    request.addEventListener('success', () => transaction.abort());
    return request;
  };
  try {
    await assert.rejects(store.execute({ ...source, saleId: initial.saleId, command: draw(initial) }), error => error.code === 'STORAGE_ABORTED');
  } finally { IDBObjectStore.prototype.put = originalPut; }
  assert.deepEqual(await store.load(initial.saleId), initial);
  assert.equal(env.randomCalls, 1);
});

test('quota failure aborts the same readwrite transaction and retains the previous pool/history', async t => {
  const env = setup(t), source = fixture(), store = env.makeStore();
  const initial = await store.ensure(source), originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () { throw new DOMException('Simulated full browser storage', 'QuotaExceededError'); };
  try {
    await assert.rejects(store.execute({ ...source, saleId: initial.saleId, command: draw(initial) }), error => error.code === 'STORAGE_QUOTA');
  } finally { IDBObjectStore.prototype.put = originalPut; }
  assert.deepEqual(await store.load(initial.saleId), initial);
});

test('invalid or unsupported saved session remains byte-for-byte present and is never silently replaced', async t => {
  const env = setup(t), source = fixture(), store = env.makeStore();
  const initial = await store.ensure(source);
  for (const corrupted of [{ ...initial, schemaVersion: 999 }, { ...initial, activeRound: null }]) {
    await rawRecord(env.indexedDB, env.databaseName, initial.saleId, corrupted);
    await assert.rejects(store.load(initial.saleId));
    await assert.rejects(store.ensure(source));
    assert.deepEqual(await rawRecord(env.indexedDB, env.databaseName, initial.saleId), corrupted);
  }
});

test('future database versions are rejected without deleting their existing records', async t => {
  const env = setup(t), source = fixture(), db = await rawDatabase(env.indexedDB, env.databaseName, 2);
  db.close();
  const futureRecord = { saleId: source.pack.saleId, schemaVersion: 999, untouched: 'future session' };
  await rawRecord(env.indexedDB, env.databaseName, source.pack.saleId, futureRecord);
  const store = env.makeStore();
  await assert.rejects(store.ensure(source), error => error.code === 'STORAGE_VERSION_UNSUPPORTED');
  assert.deepEqual(await rawRecord(env.indexedDB, env.databaseName, source.pack.saleId), futureRecord);
  const preserved = await rawDatabase(env.indexedDB, env.databaseName);
  assert.equal(preserved.version, 2); assert.ok(preserved.objectStoreNames.contains('sessions')); preserved.close();
});

test('unsupported storage, closed connections, and missing sessions fail without memory fallback', async t => {
  const source = fixture(), unavailable = createSimulatorStore({ indexedDB: null });
  await assert.rejects(unavailable.ensure(source), error => error.code === 'STORAGE_UNAVAILABLE');
  const env = setup(t), store = env.makeStore();
  await assert.rejects(store.execute({ ...source, saleId: source.pack.saleId, command: { id: 'missing', type: 'draw', expectedRevision: 0, count: 1 } }), error => error.code === 'SESSION_NOT_FOUND');
  await store.close();
  await assert.rejects(store.load(source.pack.saleId), error => error.code === 'STORAGE_CLOSED');
});

test('different sale IDs keep independent pools and histories across reset and acknowledgement', async t => {
  const env = setup(t), a = fixture(), b = fixture({ saleId: 'pack-round-b' }), store = env.makeStore();
  const first = await store.ensure(a), other = await store.ensure(b);
  const pending = await store.execute({ ...a, saleId: first.saleId, command: draw(first) });
  const confirmed = await store.execute({ ...a, saleId: first.saleId, command: acknowledge(pending) });
  const reset = await store.execute({ ...a, saleId: first.saleId, command: { id: 'manual-reset', type: 'reset', expectedRevision: confirmed.revision } });
  assert.equal(reset.activeRound.number, 2); assert.equal(reset.totals.drawCount, 1); assert.equal(reset.totals.coinCost, 100);
  assert.deepEqual(await store.load(other.saleId), other);
});
