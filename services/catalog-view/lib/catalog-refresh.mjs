/** Read complete, matching catalog generations; never publish partially read lists. */
export class CatalogSnapshotChanged extends Error {
  constructor() {
    super('조회 중 자료가 갱신됐습니다. 잠시 후 다시 확인해 주세요.');
    this.name = 'CatalogSnapshotChanged';
  }
}

async function collection(read, name, version, signal) {
  const values = [];
  const seen = new Set();
  let cursor = null;
  for (let page = 0; page < 1000; page++) {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor !== null) query.set('cursor', cursor);
    const body = await read(`${name}?${query}`, signal);
    if (body.meta?.catalog_snapshot_id !== version) throw new CatalogSnapshotChanged();
    if (!Array.isArray(body.data)) throw new Error('목록을 확인할 수 없습니다. 다시 불러와 주세요.');
    values.push(...body.data);
    const pagination = body.pagination;
    if (!pagination || typeof pagination !== 'object' || Array.isArray(pagination) || !Object.hasOwn(pagination, 'next_cursor')) throw new Error('목록의 다음 페이지 정보를 확인할 수 없습니다. 다시 불러와 주세요.');
    const next = pagination.next_cursor;
    if (next === null) return values;
    if (typeof next !== 'string' || !next || seen.has(next)) throw new Error('다음 목록을 불러올 수 없습니다. 다시 시도해 주세요.');
    seen.add(next);
    cursor = next;
  }
  throw new Error('목록을 불러오는 데 시간이 걸립니다. 잠시 후 다시 시도해 주세요.');
}

export async function readCatalogSnapshot({ read, currentVersion = null, signal, retries = 2 }) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal.aborted) throw signal.reason;
    const manifest = (await read('manifest', signal)).data;
    if (!manifest || typeof manifest.version_id !== 'string' || !manifest.version_id) throw new Error('자료를 준비하고 있습니다. 잠시 후 다시 확인해 주세요.');
    if (manifest.version_id === currentVersion) return null;
    // Wait for all collection reads before retrying, so an older attempt cannot
    // overlap its replacement or commit a mixed generation.
    const results = await Promise.allSettled(['live', 'archive', 'players'].map(name => collection(read, name, manifest.version_id, signal)));
    if (signal.aborted) throw signal.reason;
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) {
      const failure = failures.find(result => !(result.reason instanceof CatalogSnapshotChanged)) ?? failures[0];
      if (failure.reason instanceof CatalogSnapshotChanged && attempt < retries) continue;
      throw failure.reason;
    }
    const [live, archive, players] = results.map(result => result.value);
    return { manifest, live, archive, players };
  }
}

/** Display known sale endings even when the persisted publication is unchanged. */
export function projectCatalogSales(catalog, now = Date.now()) {
  if (catalog === null) return null;
  const ended = pack => Number.isFinite(Date.parse(pack.endsAt)) && Date.parse(pack.endsAt) <= now;
  const expired = catalog.live.filter(ended);
  return { ...catalog, live: catalog.live.filter(pack => !ended(pack)), archive: [...catalog.archive, ...expired] };
}

/** One request group at a time; background errors keep the last complete catalog. */
export function createCatalogRefresh({
  read, onCatalog, transform = value => value, onError = (..._args) => {}, onLoading = (..._args) => {},
  documentRef = globalThis.document, windowRef = globalThis.window,
  intervalMs = 60000, timeoutMs = 20000,
  setIntervalImpl = globalThis.setInterval, clearIntervalImpl = globalThis.clearInterval,
  setTimeoutImpl = globalThis.setTimeout, clearTimeoutImpl = globalThis.clearTimeout,
}) {
  let current = null;
  let inFlight = null;
  let controller = null;
  let poll = null;
  let pending = false;
  let disposed = false;
  let started = false;
  const visible = () => documentRef?.hidden !== true && documentRef?.visibilityState !== 'hidden';
  const online = () => windowRef?.navigator?.onLine !== false;
  const available = () => !disposed && visible() && online();

  function refresh() {
    if (disposed) return Promise.resolve();
    if (inFlight) { pending = true; return inFlight; }
    inFlight = (async () => {
      do {
        pending = false;
        controller = new AbortController();
        const active = controller;
        let timedOut = false;
        const timeout = setTimeoutImpl(() => { timedOut = true; active.abort(); }, timeoutMs);
        onLoading(true);
        try {
          const next = await readCatalogSnapshot({ read, currentVersion: current?.manifest.version_id ?? null, signal: active.signal });
          if (!disposed && !active.signal.aborted) {
            if (next) {
              const complete = transform(next);
              current = complete;
              onCatalog(complete);
            }
            onError('');
          }
        } catch (reason) {
          if (!disposed) onError(timedOut ? '자료 연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.' : reason instanceof Error ? reason.message : '자료를 불러오지 못했습니다.');
        } finally {
          clearTimeoutImpl(timeout);
          if (controller === active) controller = null;
          if (!disposed) onLoading(false);
        }
      } while (pending && available());
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  const request = () => { if (available()) void refresh(); };
  function setPolling() {
    if (poll !== null) clearIntervalImpl(poll);
    poll = available() ? setIntervalImpl(request, intervalMs) : null;
  }
  const visibilityChanged = () => { setPolling(); request(); };
  const onlineChanged = () => { setPolling(); request(); };
  const offlineChanged = () => setPolling();

  return {
    refresh,
    start() {
      if (started || disposed) return inFlight ?? Promise.resolve();
      started = true;
      documentRef?.addEventListener('visibilitychange', visibilityChanged);
      windowRef?.addEventListener('focus', request);
      windowRef?.addEventListener('online', onlineChanged);
      windowRef?.addEventListener('offline', offlineChanged);
      setPolling();
      return available() ? refresh() : Promise.resolve();
    },
    dispose() {
      disposed = true;
      pending = false;
      controller?.abort();
      if (poll !== null) clearIntervalImpl(poll);
      poll = null;
      documentRef?.removeEventListener('visibilitychange', visibilityChanged);
      windowRef?.removeEventListener('focus', request);
      windowRef?.removeEventListener('online', onlineChanged);
      windowRef?.removeEventListener('offline', offlineChanged);
    },
  };
}
