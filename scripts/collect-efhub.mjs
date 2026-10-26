import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const origin = 'https://efhub.com';
const listLimit = 30;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0 && value !== '$undefined';
const integer = value => Number.isSafeInteger(value) && value >= 0;
const digest = value => createHash('sha256').update(value).digest('hex');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const https = value => { try { return new URL(value).protocol === 'https:'; } catch { return false; } };
const classes = value => new Set(String(value ?? '').split(/\s+/).filter(Boolean));
const hasClasses = (value, required) => required.every(token => classes(value).has(token));

/** The shape is the normal packs request observed in EFHub's own page script. */
export function parsePackList(payload, { page, limit = listLimit }) {
  assert(object(payload) && Array.isArray(payload.packs), '상품 목록의 packs 배열이 달라졌습니다. 재조사가 필요합니다.');
  assert(integer(payload.total) && payload.total > 0 && payload.page === page && payload.limit === limit && typeof payload.hasMore === 'boolean', '상품 목록의 총계·페이지·limit·hasMore 계약이 달라졌습니다.');
  assert(payload.hasMore === (page * limit < payload.total), '상품 목록의 총계와 hasMore가 일치하지 않습니다.');
  const expected = Math.min(limit, Math.max(0, payload.total - (page - 1) * limit));
  assert(payload.packs.length === expected, '상품 목록이 보고한 총계에 비해 일부 행이 누락되었습니다.');
  const slugs = new Set();
  for (const pack of payload.packs) {
    assert(object(pack) && text(pack.name) && text(pack.slug) && !/[\/\\?#\0]/.test(pack.slug) && !['.', '..'].includes(pack.slug) && /^\d{4}-\d{2}-\d{2}$/.test(pack.date) && integer(pack.playerCount), '상품 이름·문자열 slug·날짜·표시 카드 수가 올바르지 않습니다.');
    assert(!slugs.has(pack.slug), '같은 페이지에 상품 slug가 중복되었습니다.');
    slugs.add(pack.slug);
  }
  return { packs: payload.packs, total: payload.total, page: payload.page, limit: payload.limit, hasMore: payload.hasMore };
}

function arrayLiteral(source, start) {
  assert(source[start] === '[', 'Flight push가 JSON 배열이 아닙니다.');
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '[') depth++;
    else if (char === ']' && --depth === 0) return { value: JSON.parse(source.slice(start, index + 1)), end: index + 1 };
  }
  throw new Error('Flight push JSON 배열이 중간에 끊겼습니다.');
}

function flightRecords(html) {
  const parts = [];
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const body = script[1];
    const calls = /\bself\.__next_f\.push\s*\(\s*/g;
    for (let call; (call = calls.exec(body));) {
      const { value, end } = arrayLiteral(body, calls.lastIndex);
      calls.lastIndex = end;
      assert(Array.isArray(value), 'Flight 데이터 형식이 달라졌습니다.');
      if (value[0] === 1) {
        assert(typeof value[1] === 'string', 'Flight 문자열 payload가 필요합니다.');
        parts.push(value[1]);
      } else assert(value[0] === 0 || value[0] === 2, '지원하지 않는 Flight 전달 형식입니다. 재조사가 필요합니다.');
    }
  }
  assert(parts.length > 0, '상품 HTML에서 정상 Flight 문자열을 찾지 못했습니다.');
  const records = new Map();
  // Push boundaries can split a record or a JSON escape. Join before parsing.
  for (const line of parts.join('').split('\n')) {
    const match = /^([a-f\d]+):([\s\S]*)$/i.exec(line);
    if (!match) continue;
    const raw = match[2];
    // Module imports, debug metadata and text blocks are not JSON data records.
    if (!/^[\[{"]/.test(raw)) continue;
    try {
      assert(!records.has(match[1]), '같은 Flight JSON record ID가 중복되었습니다.');
      records.set(match[1], JSON.parse(raw));
    }
    catch { throw new Error('Flight JSON 레코드가 손상되었거나 계약이 달라졌습니다.'); }
  }
  assert(records.size > 0, '상품 Flight JSON 레코드가 없습니다.');
  return records;
}

const reactElement = value => Array.isArray(value) && value[0] === '$' && value.length >= 4 && object(value[3]);
const reactChildren = element => Array.isArray(element[3].children) ? element[3].children : [element[3].children];
const reactText = value => reactElement(value) ? reactText(value[3].children) : Array.isArray(value) ? value.map(reactText).join('') : (typeof value === 'string' || typeof value === 'number') ? String(value) : '';
function walk(value, visit) {
  if (value === null || typeof value !== 'object') return;
  visit(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child, visit);
}

function reactProductBoundaries(records) {
  const boundaries = [];
  for (const record of records.values()) walk(record, value => {
    if (!reactElement(value) || value[1] !== 'div' || !hasClasses(value[3].className, ['py-6', 'md:px-6'])) return;
    const children = reactChildren(value).filter(reactElement);
    const headers = children.filter(child => child[1] === 'div' && hasClasses(child[3].className, ['mb-6']));
    const grids = children.filter(child => child[1] === 'div' && hasClasses(child[3].className, ['grid', 'gap-3', 'grid-cols-3']));
    assert(headers.length === 1 && grids.length === 1, '상품 제목과 같은 경계에 구성 grid가 하나여야 합니다. 추천 목록 혼합 가능성이 있습니다.');
    const headerChildren = reactChildren(headers[0]).filter(reactElement);
    const headings = headerChildren.filter(child => child[1] === 'h1');
    const paragraphs = headerChildren.filter(child => child[1] === 'p');
    assert(headings.length === 1 && paragraphs.length === 1, '상품 구성의 제목·표시 인원수 경계가 달라졌습니다.');
    const count = /(?:^|[^\d])(\d+)\s+players\b/.exec(reactText(paragraphs[0]));
    assert(count, '상품 상세의 표시 카드 수를 확인할 수 없습니다.');
    const cardNodes = reactChildren(grids[0]).map(child => {
      if (typeof child !== 'string') return child;
      // Observed streamed grid children can refer to a later JSON data record.
      // Resolve only the explicit child reference, never component-type imports
      // or unrelated player objects from elsewhere in the response.
      const reference = /^\$L([a-f\d]+)$/i.exec(child);
      assert(reference && records.has(reference[1]), '구성 grid의 Flight 자식 참조를 확인할 수 없습니다.');
      return records.get(reference[1]);
    });
    assert(cardNodes.every(child => reactElement(child) && Object.hasOwn(child[3], 'player')), '구성 grid에 명시적인 PlayerCard 이외의 항목이 있습니다.');
    boundaries.push({ title: reactText(headings[0]), count: Number(count[1]), players: cardNodes.map(child => child[3].player) });
  });
  return boundaries;
}

function decodeEntities(value) {
  return value.replace(/&(#x[a-f\d]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity) => {
    if (entity[0] === '#') {
      const number = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : whole;
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[entity.toLowerCase()] ?? whole;
  });
}

// A small read-only tokenizer for the observed server-rendered boundary. No JS is run.
function htmlTree(html) {
  const source = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->/gi, '');
  const root = { tag: 'root', attrs: {}, children: [] };
  const stack = [root];
  const tags = /<\/?([a-z][\w:-]*)(?:\s+(?:[^"'<>]|"[^"]*"|'[^']*')*)?\s*\/?>/gi;
  const voids = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  let end = 0;
  for (let token; (token = tags.exec(source));) {
    if (token.index > end) stack.at(-1).children.push(decodeEntities(source.slice(end, token.index)));
    end = tags.lastIndex;
    const tag = token[1].toLowerCase();
    if (token[0].startsWith('</')) {
      const matching = stack.findLastIndex(node => node.tag === tag);
      if (matching > 0) stack.length = matching;
      continue;
    }
    const attrs = {};
    const rawAttrs = token[0].slice(token[1].length + 1, -1);
    for (const attr of rawAttrs.matchAll(/([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) attrs[attr[1].toLowerCase()] = decodeEntities(attr[2] ?? attr[3] ?? attr[4] ?? '');
    const node = { tag, attrs, children: [] };
    stack.at(-1).children.push(node);
    if (!voids.has(tag) && !token[0].endsWith('/>')) stack.push(node);
  }
  if (end < source.length) stack.at(-1).children.push(decodeEntities(source.slice(end)));
  return root;
}

const domElements = node => node.children.filter(object);
const domText = node => typeof node === 'string' ? node : node.children.map(domText).join('');
function domProductBoundaries(html) {
  const candidates = [];
  walk(htmlTree(html), value => {
    if (value.tag !== 'div' || !hasClasses(value.attrs?.class, ['py-6', 'md:px-6'])) return;
    const children = domElements(value);
    const headers = children.filter(child => child.tag === 'div' && hasClasses(child.attrs.class, ['mb-6']));
    const grids = children.filter(child => child.tag === 'div' && hasClasses(child.attrs.class, ['grid', 'gap-3', 'grid-cols-3']));
    assert(headers.length === 1 && grids.length === 1, '표시 HTML의 상품 구성 경계가 모호합니다.');
    const heading = domElements(headers[0]).filter(child => child.tag === 'h1');
    const paragraph = domElements(headers[0]).filter(child => child.tag === 'p');
    assert(heading.length === 1 && paragraph.length === 1, '표시 HTML의 상품 제목·인원수 경계가 달라졌습니다.');
    const count = /(?:^|[^\d])(\d+)\s+players\b/.exec(domText(paragraph[0]));
    assert(count, '표시 HTML의 카드 수를 확인할 수 없습니다.');
    const anchors = domElements(grids[0]);
    assert(anchors.every(anchor => anchor.tag === 'a'), '상품 구성 grid의 직접 카드 링크 구조가 달라졌습니다.');
    const ids = anchors.map(anchor => {
      const href = new URL(anchor.attrs.href, origin);
      const match = /^\/ko\/players\/(\d+)$/.exec(href.pathname);
      assert(href.origin === origin && match && !href.search && !href.hash, '구성 grid에 다른 출처나 다른 종류의 링크가 있습니다.');
      return match[1];
    });
    candidates.push({ title: domText(heading[0]).trim(), count: Number(count[1]), ids });
  });
  return candidates;
}

/** Only direct PlayerCard children of the product's observed title/count grid. */
export function parseProductPlayers(html, { expectedPlayerCount, expectedName } = {}) {
  assert(typeof html === 'string' && integer(expectedPlayerCount), '상품 HTML과 목록의 표시 카드 수가 필요합니다.');
  const candidates = reactProductBoundaries(flightRecords(html));
  assert(candidates.length === 1, '상품 Flight의 구성 경계를 하나로 확정할 수 없습니다.');
  const boundary = candidates[0];
  assert(boundary.count === expectedPlayerCount && boundary.players.length === expectedPlayerCount, '상품 목록·상세 표시 수·확보 카드 수가 다릅니다.');
  if (expectedName !== undefined) assert(boundary.title === expectedName, '상품 목록과 상세 제목이 다릅니다.');
  const ids = new Set();
  for (const player of boundary.players) {
    assert(object(player) && typeof player.id === 'string' && /^\d+$/.test(player.id), '카드 ID는 정밀도·선행 0을 보존하는 원본 숫자 문자열이어야 합니다.');
    assert(text(player.name) && Number.isFinite(player.overallRating) && player.overallRating >= 0 && https(player.imageUrl) && Number.isSafeInteger(player.playerType), `카드 필수 필드가 손상되었거나 계약이 달라졌습니다: ${player.id}`);
    assert(!ids.has(player.id), '상품 구성에 같은 카드 ID가 중복되었습니다.');
    ids.add(player.id);
  }
  const dom = domProductBoundaries(html);
  assert(dom.length === 1 && dom[0].title === boundary.title && dom[0].count === expectedPlayerCount && dom[0].ids.length === ids.size && new Set(dom[0].ids).size === ids.size && dom[0].ids.every(id => ids.has(id)), '상품 본문의 동일 구성 grid와 Flight 카드 ID가 일치하지 않습니다.');
  return structuredClone(boundary.players);
}

function proxyReady(fetchImpl) {
  if (fetchImpl !== globalThis.fetch) return;
  assert(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'TLS 검증이 비활성화된 환경에서는 수집하지 않습니다.');
  if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) {
    const options = [...process.execArgv, process.env.NODE_OPTIONS ?? ''].join(' ');
    assert(options.includes('--use-env-proxy') || process.env.NODE_USE_ENV_PROXY === '1', '세션 프록시를 보존하려면 node --use-env-proxy scripts/collect-efhub.mjs로 실행하세요.');
  }
}

async function writeSnapshot(output, snapshot) {
  try {
    await access(output);
    const previous = JSON.parse(await readFile(output, 'utf8'));
    assert(previous.schema_version === 1 && Array.isArray(previous.products) && object(previous.source_totals), '기존 출력 형식이 다릅니다. 새 경로에 저장한 뒤 수동 검토하세요.');
    assert(snapshot.source_totals.products >= previous.source_totals.products && snapshot.products.length >= previous.products.length, '수집 범위나 출처 총계가 감소했습니다. 기존 자료를 보존합니다.');
    assert(Date.parse(snapshot.observed_at) >= Date.parse(previous.observed_at), '더 오래된 수집으로 최신 관측을 덮어쓸 수 없습니다.');
    const currentProducts = new Map(snapshot.products.map(product => [product.slug, product]));
    for (const product of previous.products) {
      const current = currentProducts.get(product.slug);
      if (!current) continue; // A bounded newest-page window can move an old product out of scope.
      assert(Array.isArray(product.players_payload), '기존 상품의 카드 원본 구조가 다릅니다. 수동 검토하세요.');
      const currentIds = new Set(current.players_payload.map(player => player.id));
      assert(product.players_payload.every(player => currentIds.has(player.id)), `기존에 확보한 상품 카드가 빠졌습니다: ${product.slug}. 기존 자료를 보존합니다.`);
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(dirname(resolve(output)), { recursive: true });
  const temporary = `${resolve(output)}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8'); await rename(temporary, resolve(output)); }
  finally { await rm(temporary, { force: true }); }
}

/** Bounded, serial collection. Importing the module never starts network work. */
export async function collectEfhub({ pageLimit = 1, maxProducts = 30, delayMs = 500, requestBudget = pageLimit + maxProducts, output, fetchImpl = globalThis.fetch, sleep = pause, now = () => new Date() } = {}) {
  for (const [key, value] of Object.entries({ pageLimit, maxProducts, requestBudget })) assert(Number.isSafeInteger(value) && value > 0, `${key}는 양의 안전한 정수여야 합니다.`);
  assert(Number.isSafeInteger(delayMs) && delayMs >= 0 && delayMs <= 60000, 'delayMs는 0~60000 정수여야 합니다.');
  proxyReady(fetchImpl);
  const observations = [];
  let requests = 0;
  const request = async (url, kind) => {
    assert(requests < requestBudget, `요청 예산 ${requestBudget}회를 소진했습니다. 부분 결과를 저장하지 않습니다.`);
    if (requests > 0 && delayMs > 0) await sleep(delayMs);
    requests++;
    const response = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: kind === 'list' ? 'application/json' : 'text/html' }, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    assert(response.status >= 200 && response.status < 300, `출처 요청 실패: HTTP ${response.status} ${url}`);
    const contentType = response.headers.get('content-type') ?? '';
    assert(contentType.includes(kind === 'list' ? 'application/json' : 'text/html'), `출처 응답 종류가 달라졌습니다: ${url}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert(bytes.length <= (kind === 'list' ? 2 : 10) * 1024 * 1024, '예상 응답 크기를 초과했습니다. 재조사가 필요합니다.');
    const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const observed_at = now().toISOString();
    const sha256 = digest(bytes);
    const observation = { id: `efhub_obs_${digest(`${url}:${observed_at}:${sha256}`).slice(0, 24)}`, url, observed_at, status: response.status, sha256, verified_fields: {}, excerpts: [] };
    observations.push(observation);
    return { body, observation };
  };
  const selected = [];
  const seenSlugs = new Set();
  let total;
  let pages = 0;
  for (let page = 1; page <= pageLimit && selected.length < maxProducts; page++) {
    const url = `${origin}/api/public/packs?search=&page=${page}&limit=${listLimit}`;
    const { body, observation } = await request(url, 'list');
    const listing = parsePackList(JSON.parse(body), { page, limit: listLimit });
    assert(total === undefined || total === listing.total, '페이지 사이 출처 총계가 달라졌습니다. 일관된 관측을 위해 다시 수집하세요.');
    total = listing.total;
    pages++;
    observation.verified_fields = { source_entity_kind: 'product_list', source_entity_id: `page=${page}&limit=${listLimit}`, pagination: { total, page, limit: listLimit, hasMore: listing.hasMore }, packs: listing.packs };
    observation.excerpts = [{ pattern: 'normal packs JSON response', text: body.slice(0, 6000) }];
    for (const pack of listing.packs) {
      assert(!seenSlugs.has(pack.slug), '페이지 사이 상품 slug가 중복되었습니다. 페이지네이션을 재검증하세요.');
      seenSlugs.add(pack.slug);
      if (selected.length < maxProducts) selected.push({ ...pack, list_observation_id: observation.id });
    }
    if (!listing.hasMore) break;
  }
  const products = [];
  for (const pack of selected) {
    const url = `${origin}/ko/packs/${encodeURIComponent(pack.slug)}`;
    const { body, observation } = await request(url, 'detail');
    const players_payload = parseProductPlayers(body, { expectedPlayerCount: pack.playerCount, expectedName: pack.name });
    observation.verified_fields = { source_entity_kind: 'product', source_entity_id: pack.slug, pack_source_id: pack.slug, source_listed_player_count: pack.playerCount, players_payload, players_payload_count: players_payload.length, total_player_count: null, composition_scope: 'source_displayed_subset' };
    observation.excerpts = [{ pattern: 'same product title/count grid direct PlayerCard props', text: JSON.stringify({ name: pack.name, source_displayed_count: pack.playerCount, first_cards: players_payload.slice(0, 2) }).slice(0, 6000) }];
    products.push({ ...pack, players_payload, observation_id: observation.id });
  }
  assert(products.length > 0, '검증된 상품이 없어 기존 자료를 교체하지 않습니다.');
  const snapshot = {
    schema_version: 1,
    observed_at: now().toISOString(),
    scope: { description: `EFHub 최신 목록 ${pages}쪽에서 ${products.length}개 상품의 출처 표시 카드만 수집한 표본입니다. 판매 여부와 게임 전체 구성은 미확인입니다.`, complete: false, page_limit: pageLimit, max_products: maxProducts, request_count: requests, request_budget: requestBudget, delay_ms: delayMs },
    source_totals: { products: total },
    observations,
    products,
    limitations: ['목록 총계와 출처 표시 카드 수는 게임의 전체 구성·판매 중 여부를 입증하지 않습니다.', '가격·재화·횟수 제한·상품과 감독의 관계를 수집하지 않았습니다.', '이미지는 출처가 참조한 URL이며 이 수집기에서 실제 이미지 응답·합성 형태를 검증하지 않았습니다.', '원본 문자열 ID와 전달 sentinel을 보존합니다. 정규화 단계에서 미확인을 null로 구분해야 합니다.', '선수 전체 목록·차단된 선수 상세 API·주기적 스케줄은 이 수집기의 범위에 포함하지 않습니다.'],
  };
  if (output !== undefined) await writeSnapshot(output, snapshot);
  return snapshot;
}

async function main() {
  const options = { output: resolve(dirname(fileURLToPath(import.meta.url)), '../data/research/current-catalog-observations.json') };
  const names = { '--page-limit': 'pageLimit', '--max-products': 'maxProducts', '--delay-ms': 'delayMs', '--request-budget': 'requestBudget', '--output': 'output' };
  const args = process.argv.slice(2);
  if (args.includes('--help')) { process.stdout.write('사용법: node --use-env-proxy scripts/collect-efhub.mjs [--page-limit 1] [--max-products 30] [--delay-ms 500] [--request-budget 31] [--output 경로]\n'); return; }
  for (let index = 0; index < args.length; index++) {
    const key = names[args[index]];
    const value = args[++index];
    assert(key && value !== undefined, '알 수 없는 인자입니다. --help를 확인하세요.');
    options[key] = key === 'output' ? resolve(value) : Number(value);
  }
  const snapshot = await collectEfhub(options);
  process.stdout.write(`EFHub 표본 수집 완료: 상품 ${snapshot.products.length}개, 요청 ${snapshot.scope.request_count}/${snapshot.scope.request_budget}회. 게임 전체 구성·지속 갱신은 미검증입니다.\n저장: ${options.output}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`수집 중단: ${error.message}\n`); process.exitCode = 1; });
