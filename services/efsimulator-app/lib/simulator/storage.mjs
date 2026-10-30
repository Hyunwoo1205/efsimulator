import { applySimulatorCommand, createSimulatorSession, poolFingerprint, validateSimulatorSession } from './session.mjs';

const DATABASE_VERSION = 1;
const STORE_NAME = 'sessions';

function failure(code, message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code });
}

function storageFailure(cause, fallback = 'STORAGE_ERROR') {
  if (typeof cause?.code === 'string') return cause;
  const code = cause?.name === 'QuotaExceededError' ? 'STORAGE_QUOTA'
    : cause?.name === 'VersionError' ? 'STORAGE_VERSION_UNSUPPORTED'
      : cause?.name === 'SecurityError' || cause?.name === 'InvalidStateError' ? 'STORAGE_UNAVAILABLE' : fallback;
  return failure(code, '진행 상황을 저장할 수 없습니다. 기존 기록은 유지됩니다.', cause);
}

function assertPrepared(preparation, pack, saleId) {
  const sameIds = Array.isArray(preparation?.specialPlayerIds) && Array.isArray(pack?.members)
    && JSON.stringify([...preparation.specialPlayerIds].sort()) === JSON.stringify(pack.members.map(member => member.id).sort());
  if (preparation?.ready !== true || preparation.saleId !== saleId || pack?.saleId !== saleId
    || typeof preparation.publicationVersionId !== 'string' || !preparation.publicationVersionId.trim()
    || preparation.counts?.totalPlayerCount !== pack.totalPlayerCount
    || preparation.counts?.specialPlayerCount !== pack.playerCount
    || preparation.counts?.standardPlayerCount !== pack.standardPlayerCount
    || !sameIds || JSON.stringify(preparation.drawOptions) !== JSON.stringify(pack.drawOptions)) {
    throw failure('PREPARATION_INVALID', '선수팩 자료를 다시 확인한 뒤 추첨해 주세요.');
  }
}

/**
 * Browser-local storage. Read/transition/put share one IndexedDB transaction;
 * callers receive results only after its complete event. Network/animation work
 * stays outside it, and neither failed migration nor corruption deletes records.
 * @param {{ indexedDB?: IDBFactory | null, randomInt?: (maximum: number) => number, now?: () => string, id?: () => string, databaseName?: string }} [options]
 */
export function createSimulatorStore({ indexedDB = globalThis.indexedDB, randomInt, now = () => new Date().toISOString(), id = () => globalThis.crypto.randomUUID(), databaseName = 'efsimulator-sessions-v1' } = {}) {
  let connection = null;
  let opening = null;
  let closed = false;

  function open() {
    if (closed) return Promise.reject(failure('STORAGE_CLOSED', '진행 기록 연결이 닫혔습니다. 페이지를 다시 열어 주세요.'));
    if (!indexedDB || typeof indexedDB.open !== 'function') return Promise.reject(failure('STORAGE_UNAVAILABLE', '이 브라우저에서 진행 상황을 저장할 수 없어 추첨이 잠겼습니다.'));
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      let request;
      let settled = false;
      const rejectOnce = cause => { if (!settled) { settled = true; reject(cause); } };
      try { request = indexedDB.open(databaseName, DATABASE_VERSION); }
      catch (cause) { rejectOnce(storageFailure(cause, 'STORAGE_OPEN_FAILED')); return; }
      request.onupgradeneeded = event => {
        if (event.oldVersion === 0) request.result.createObjectStore(STORE_NAME, { keyPath: 'saleId' });
      };
      request.onblocked = () => rejectOnce(failure('STORAGE_BLOCKED', '다른 탭에서 진행 기록을 사용하고 있습니다. 다른 탭을 닫고 다시 시도해 주세요.'));
      request.onerror = () => rejectOnce(storageFailure(request.error, 'STORAGE_OPEN_FAILED'));
      request.onsuccess = () => {
        const db = request.result;
        if (settled || closed) { db.close(); rejectOnce(failure('STORAGE_CLOSED', '진행 기록 연결이 닫혔습니다.')); return; }
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.close(); rejectOnce(failure('STORAGE_VERSION_UNSUPPORTED', '저장된 기록의 형식을 지원하지 않습니다. 기존 기록은 보존됩니다.')); return;
        }
        connection = db;
        db.onversionchange = () => { db.close(); connection = null; opening = null; };
        settled = true;
        resolve(db);
      };
    }).catch(cause => { opening = null; throw cause; });
    return opening;
  }

  async function transact(saleId, mode, transition) {
    if (typeof saleId !== 'string' || !saleId.trim()) throw failure('INVALID_COMMAND', '선수팩을 선택해 주세요.');
    const db = await open();
    return new Promise((resolve, reject) => {
      let transaction;
      let pendingError;
      let result;
      try { transaction = db.transaction(STORE_NAME, mode); }
      catch (cause) { reject(storageFailure(cause)); return; }
      const abort = cause => {
        pendingError = cause;
        try { transaction.abort(); }
        catch (abortCause) { reject(storageFailure(cause ?? abortCause)); }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = event => { pendingError ??= event.target?.error ?? transaction.error; };
      transaction.onabort = () => reject(storageFailure(pendingError ?? transaction.error, 'STORAGE_ABORTED'));
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(saleId);
      request.onsuccess = () => {
        try {
          const previous = request.result ?? null;
          if (previous !== null) validateSimulatorSession(previous);
          const next = transition(previous);
          result = next;
          if (mode === 'readwrite' && next !== previous) {
            const write = store.put(next);
            write.onerror = () => { pendingError = write.error; };
          }
        } catch (cause) { abort(cause); }
      };
      request.onerror = () => { pendingError = request.error; };
    });
  }

  return {
    async load(saleId) {
      return transact(saleId, 'readonly', session => session);
    },
    async ensure({ preparation, pack }) {
      return transact(pack?.saleId, 'readwrite', session => {
        assertPrepared(preparation, pack, pack.saleId);
        if (session) {
          if (session.poolFingerprint !== poolFingerprint(pack)) throw failure('POOL_CHANGED', '선수팩 구성이 변경됐습니다. 이전 진행 기록을 보존하고 추가 추첨을 멈췄습니다.');
          return session;
        }
        return createSimulatorSession({ preparation, pack, sessionId: id(), now: now() });
      });
    },
    /**
     * getContext is a synchronous reference read, never a network request. It
     * observes catalog changes while this transaction waited behind another tab.
     * @param {{ saleId: string, command: object, pack?: any, preparation?: any, getContext?: () => { pack: any, preparation: any } }} options
     */
    async execute({ saleId, command, pack, preparation, getContext }) {
      return transact(saleId, 'readwrite', session => {
        if (!session) throw failure('SESSION_NOT_FOUND', '저장된 진행 기록이 없습니다. 선수팩을 다시 선택해 주세요.');
        // A lost completion response must never cause another random draw. This
        // lookup also precedes freshness/pool/revision checks after a refresh.
        if (session.commands.some(entry => entry.id === command?.id)) return applySimulatorCommand(session, command, { randomInt, now: session.updatedAt });
        // Acknowledging a committed result only updates its viewed status. It
        // remains recoverable while source reads fail or a new pool is present.
        if (command?.type !== 'acknowledge') {
          const current = typeof getContext === 'function' ? getContext() : { pack, preparation };
          assertPrepared(current?.preparation, current?.pack, saleId);
          if (session.poolFingerprint !== poolFingerprint(current.pack)) throw failure('POOL_CHANGED', '선수팩 구성이 변경됐습니다. 이전 진행 기록을 보존하고 추가 추첨을 멈췄습니다.');
        }
        return applySimulatorCommand(session, command, { randomInt, now: now() });
      });
    },
    async close() {
      closed = true;
      if (opening) { try { await opening; } catch { /* An unsuccessful open owns no connection. */ } }
      connection?.close();
      connection = null;
      opening = null;
    },
  };
}
