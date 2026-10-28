/** Server-only read relay. No visitor headers, cookies or administrative paths are forwarded. */
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const error = (status, code, message) => new Response(JSON.stringify({ error: { code, message } }), { status, headers: JSON_HEADERS });
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function responseContentType(response) {
  const mime = response?.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  return ['application/json', 'text/html', 'text/plain', 'application/octet-stream'].includes(mime) ? mime : mime ? 'other' : 'missing';
}

function fetchFailureClass(cause) {
  const message = typeof cause?.message === 'string' ? cause.message : '';
  if (/\billegal invocation\b/i.test(message)) return 'illegal_invocation';
  if (/cannot fetch (?:the )?same worker|same[- ]zone worker|error\s*1042|global_fetch_strictly_public|worker-to-worker.*service binding/i.test(message)) return 'worker_same_zone';
  if (/\btimeout is not a function\b|AbortSignal\.timeout/i.test(message)) return 'timeout_not_supported';
  if (/not of type|invalid URL|not a valid URL|failed to parse URL|unsupported (?:input|request|resource)|URL object/i.test(message)) return 'invalid_fetch_resource';
  if (/fetch failed|failed to fetch|network|connection (?:reset|refused|closed)|could not resolve|\bDNS\b|error fetching/i.test(message)) return 'fetch_network';
  return 'other';
}

function readRoute(url) {
  if (/%(?:2f|5c|00)/i.test(url.pathname)) return false;
  let parts;
  try { parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch { return false; }
  if (parts.some(part => /[\\/\u0000-\u001f]/.test(part) || part === '.' || part === '..' || part.length > 512)) return false;
  if (parts[0] !== 'api' || parts[1] !== 'v1') return false;
  const tail = parts.slice(2);
  if (tail.length === 1 && ['health', 'manifest'].includes(tail[0])) return !url.search;
  if (!['players', 'cards', 'packs', 'live', 'archive'].includes(tail[0])) return false;
  if (tail.length < 1 || tail.length > 3) return false;
  if (tail.length === 3 && (tail[0] !== 'packs' || !['cards', 'players'].includes(tail[2]))) return false;
  if (['cards', 'players'].includes(tail[0]) && tail.length > 1 && !/^\d+$/.test(tail[1])) return false;
  const hasQuery = tail.length === 1 || tail.length === 3;
  if (!hasQuery && url.search) return false;
  for (const [key, value] of url.searchParams) {
    if (!hasQuery || !['q', 'cursor', 'limit'].includes(key) || url.searchParams.getAll(key).length !== 1 || /[\u0000-\u001f]/.test(value)) return false;
    if (key === 'q' && (tail.length === 3 || value.length > 200)) return false;
    if (key === 'cursor' && value.length > 550) return false;
    if (key === 'limit' && (!/^\d+$/.test(value) || +value < 1 || +value > 100)) return false;
  }
  return true;
}

function upstreamOrigin(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

export async function handleCatalogRelay(request, env = {}, { fetch: fetcher = globalThis.fetch, logger = console.error, timeoutMs = 10000 } = {}) {
  // Log fixed event names and bounded classifications only. Error messages, URLs,
  // header values, response bodies and credentials must never reach diagnostics.
  const diagnostic = (event, response = undefined, cause = undefined) => {
    const errorName = ['AbortError', 'TimeoutError', 'TypeError', 'Error'].includes(cause?.name) ? cause.name : cause ? 'UnknownError' : undefined;
    try { logger(JSON.stringify({ event, status: response?.status ?? 0, contentType: responseContentType(response), ...(errorName ? { errorName, errorClass: fetchFailureClass(cause) } : {}) })); } catch { /* Diagnostics cannot affect request handling. */ }
  };
  if (request.method !== 'GET') return error(405, 'method_not_allowed', '조회 요청만 지원합니다.');
  const url = new URL(request.url);
  if (!readRoute(url)) return error(400, 'invalid_request', '조회 주소 또는 검색 조건을 확인해 주세요.');
  const origin = upstreamOrigin(env.CATALOG_API_ORIGIN);
  const token = env.CATALOG_API_SERVICE_TOKEN;
  if (!origin || typeof token !== 'string' || !token || /[\r\n]/.test(token)) { diagnostic('catalog_relay_configuration_unavailable'); return error(503, 'api_not_configured', '데이터 연결을 준비 중입니다.'); }
  const upstreamUrl = new URL(url.pathname + url.search, origin);
  if (upstreamUrl.origin !== origin) return error(400, 'invalid_request', '조회 주소를 확인해 주세요.');
  let stage = 'signal_setup';
  let timeout;
  try {
    const controller = new AbortController();
    const duration = Number.isFinite(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 10000 ? timeoutMs : 10000;
    timeout = setTimeout(() => controller.abort(), duration);
    stage = 'fetch';
    const response = await fetcher.call(globalThis, upstreamUrl.href, {
      method: 'GET',
      headers: { Accept: 'application/json', 'OAI-Sites-Authorization': `Bearer ${token}` },
      // Workers supports manual/follow, but rejects error during construction.
      // Manual prevents credentials following Location; the status allowlist
      // below rejects every redirect without issuing another request.
      redirect: 'manual',
      signal: controller.signal,
    });
    stage = 'response_validation';
    if (![200, 400, 404, 409, 503].includes(response.status) || !response.headers.get('content-type')?.includes('application/json')) {
      diagnostic('catalog_relay_upstream_rejected', response);
      return error(503, 'upstream_unavailable', '데이터를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.');
    }
    const reader = response.body?.getReader();
    if (!reader) { diagnostic('catalog_relay_body_missing', response); return error(503, 'invalid_api_response', '데이터 응답을 확인할 수 없습니다.'); }
    stage = 'body_read';
    const chunks = []; let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) { await reader.cancel(); diagnostic('catalog_relay_response_too_large', response); return error(503, 'response_too_large', '응답이 너무 큽니다. 조회 범위를 줄여 주세요.'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    stage = 'json_parse';
    let body;
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { diagnostic('catalog_relay_invalid_json', response); return error(503, 'invalid_api_response', '데이터 응답을 확인할 수 없습니다.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || (response.ok ? !Object.hasOwn(body, 'data') : !body.error)) { diagnostic('catalog_relay_invalid_envelope', response); return error(503, 'invalid_api_response', '데이터 응답을 확인할 수 없습니다.'); }
    return new Response(bytes, { status: response.status, headers: JSON_HEADERS });
  } catch (cause) {
    const event = {
      signal_setup: 'catalog_relay_signal_setup_failed', fetch: 'catalog_relay_fetch_failed',
      response_validation: 'catalog_relay_response_validation_failed', body_read: 'catalog_relay_body_read_failed', json_parse: 'catalog_relay_json_processing_failed',
    }[stage] ?? 'catalog_relay_operation_failed';
    diagnostic(event, undefined, cause);
    return error(503, 'upstream_unavailable', '데이터를 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.');
  } finally { if (timeout !== undefined) clearTimeout(timeout); }
}
