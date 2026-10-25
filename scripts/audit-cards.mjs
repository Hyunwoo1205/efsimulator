import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const endpoint = 'https://efhub.com/api/public/players';
const digest = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const filled = value => typeof value === 'string' && value.trim() !== '' && value !== '$undefined';
const https = value => { try { return new URL(value).protocol === 'https:'; } catch { return false; } };

class AuditStop extends Error {
  constructor(code, message, status = 'blocked', details = {}) {
    super(message);
    Object.assign(this, { code, status, details });
  }
}
const ensure = (condition, message, code = 'schema_error') => {
  if (!condition) throw new AuditStop(code, message);
};

async function loadJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

export function parseAuditPage(raw, { page, expectedTotal, expectedLimit, negotiate = false } = {}) {
  let payload;
  try { payload = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { throw new AuditStop('invalid_json', '선수 목록 JSON을 해석할 수 없습니다.'); }
  ensure(object(payload) && Array.isArray(payload.players), '선수 목록의 players 배열이 필요합니다.');
  ensure(integer(payload.total) && payload.total > 0 && payload.page === page && integer(payload.limit) && payload.limit > 0 && integer(payload.totalPages), '선수 목록의 total/page/limit/totalPages 계약이 달라졌습니다.');
  ensure(payload.totalPages === Math.ceil(payload.total / payload.limit), '출처의 총계와 totalPages가 다릅니다.');
  if (expectedTotal !== null && expectedTotal !== undefined) ensure(payload.total === expectedTotal, '수집 도중 출처 총계가 바뀌었습니다.', 'total_changed');
  if (!negotiate && expectedLimit !== undefined) ensure(payload.limit === expectedLimit, '수집 도중 페이지 크기가 바뀌었습니다.', 'limit_changed');
  const expectedCount = Math.min(payload.limit, Math.max(0, payload.total - (page - 1) * payload.limit));
  ensure(page <= payload.totalPages && payload.players.length === expectedCount, '페이지의 실제 카드 수가 출처 총계·limit와 다릅니다.', 'page_count_mismatch');
  for (const player of payload.players) {
    ensure(object(player) && typeof player.id === 'string' && /^\d+$/.test(player.id), '카드 ID는 원본 숫자 문자열이어야 합니다. 숫자로 변환하지 않습니다.', 'invalid_card_id');
  }
  return payload;
}

export function chooseImageSamples(cards, count = 30) {
  const groups = new Map();
  for (const card of cards) {
    if (!https(card.imageUrl)) continue;
    const key = String(card.playerType ?? 'unknown');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
  }
  const result = [];
  const seen = new Set();
  let index = 0;
  while (result.length < count) {
    let advanced = false;
    for (const group of groups.values()) {
      const card = group[index];
      if (!card) continue;
      advanced = true;
      if (seen.has(card.imageUrl)) continue;
      seen.add(card.imageUrl);
      result.push(card);
      if (result.length === count) break;
    }
    if (!advanced) break;
    index++;
  }
  return result;
}

function proxyReady(fetchImpl) {
  if (fetchImpl !== globalThis.fetch) return;
  ensure(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'TLS 검증이 꺼진 환경에서는 실행하지 않습니다.', 'tls_disabled');
  if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) {
    const options = [...process.execArgv, process.env.NODE_OPTIONS ?? ''].join(' ');
    ensure(options.includes('--use-env-proxy') || process.env.NODE_USE_ENV_PROXY === '1', 'node --use-env-proxy scripts/audit-cards.mjs로 세션 프록시를 유지하세요.', 'proxy_required');
  }
}

function retryDelay(response, attempt, timestamp) {
  const value = response.headers.get('retry-after');
  if (value !== null) {
    if (/^\d+(?:\.\d+)?$/.test(value.trim())) return Number(value) * 1000;
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.max(0, date - Date.parse(timestamp));
  }
  return Math.min(30_000, (response.status === 429 ? 2000 : 1000) * 2 ** attempt);
}

/** Read-only, serial source enumeration. Published application data is never changed. */
export async function runAudit({
  artifactDir = resolve('artifacts/card-audit'),
  summaryPath = resolve('data/research/card-api-audit.json'),
  fetchImpl = globalThis.fetch,
  now = () => new Date().toISOString(),
  sleep = pause,
  intervalMs = 350,
  requestBudget = 2300,
  imageSampleSize = 30,
  preferredLimit = 100,
  resume = false,
  onProgress = () => {},
} = {}) {
  proxyReady(fetchImpl);
  ensure(integer(intervalMs) && (fetchImpl !== globalThis.fetch || intervalMs >= 250), '실제 요청 간격은 최소 250ms이어야 합니다.');
  ensure(integer(requestBudget) && requestBudget > 0 && integer(imageSampleSize) && integer(preferredLimit) && preferredLimit > 0, '예산·이미지 표본 수·limit가 올바르지 않습니다.');
  artifactDir = resolve(artifactDir);
  summaryPath = resolve(summaryPath);
  const stamp = () => {
    const value = now();
    return new Date(value instanceof Date ? value : String(value)).toISOString();
  };
  const statePath = resolve(artifactDir, 'state.json');
  const existing = await loadJson(statePath);
  ensure(!existing || resume, '체크포인트가 이미 있습니다. --resume을 사용하거나 별도 artifact 경로를 지정하세요.', 'checkpoint_exists');
  let state = existing ?? {
    schema_version: 1, run_id: randomUUID(), started_at: stamp(), observed_at: stamp(), status: 'running',
    source: endpoint, preferred_limit: preferredLimit, negotiated_limit: null, expected_total: null,
    expected_total_pages: null, next_page: 1, pages: {}, request_count: 0,
    request_log: [], errors: [], image_results: [], total_stable: true,
  };
  ensure(state.schema_version === 1 && state.source === endpoint && object(state.pages) && Array.isArray(state.request_log) && Array.isArray(state.errors) && Array.isArray(state.image_results), '체크포인트 형식이 달라졌습니다.', 'invalid_checkpoint');
  ensure(!existing || existing.preferred_limit === preferredLimit, '재개 중 요청 모드를 바꾸지 않습니다. 기존 중단 기록을 보존하고 별도 감사 경로에서 검토하세요.', 'checkpoint_mode_mismatch');
  state.request_budget = requestBudget;
  state.interval_ms = intervalMs;
  const ids = new Map();
  const cards = [];
  const rawFields = new Set();
  const coverage = { name: 0, image_url: 0, overall_rating: 0, primary_type: 0 };
  let rawCount = 0;
  const absorb = (payload, page) => {
    for (const card of payload.players) {
      rawCount++;
      for (const key of Object.keys(card)) rawFields.add(key);
      if (filled(card.name)) coverage.name++;
      if (https(card.imageUrl)) coverage.image_url++;
      if (typeof card.overallRating === 'number' && Number.isFinite(card.overallRating)) coverage.overall_rating++;
      if (Number.isSafeInteger(card.playerType)) coverage.primary_type++;
      if (!ids.has(card.id)) { ids.set(card.id, []); cards.push(card); }
      ids.get(card.id).push(page);
    }
  };
  const checkpoint = async () => {
    state.observed_at = stamp();
    await atomicJson(statePath, state);
  };
  const summary = () => {
    const visited = Object.keys(state.pages).map(Number).sort((a, b) => a - b);
    const expected = state.expected_total_pages ?? 0;
    const missing = Array.from({ length: expected }, (_, index) => index + 1).filter(page => !Object.hasOwn(state.pages, String(page)));
    const duplicates = [...ids].filter(([, pages]) => pages.length > 1).map(([id, pages]) => ({ id, pages }));
    const lastPage = visited.at(-1) ?? null;
    const paginationComplete = expected > 0 && missing.length === 0 && ids.size === state.expected_total && rawCount === state.expected_total && duplicates.length === 0 && state.total_stable && lastPage === expected;
    const samples = chooseImageSamples(cards, imageSampleSize);
    const targetSamples = Math.min(imageSampleSize, state.expected_total ?? imageSampleSize);
    const imageComplete = samples.length === targetSamples && state.image_results.length === samples.length && state.image_results.every(item => item.valid);
    const complete = state.status === 'complete' && paginationComplete && imageComplete;
    const fieldCoverage = Object.fromEntries(Object.entries(coverage).map(([field, present]) => [field, { present, missing: rawCount - present, total: rawCount, scope: 'all_collected_card_rows' }]));
    fieldCoverage.additional_types = { status: 'not_verified_for_all_cards', observed_primary_format: 'single playerType value', scope: 'list_endpoint_only', note: 'Single primary classification is not proof that cards have no simultaneous additional classification.' };
    fieldCoverage.background_asset = { status: 'not_verified_for_all_cards', scope: 'list_endpoint_only', observed_matching_keys: [...rawFields].filter(key => /background|cutout/i.test(key)), note: 'imageUrl does not establish a separate background/player asset or visual composition.' };
    fieldCoverage.version_links = { status: 'not_verified_for_all_cards', scope: 'list_endpoint_only', observed_matching_keys: [...rawFields].filter(key => /version/i.test(key)), note: 'No name/ID arithmetic is used to infer other card versions or real people.' };
    return {
      schema_version: 1, run_id: state.run_id, status: state.status, complete,
      observed_range: { started_at: state.request_log[0]?.requested_at ?? null, ended_at: state.request_log.at(-1)?.observed_at ?? null },
      source: { url: endpoint, reported_total: state.expected_total, reported_total_pages: state.expected_total_pages, preferred_limit: state.preferred_limit, negotiated_limit: state.negotiated_limit, total_stable: state.expected_total === null ? null : state.total_stable },
      pages: { visited_count: visited.length, expected_count: expected, visited, missing, last_page: lastPage, last_page_count: lastPage === null ? null : state.pages[String(lastPage)].count, pagination_complete: paginationComplete },
      cards: { raw_count: rawCount, unique_ids_count: ids.size, ids_sha256: digest([...ids.keys()].sort().join('\n')), duplicates, missing_count: state.expected_total === null ? null : Math.max(0, state.expected_total - ids.size), missing_identity_list: null, field_coverage: fieldCoverage, observed_field_keys: [...rawFields].sort(), note: 'Cards are released card versions, not a count of distinct real players. Listing fields are not the entire source/game detail schema.' },
      requests: { count: state.request_count, budget: state.request_budget, interval_ms: state.interval_ms, concurrency: 1, log: state.request_log, supplemental_diagnostic_count: state.source_ui_recheck?.request_count ?? 0 },
      image_validation: { requested_samples: imageSampleSize, checked_samples: state.image_results.length, selected_samples: samples.length, complete: imageComplete, method: 'Serial HTTPS GET of the actual imageUrl; MIME, magic bytes and response byte length checked. URLs checked for every collected row; real image fetches are sampled.', results: state.image_results },
      errors: state.errors,
      limitations: ['Counts verify the observed list pagination, not an atomic upstream database snapshot or historical completeness beyond the source catalogue.', 'A source total deficit cannot identify the missing card IDs; IDs are never generated from numeric sequences.', 'Additional categories, OVR training/booster conditions, separate background assets and all version links require further field/detail research.', 'No production seed, application database or public deployment is changed.'],
      artifacts: { state: statePath, raw_pages: resolve(artifactDir, 'pages'), incomplete_summary: resolve(artifactDir, 'latest-summary.json') },
      source_ui_recheck: state.source_ui_recheck ?? null,
    };
  };
  const finish = async () => {
    await checkpoint();
    const report = summary();
    await atomicJson(resolve(artifactDir, 'latest-summary.json'), report);
    const previous = await loadJson(summaryPath);
    if (report.complete || previous === null || previous.complete === false) await atomicJson(summaryPath, report);
    else report.previous_complete_summary_preserved = true;
    return { summary: report, state };
  };
  const request = async (url, details) => {
    const pendingErrors = [];
    for (let attempt = 0; attempt <= 3; attempt++) {
      if (state.request_count >= requestBudget) throw new AuditStop('request_budget', '고정 요청 예산에 도달했습니다.', 'paused');
      if (state.request_count > 0) await sleep(intervalMs);
      const started = stamp();
      state.request_count++;
      let response;
      try { response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { 'user-agent': 'Mozilla/5.0', accept: details.kind === 'image' ? 'image/*' : 'application/json' } }); }
      catch (error) {
        state.request_log.push({ url, ...details, attempt, requested_at: started, observed_at: stamp(), status: null });
        throw new AuditStop('network_error', `정상 HTTPS 요청 실패: ${error.message}`, 'blocked', { url });
      }
      const record = { url, ...details, attempt, requested_at: started, observed_at: stamp(), status: response.status };
      state.request_log.push(record);
      if (response.status === 200) {
        for (const index of pendingErrors) state.errors[index].recovered = true;
        // Persist the known HTTP attempt before writing its raw page. If the
        // process stops between raw persistence and page registration, resume
        // can verify the existing bytes against a fresh normal response.
        await checkpoint();
        return { response, record };
      }
      const retryable = response.status === 429 || (response.status >= 500 && response.status <= 599);
      state.errors.push({ code: `http_${response.status}`, ...record, recovered: false, retryable });
      pendingErrors.push(state.errors.length - 1);
      if (!retryable) throw new AuditStop(`http_${response.status}`, `HTTP ${response.status}: 정상 경로 요청을 중단합니다.`, 'blocked', { url });
      const delay = retryDelay(response, attempt, stamp());
      if (delay > 60_000) {
        state.resume_after = new Date(Date.parse(stamp()) + delay).toISOString();
        throw new AuditStop('retry_after_pause', 'Retry-After가 60초를 초과해 체크포인트에 중단 상태를 저장합니다.', 'paused', { url, retry_after_ms: delay });
      }
      if (attempt === 3) throw new AuditStop('retry_exhausted', '허용한 일시적 오류 재시도 횟수를 사용했습니다.', 'paused', { url });
      await sleep(delay);
    }
  };
  try {
    for (const page of Object.keys(state.pages).map(Number).sort((a, b) => a - b)) {
      const raw = await readFile(resolve(artifactDir, 'pages', `${page}.json`), 'utf8');
      ensure(digest(raw) === state.pages[String(page)].sha256, '체크포인트 원본 페이지 해시가 다릅니다.', 'checkpoint_hash_mismatch');
      absorb(parseAuditPage(raw, { page, expectedTotal: state.expected_total, expectedLimit: state.negotiated_limit }), page);
    }
    if (existing && ['blocked', 'complete'].includes(existing.status)) return await finish();
    if (state.resume_after && Date.parse(state.resume_after) > Date.parse(stamp())) { state.status = 'paused'; return await finish(); }
    delete state.resume_after;
    state.status = 'running';
    for (const error of state.errors) {
      if (['request_budget', 'retry_after_pause', 'retry_exhausted'].includes(error.code)) error.resumed_at = stamp();
    }
    while (state.expected_total_pages === null || state.next_page <= state.expected_total_pages) {
      const page = state.next_page;
      const limit = state.negotiated_limit ?? state.preferred_limit;
      // The observed normal UI has no initial query and page=N thereafter.
      // limit100 is a separately authorized one-time size probe. HTTP403 never
      // switches mode; only a successful response can establish actual limit24.
      const normalUiQuery = limit === 24;
      const url = normalUiQuery ? `${endpoint}${page === 1 ? '' : `?page=${page}`}` : `${endpoint}?page=${page}&limit=${limit}`;
      const { response, record } = await request(url, { kind: 'page', page });
      const raw = await response.text();
      record.response_bytes = Buffer.byteLength(raw);
      record.content_type = response.headers.get('content-type');
      ensure((record.content_type ?? '').includes('application/json'), '선수 목록 MIME이 JSON이 아닙니다.', 'invalid_content_type');
      let payload;
      try { payload = parseAuditPage(raw, { page, expectedTotal: state.expected_total, expectedLimit: state.negotiated_limit, negotiate: state.negotiated_limit === null }); }
      catch (error) { if (error.code === 'total_changed') state.total_stable = false; throw error; }
      if (state.expected_total === null) {
        state.expected_total = payload.total;
        state.expected_total_pages = payload.totalPages;
        state.negotiated_limit = payload.limit;
      }
      ensure(payload.totalPages === state.expected_total_pages, '수집 중 페이지 총수가 바뀌었습니다.', 'total_pages_changed');
      await mkdir(resolve(artifactDir, 'pages'), { recursive: true });
      const pagePath = resolve(artifactDir, 'pages', `${page}.json`);
      try { await writeFile(pagePath, raw, { encoding: 'utf8', flag: 'wx' }); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const previousRaw = await readFile(pagePath, 'utf8');
        ensure(digest(previousRaw) === digest(raw), '체크포인트에 등록되지 않은 원본 페이지와 새 정상 응답이 다릅니다. 기존 파일을 보존합니다.', 'orphan_page_conflict');
        state.orphan_recoveries ??= [];
        state.orphan_recoveries.push({ page, sha256: digest(raw), verified_at: record.observed_at, method: 'Existing raw bytes matched the freshly validated normal HTTP response; existing file preserved.' });
      }
      state.pages[String(page)] = { sha256: digest(raw), count: payload.players.length, observed_at: record.observed_at, url };
      absorb(payload, page);
      state.next_page = page + 1;
      await checkpoint();
      if ([...ids.values()].some(pages => pages.length > 1)) throw new AuditStop('duplicate_card_id', '카드 원본 ID가 중복되어 전체 확보를 확정할 수 없습니다.');
      if (page === 1 || page % 100 === 0 || page === state.expected_total_pages) onProgress({ phase: 'pages', pages: page, total_pages: state.expected_total_pages, raw_cards: rawCount, unique_ids: ids.size, requests: state.request_count, negotiated_limit: state.negotiated_limit });
    }
    ensure(summary().pages.pagination_complete, '전체 페이지·고유 ID·마지막 페이지의 대조가 완료되지 않았습니다.', 'incomplete_pagination');
    const samples = chooseImageSamples(cards, imageSampleSize);
    ensure(samples.length === Math.min(imageSampleSize, cards.length), '요청한 이미지 표본을 구성할 충분한 유효 URL이 없습니다.', 'insufficient_image_urls');
    for (const card of samples) {
      if (state.image_results.some(item => item.card_id === card.id && item.url === card.imageUrl && item.valid)) continue;
      const { response, record } = await request(card.imageUrl, { kind: 'image', card_id: card.id });
      const body = Buffer.from(await response.arrayBuffer());
      const mime = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ?? '';
      const png = body.length >= 24 && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpeg = body.length > 3 && body[0] === 255 && body[1] === 216 && body[2] === 255;
      const webp = body.length > 12 && body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP';
      const gif = body.length > 6 && /^GIF8[79]a$/.test(body.toString('ascii', 0, 6));
      const valid = body.length > 0 && ((mime === 'image/png' && png) || (mime === 'image/jpeg' && jpeg) || (mime === 'image/webp' && webp) || (mime === 'image/gif' && gif));
      const result = { card_id: card.id, primary_type: card.playerType ?? null, url: card.imageUrl, status: response.status, observed_at: record.observed_at, mime, bytes: body.length, sha256: digest(body), valid };
      if (png) { result.width = body.readUInt32BE(16); result.height = body.readUInt32BE(20); }
      state.image_results.push(result);
      await checkpoint();
      ensure(valid, '이미지 표본의 MIME·매직바이트·응답 크기가 유효하지 않습니다.', 'invalid_image_response');
      onProgress({ phase: 'images', checked: state.image_results.length, selected: samples.length, requests: state.request_count });
    }
    state.status = 'complete';
    return await finish();
  } catch (error) {
    state.status = error instanceof AuditStop ? error.status : 'blocked';
    const previous = state.errors.at(-1);
    if (previous?.code === error.code && previous.url === error.details?.url) Object.assign(previous, { message: error.message, terminal: true, terminal_at: stamp(), details: error.details });
    else state.errors.push({ code: error.code ?? 'code_error', message: error.message, observed_at: stamp(), retryable: state.status === 'paused', details: error.details ?? {} });
    return await finish();
  }
}

function cliOptions(argv) {
  const options = {};
  const numeric = { '--interval-ms': 'intervalMs', '--request-budget': 'requestBudget', '--image-samples': 'imageSampleSize', '--limit': 'preferredLimit' };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--resume') options.resume = true;
    else if (argument === '--artifact-dir') options.artifactDir = resolve(argv[++index]);
    else if (argument === '--summary') options.summaryPath = resolve(argv[++index]);
    else if (numeric[argument]) { const value = Number(argv[++index]); ensure(integer(value), `잘못된 숫자 옵션: ${argument}`); options[numeric[argument]] = value; }
    else throw new Error(`지원하지 않는 옵션: ${argument}`);
  }
  ensure((options.imageSampleSize ?? 30) >= 30, '실제 CLI 이미지 표본은 최소 30개입니다.');
  ensure([24, 100].includes(options.preferredLimit ?? 100), '실제 CLI limit 모드는 24(정상 UI 쿼리) 또는 100(크기 검증)입니다.');
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = cliOptions(process.argv.slice(2));
    const result = await runAudit({ ...options, onProgress: update => process.stdout.write(`${JSON.stringify({ event: 'progress', ...update })}\n`) });
    process.stdout.write(`${JSON.stringify({ event: 'result', status: result.summary.status, complete: result.summary.complete, pages: result.summary.pages.visited_count, unique_ids: result.summary.cards.unique_ids_count, requests: result.summary.requests.count, errors: result.summary.errors.at(-1) ?? null })}\n`);
    if (!result.summary.complete) process.exitCode = result.summary.status === 'paused' ? 2 : 1;
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
