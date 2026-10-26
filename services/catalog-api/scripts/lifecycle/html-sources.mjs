import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const OFFICIAL = 'https://efootball-web.konami.net/probability_kr.php';
const EFHUB = 'https://efhub.com';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0 && value !== '$undefined';
const digest = value => createHash('sha256').update(value).digest('hex');
function requireThat(condition, message, code = 'source_layout_changed') {
  if (!condition) throw Object.assign(new Error(message), { code });
}

export function validateHtmlSourceUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw Object.assign(new Error('Invalid HTML source URL.'), { code: 'invalid_source_url' }); }
  requireThat(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && !url.port, 'Only ordinary HTTPS source pages are supported.', 'invalid_source_url');
  requireThat(url.href === OFFICIAL || (url.origin === EFHUB && /^\/(?:[a-z]{2}\/)?(?:new-players|players\/\d+|packs\/[a-z\d-]+)\/?$/.test(url.pathname)), 'Only new-players and linked player/pack HTML pages are supported; API requests are forbidden.', 'invalid_source_url');
  return url;
}

function htmlDocument(html) {
  requireThat(typeof html === 'string' && html.length > 0, 'HTML source is empty.', 'source_empty');
  requireThat(!/(?:cf-chl-|challenge-platform|Just a moment|Access denied|Error\s*1010|captcha|checking your browser)/i.test(html), 'Access challenge or denial page; stop without retrying.', 'source_denied');
  requireThat(/<html\b/i.test(html) && /<body\b/i.test(html) && /<\/body\s*>/i.test(html) && /<\/html\s*>/i.test(html), 'HTML document is incomplete.');
}

const entities = value => value.replace(/&(#x[a-f\d]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity) => {
  if (entity[0] === '#') {
    const number = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : whole;
  }
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[entity.toLowerCase()] ?? whole;
});

// Read-only HTML tokenizer. Scripts are data inputs to flightData(), never executed.
function tree(html) {
  const source = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->/gi, '');
  const root = { tag: 'root', attrs: {}, children: [] };
  const stack = [root];
  const tags = /<\/?([a-z][\w:-]*)(?:\s+(?:[^"'<>]|"[^"]*"|'[^']*')*)?\s*\/?>/gi;
  const voids = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  let end = 0;
  for (let token; (token = tags.exec(source));) {
    if (token.index > end) stack.at(-1).children.push(entities(source.slice(end, token.index)));
    end = tags.lastIndex;
    const tag = token[1].toLowerCase();
    if (token[0].startsWith('</')) {
      const matching = stack.findLastIndex(node => node.tag === tag);
      if (matching > 0) stack.length = matching;
      continue;
    }
    const attrs = {};
    for (const attr of token[0].slice(token[1].length + 1, -1).matchAll(/([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) attrs[attr[1].toLowerCase()] = entities(attr[2] ?? attr[3] ?? attr[4] ?? '');
    const node = { tag, attrs, children: [] };
    stack.at(-1).children.push(node);
    if (!voids.has(tag) && !token[0].endsWith('/>')) stack.push(node);
  }
  if (end < source.length) stack.at(-1).children.push(entities(source.slice(end)));
  return root;
}
const nodeText = value => typeof value === 'string' ? value : value.children.map(nodeText).join('');
const elements = value => value.children.filter(object);
const hasClass = (node, value) => String(node.attrs?.class ?? '').split(/\s+/).includes(value);
function walk(value, visit) {
  if (!object(value) && !Array.isArray(value)) return;
  visit(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child, visit);
}
function domWalk(value, visit) {
  if (!object(value) || !value.tag) return;
  visit(value);
  for (const child of value.children) domWalk(child, visit);
}
function descendants(node, predicate) {
  const found = [];
  domWalk(node, value => { if (predicate(value)) found.push(value); });
  return found;
}

function envelope(html, options, defaultUrl) {
  const source_url = options.sourceUrl ?? defaultUrl;
  validateHtmlSourceUrl(source_url);
  const observed_at = options.observedAt ?? new Date().toISOString();
  requireThat(Number.isFinite(Date.parse(observed_at)), 'A valid observation timestamp is required.', 'invalid_timestamp');
  return { source_url, observed_at, sha256: digest(html), complete: true };
}

/** The full Korean probability HTML must contain every normal product boundary. */
export function parseOfficialHtml(html, options = {}) {
  htmlDocument(html);
  const dom = tree(html);
  const lists = descendants(dom, node => node.tag === 'dl' && hasClass(node, 'probability'));
  requireThat(lists.length === 1 && nodeText(lists[0]).includes('처음 영입할 때의 선수 수') && nodeText(lists[0]).includes('주의 사항'), 'Official probability list or its completion marker is absent.');
  const boundaries = descendants(lists[0], node => hasClass(node, 'probability_data'));
  requireThat(boundaries.length > 0, 'Official product list is empty.', 'source_empty');
  const seen = new Set();
  const records = boundaries.map(node => {
    const titles = descendants(node, child => child.tag === 'p' && hasClass(child, 'data_title'));
    const paragraphs = descendants(node, child => child.tag === 'p').map(nodeText).map(value => value.trim());
    requireThat(titles.length === 1 && nonempty(nodeText(titles[0])), 'Official product title is missing or ambiguous.');
    const endRows = paragraphs.filter(value => /^종료 일시\s*\(UTC\)/.test(value));
    const countRows = paragraphs.filter(value => /^처음 영입할 때의 선수 수/.test(value));
    const probabilityRows = paragraphs.filter(value => /^처음 영입할 때의 영입 확률/.test(value));
    requireThat(endRows.length === 1 && countRows.length === 1 && probabilityRows.length === 1, 'Official product end, initial count or probability is missing.');
    const end = /^종료 일시\s*\(UTC\)\s*[：:]\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s*$/.exec(endRows[0]);
    const count = /^처음 영입할 때의 선수 수\s*[：:]\s*([1-9]\d*)\s*$/.exec(countRows[0]);
    const probability = /^처음 영입할 때의 영입 확률\s*[：:]\s*(\d+(?:\.\d+)?%)\s*$/.exec(probabilityRows[0]);
    requireThat(end && count && probability, 'Official product field format changed.');
    const endsAt = `${end[1]}T${end[2]}Z`;
    requireThat(Number.isFinite(Date.parse(endsAt)) && new Date(endsAt).toISOString() === endsAt.replace('Z', '.000Z'), 'Official product UTC date is invalid.');
    const totalPlayerCount = Number(count[1]);
    requireThat(Number.isSafeInteger(totalPlayerCount) && totalPlayerCount > 0, 'Official initial count is invalid.');
    const title = nodeText(titles[0]).trim();
    const key = `${title}\0${endsAt}`;
    requireThat(!seen.has(key), 'Official product rows are duplicated.');
    seen.add(key);
    return { title, totalPlayerCount, endsAt, probabilityText: probability[1] };
  });
  return { ...envelope(html, options, OFFICIAL), records };
}

function arrayLiteral(source, start) {
  requireThat(source[start] === '[', 'Flight push must contain a JSON array.');
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
    else if (char === ']' && --depth === 0) {
      try { return { value: JSON.parse(source.slice(start, index + 1)), end: index + 1 }; }
      catch { throw Object.assign(new Error('Flight push is not JSON; scripts are never evaluated.'), { code: 'source_layout_changed' }); }
    }
  }
  throw Object.assign(new Error('Flight push JSON is truncated.'), { code: 'source_layout_changed' });
}

function flightData(html) {
  const pieces = [];
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const calls = /\bself\.__next_f\.push\s*\(\s*/g;
    for (let call; (call = calls.exec(script[1]));) {
      const parsed = arrayLiteral(script[1], calls.lastIndex);
      calls.lastIndex = parsed.end;
      requireThat(Array.isArray(parsed.value), 'Flight data is not an array.');
      if (parsed.value[0] === 1) {
        requireThat(typeof parsed.value[1] === 'string', 'Flight payload is not a string.');
        pieces.push(parsed.value[1]);
      } else requireThat(parsed.value[0] === 0 || parsed.value[0] === 2, 'Unsupported Flight push kind.');
    }
  }
  const records = [];
  for (const line of pieces.join('').split('\n')) {
    const match = /^([a-f\d]+):([\s\S]*)$/i.exec(line);
    if (!match || !/^[\[{"]/.test(match[2])) continue;
    try { records.push(JSON.parse(match[2])); }
    catch { throw Object.assign(new Error('Flight JSON record is corrupt.'), { code: 'source_layout_changed' }); }
  }
  return records;
}

const RAW_PLAYER_FIELDS = ['id', 'name', 'nameJa', 'nameZh', 'slug', 'nationality', 'nationalityCode', 'team', 'position', 'overallRating', 'playingStyle', 'playingStyleDefensive', 'imageUrl', 'playerType'];
function rawPlayer(player) {
  requireThat(object(player) && typeof player.id === 'string' && /^\d+$/.test(player.id), 'Player IDs must be exact decimal strings; numeric IDs are rejected.');
  requireThat(['name', 'slug', 'position', 'imageUrl'].every(key => nonempty(player[key])) && Number.isFinite(player.overallRating) && Number.isSafeInteger(player.playerType), 'Player detail does not contain the required original fields.');
  requireThat(new URL(player.imageUrl).protocol === 'https:', 'Player image URL must be HTTPS.');
  // Raw append uses the same field set as the supplied source-export arrays.
  // Missing optional fields stay missing; no blank nationality or translation is invented.
  return Object.fromEntries(RAW_PLAYER_FIELDS.filter(key => Object.hasOwn(player, key) && player[key] !== '$undefined').map(key => [key, structuredClone(player[key])]));
}
function rawPack(pack) {
  requireThat(object(pack) && nonempty(pack.name) && typeof pack.slug === 'string' && /^[a-z\d-]+$/.test(pack.slug) && /^\d{4}-\d{2}-\d{2}$/.test(pack.date) && Number.isSafeInteger(pack.playerCount) && pack.playerCount >= 0, 'Pack HTML lacks its original name, slug, date or reported special count.');
  requireThat(new Date(`${pack.date}T00:00:00Z`).toISOString().startsWith(pack.date), 'Pack date is invalid.');
  return { name: pack.name, slug: pack.slug, date: pack.date, playerCount: pack.playerCount };
}
function embeddedObjects(html, field) {
  const found = [];
  for (const record of flightData(html)) walk(record, value => {
    if (object(value) && object(value[field])) found.push(value[field]);
  });
  return found;
}
function uniqueObjects(values, key) {
  const found = new Map();
  for (const value of values) {
    const previous = found.get(value[key]);
    requireThat(!previous || JSON.stringify(previous) === JSON.stringify(value), `Conflicting embedded ${key} records.`);
    found.set(value[key], value);
  }
  return [...found.values()];
}
function playerLink(node, sourceUrl) {
  let url;
  try { url = new URL(node.attrs.href, sourceUrl); } catch { return null; }
  const match = /^\/(?:[a-z]{2}\/)?players\/(\d+)\/?$/.exec(url.pathname);
  if (url.origin !== EFHUB || !match || url.search || url.hash) return null;
  const imageNames = descendants(node, child => child.tag === 'img').map(child => child.attrs.alt?.trim()).filter(nonempty);
  const nameNodes = descendants(node, child => child.tag === 'p' || hasClass(child, 'player-name'));
  // A title supplied by the link/image/name node is source text; card rating+position text is not guessed away.
  const name = node.attrs.title?.trim() || imageNames.at(-1) || nameNodes.map(nodeText).map(value => value.trim()).filter(nonempty).at(-1) || null;
  return { id: match[1], name, detailUrl: url.href };
}

/** Section membership comes only from links inside each heading's own section. */
export function parseNewPlayersHtml(html, options = {}) {
  htmlDocument(html);
  const dom = tree(html);
  const h1s = descendants(dom, node => node.tag === 'h1' && nodeText(node).trim() === 'New Players');
  requireThat(h1s.length === 1, 'New Players heading is absent or ambiguous.');
  const sections = [];
  domWalk(dom, parent => {
    const children = elements(parent);
    const headings = children.filter(node => node.tag === 'h2');
    if (!headings.length) return;
    for (const heading of headings) {
      const start = children.indexOf(heading);
      const nextHeading = children.findIndex((node, index) => index > start && /^h[12]$/.test(node.tag));
      const boundary = children.slice(start + 1, nextHeading === -1 ? undefined : nextHeading);
      const linkedNodes = boundary.flatMap(node => descendants(node, child => child.tag === 'a'));
      const players = linkedNodes.map(node => playerLink(node, options.sourceUrl ?? `${EFHUB}/new-players`)).filter(Boolean);
      requireThat(players.length > 0, 'A new-player section is empty or its membership links changed.');
      requireThat(new Set(players.map(player => player.id)).size === players.length, 'A new-player section repeats a card ID.');
      const packLinks = descendants(heading, node => node.tag === 'a').map(node => new URL(node.attrs.href, EFHUB)).filter(url => url.origin === EFHUB && /^\/(?:[a-z]{2}\/)?packs\/[a-z\d-]+\/?$/.test(url.pathname));
      requireThat(packLinks.length <= 1, 'A section has ambiguous pack links.');
      const packUrl = packLinks[0]?.href ?? null;
      const packSlug = packLinks[0]?.pathname.split('/').filter(Boolean).at(-1) ?? null;
      sections.push({ title: nodeText(heading).trim(), packSlug, packUrl, players, complete: true });
    }
  });
  requireThat(sections.length > 0, 'No complete new-player section was found.');
  const sectionIds = new Set(sections.flatMap(section => section.players.map(player => player.id)));
  const rawPlayers = uniqueObjects(embeddedObjects(html, 'player').filter(value => sectionIds.has(value.id)).map(rawPlayer), 'id');
  const rawPacks = uniqueObjects(embeddedObjects(html, 'pack').map(rawPack), 'slug');
  return { ...envelope(html, options, `${EFHUB}/new-players`), sections, rawPlayers, rawPacks };
}

export function parsePlayerHtml(html, options = {}) {
  htmlDocument(html);
  const source = envelope(html, options, options.sourceUrl ?? `${EFHUB}/new-players`);
  const id = options.expectedId ?? new URL(source.source_url).pathname.match(/\/players\/(\d+)\/?$/)?.[1];
  requireThat(typeof id === 'string' && /^\d+$/.test(id), 'A detail player ID is required.');
  const players = uniqueObjects(embeddedObjects(html, 'player').filter(value => value.id === id).map(rawPlayer), 'id');
  requireThat(players.length === 1, 'Exactly one matching embedded detail player is required.');
  const h1s = descendants(tree(html), node => node.tag === 'h1');
  requireThat(h1s.some(node => nodeText(node).trim() === players[0].name), 'Detail name and visible primary heading disagree.');
  return { ...source, player: players[0] };
}

export function parsePackHtml(html, options = {}) {
  htmlDocument(html);
  const source = envelope(html, options, options.sourceUrl ?? `${EFHUB}/new-players`);
  const slug = options.expectedSlug ?? new URL(source.source_url).pathname.match(/\/packs\/([^/]+)\/?$/)?.[1];
  requireThat(nonempty(slug), 'A detail pack slug is required.');
  const packs = uniqueObjects(embeddedObjects(html, 'pack').filter(value => value.slug === slug).map(rawPack), 'slug');
  requireThat(packs.length === 1, 'Pack HTML must explicitly include its original four-field pack metadata.');
  const dom = tree(html);
  const headings = descendants(dom, node => node.tag === 'h1' && nodeText(node).trim() === packs[0].name);
  requireThat(headings.length === 1, 'Pack heading and embedded pack metadata disagree.');
  // Accept only a bounded section/product container holding the matching heading and its grid.
  const candidates = [];
  domWalk(dom, node => {
    if (!['section', 'article', 'div'].includes(node.tag)) return;
    const localHeadings = descendants(node, child => child.tag === 'h1');
    if (localHeadings.length !== 1 || localHeadings[0] !== headings[0]) return;
    const grids = descendants(node, child => hasClass(child, 'grid') && descendants(child, leaf => leaf.tag === 'a').some(anchor => playerLink(anchor, source.source_url)));
    if (grids.length === 1) candidates.push({ node, grid: grids[0] });
  });
  requireThat(candidates.length > 0, 'Pack membership grid is absent.');
  const grid = candidates.at(-1).grid;
  const links = descendants(grid, node => node.tag === 'a').map(node => playerLink(node, source.source_url)).filter(Boolean);
  requireThat(links.length === packs[0].playerCount && new Set(links.map(player => player.id)).size === links.length, 'Pack reported count and direct membership links differ.');
  const allowed = new Set(links.map(player => player.id));
  const players = uniqueObjects(embeddedObjects(html, 'player').filter(value => allowed.has(value.id)).map(rawPlayer), 'id');
  requireThat(players.length === links.length, 'Some membership cards lack their embedded original fields.');
  return { ...source, pack: packs[0], players, playerIds: links.map(player => player.id), membershipComplete: true };
}

/** One ordinary HTML GET, no API, retry, cookie, authentication or header rotation. */
export async function fetchHtmlSnapshot(value, options = {}) {
  const url = validateHtmlSourceUrl(value);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (fetchImpl === globalThis.fetch) {
    requireThat(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'TLS validation must stay enabled.', 'unsafe_environment');
    if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) {
      requireThat([...process.execArgv, process.env.NODE_OPTIONS ?? ''].join(' ').includes('--use-env-proxy') || process.env.NODE_USE_ENV_PROXY === '1', 'Keep the configured environment proxy with node --use-env-proxy; do not change proxies.', 'proxy_required');
    }
  }
  const observed_at = (options.now?.() ?? new Date()).toISOString();
  const response = await fetchImpl(url.href, { method: 'GET', redirect: 'manual', headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(options.timeoutMs ?? 20000) });
  const meta = { source_url: url.href, observed_at, status: response.status, complete: false };
  if (response.status !== 200) throw Object.assign(new Error(`HTML source returned HTTP ${response.status}; stop without retrying.`), { code: response.status === 403 || response.status === 429 ? 'source_denied' : 'source_http_error', ...meta });
  requireThat(/^text\/html(?:;|$)/i.test(response.headers.get('content-type') ?? ''), 'Source did not return HTML.');
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  requireThat(!response.headers.get('content-length') || Number(response.headers.get('content-length')) <= maxBytes, 'HTML source exceeds the byte budget.', 'source_too_large');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value: chunk, done } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      requireThat(size <= maxBytes, 'HTML source exceeds the byte budget.', 'source_too_large');
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) { await reader.cancel(); throw error; }
  const bytes = Buffer.concat(chunks);
  const html = bytes.toString('utf8');
  htmlDocument(html);
  const snapshot = { ...meta, complete: true, bytes: size, sha256: digest(bytes), html };
  if (options.outputDir) {
    await mkdir(options.outputDir, { recursive: true });
    const stem = `${observed_at.replace(/[:.]/g, '-')}-${url.hostname}-${digest(url.href).slice(0, 12)}`;
    await writeFile(join(options.outputDir, `${stem}.html`), bytes, { flag: 'wx' });
    const { html: _html, ...metadata } = snapshot;
    await writeFile(join(options.outputDir, `${stem}.json`), `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });
  }
  return snapshot;
}

/** A single check cycle. Source failures are explicit and never become empty DBs. */
export async function checkHtmlSources(options = {}) {
  const now = options.now ?? (() => new Date());
  const result = { schemaVersion: 1, checkedAt: now().toISOString(), complete: false, sources: {} };
  for (const [name, url, parse] of [['official', OFFICIAL, parseOfficialHtml], ['efhub', `${EFHUB}/new-players`, parseNewPlayersHtml]]) {
    try {
      const snapshot = await fetchHtmlSnapshot(url, { ...options, now });
      const parsed = parse(snapshot.html, { sourceUrl: url, observedAt: snapshot.observed_at });
      result.sources[name] = { status: 'ok', ...parsed };
    } catch (error) {
      result.sources[name] = { status: error.code === 'source_denied' ? 'blocked' : 'error', complete: false, source_url: url, observed_at: error.observed_at ?? now().toISOString(), http_status: error.status ?? null, code: error.code ?? 'source_fetch_failed', message: error.message, previousDataAction: 'preserve' };
    }
  }
  result.complete = Object.values(result.sources).every(source => source.status === 'ok' && source.complete === true);
  if (options.outputDir) {
    await mkdir(options.outputDir, { recursive: true });
    const filename = `${result.checkedAt.replace(/[:.]/g, '-')}-source-check.json`;
    await writeFile(join(options.outputDir, filename), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output-dir' || !args[1]) throw new Error('Usage: node --use-env-proxy scripts/lifecycle/html-sources.mjs --output-dir ABSOLUTE_RUN_DIR');
  const report = await checkHtmlSources({ outputDir: args[1] });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.complete) process.exitCode = 2;
}
