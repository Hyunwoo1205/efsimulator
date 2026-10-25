const app = document.querySelector('#app');
const number = new Intl.NumberFormat('ko-KR');
const dateTime = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
const tabs = { products: '선수팩·상품', cards: '선수 카드' };
const managerScopeNote = '감독 정보는 서비스 지원 범위에서 제외합니다. 실제 상품에 감독이 없다는 뜻은 아닙니다.';
const kindLabels = { special_list: '특수 선수 명단', pack: '일괄 지급형 팩' };
const typeLabels = { normal: 'Standard', featured: 'Featured', trending: 'Trend', legend: 'Legend', epic: 'Epic', highlight: 'Highlight', bigtime: 'Big Time', showtime: 'Show Time' };
const fieldLabels = { name: '이름', overall: '표시 종합 능력', types: '카드 분류', type_mapping: '분류 정의', image: '이미지', asset_ids: '이미지', other_version_ids: '다른 버전', kind: '상품 종류', list_types: '명단 분류', entries: '확보 구성', source_listed_player_count: '출처 표시 목록 수', total_player_count: '전체 선수 수', price: '가격', currency: '재화', limits: '이용 제한', availability: '이용 기간', opening_options: '개봉 옵션' };
let data;
let cards;
let products;
let assets;
let observations;

function node(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') element.className = value;
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined && child !== false) element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

function safeUrl(value, image = false) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    if (image && !(url.hostname === 'efimg.com' || url.hostname.endsWith('.konami.com') || url.hostname === 'efootball-web.konami.net')) return null;
    return url.href;
  } catch { return null; }
}

function externalLink(url, label) {
  const safe = safeUrl(url);
  return safe ? node('a', { href: safe, target: '_blank', rel: 'noopener noreferrer', class: 'external-link' }, label, node('span', { 'aria-hidden': 'true' }, ' ↗')) : node('span', {}, label);
}

function link(kind, entity, className = '') {
  return node('a', { href: `/${kind}/${encodeURIComponent(entity.id)}`, 'data-nav': '', class: className }, entity.name);
}

function badge(label, variant = '') { return node('span', { class: `badge ${variant}`.trim() }, label); }
function unknown() { return node('span', { class: 'unknown' }, '미확인'); }
function timestamp(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '관찰 시각 미확인' : `${dateTime.format(parsed)} (UTC+9)`;
}
function typeLabel(type) { return typeLabels[type.label.toLowerCase()] ?? type.label; }
function imageAsset(entity, kinds = ['card_image']) {
  return (entity.asset_ids ?? []).map(id => assets.get(id)).find(asset => asset && kinds.includes(asset.kind));
}

function picture(entity, { className = '', decorative = false, eager = false } = {}) {
  const asset = imageAsset(entity);
  const url = asset && safeUrl(asset.url, true);
  const frame = node('div', { class: `portrait ${className}`.trim() });
  const fallback = () => node('span', { class: 'image-fallback', 'aria-hidden': decorative ? 'true' : null }, node('span', { class: 'image-fallback-mark', 'aria-hidden': 'true' }, 'ef.'), decorative ? '' : '이미지 조회 불가');
  if (!url) frame.append(fallback());
  else {
    const image = node('img', { src: url, alt: decorative ? '' : `${entity.name} 선수 카드 이미지`, loading: eager ? 'eager' : 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    image.addEventListener('error', () => image.replaceWith(fallback()), { once: true });
    frame.append(image);
  }
  return frame;
}

function normalize(value) { return String(value).normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('ko-KR'); }
function matches(entity, query) { return normalize([entity.name, ...entity.external_ids.map(id => id.value)].join(' ')).includes(normalize(query)); }
function entriesOf(product, kind) { return product.entries.filter(entry => entry.kind === kind); }
function quantity(entries) { return entries.reduce((sum, entry) => sum + entry.quantity, 0); }
function productsFor(kind, id) { return data.products.filter(product => product.entries.some(entry => entry.kind === kind && entry.target_id === id)); }
function routeTab() {
  const first = location.pathname.split('/')[1];
  return tabs[first] ? first : tabs[new URL(location.href).searchParams.get('tab')] ? new URL(location.href).searchParams.get('tab') : 'products';
}

function sectionTitle(kicker, title, right) {
  return node('div', { class: 'section-heading' }, node('div', {}, node('span', { class: 'eyebrow' }, kicker), node('h2', {}, title)), right);
}

function coverage() {
  return node('aside', { class: 'coverage-strip', 'aria-label': '현재 공개 범위' },
    node('span', { class: 'coverage-label' }, node('span', { class: 'status-dot', 'aria-hidden': 'true' }), '조사 표본 공개'),
    node('p', {}, data.coverage.scope, ' 전체 수집 완료를 의미하지 않습니다.'),
    node('a', { href: '/#coverage', 'data-nav': '', class: 'text-link' }, '범위와 출처 보기 ', node('span', { 'aria-hidden': 'true' }, '↗')));
}

function intro() {
  const sample = data.cards.filter(card => imageAsset(card, ['card_image'])).slice(0, 3);
  return node('section', { class: 'intro' },
    node('div', { class: 'intro-copy' },
      node('span', { class: 'eyebrow' }, 'THE DETAILS BEHIND EVERY CARD'),
      node('h1', { id: 'page-title', tabindex: '-1' }, '한 장의 카드에서,', node('br'), node('span', {}, '그 카드가 담긴 명단까지.')),
      node('p', { class: 'intro-description' }, '선수팩의 구성과 선수 카드의 다른 버전을 연결합니다.', node('br', { class: 'desktop-break' }), ' 확인한 정보는 출처와 함께, 모르는 정보는 미확인으로 남깁니다.'),
      node('div', { class: 'intro-caption' }, node('span', { class: 'caption-rule', 'aria-hidden': 'true' }), '카드 · 상품 · 출처')),
    node('div', { class: 'intro-visual', 'aria-hidden': 'true' },
      node('div', { class: 'pitch-outline' }, node('span', { class: 'pitch-circle' })),
      node('span', { class: 'visual-coordinate' }, 'EF / ARCHIVE — 01'),
      node('div', { class: 'card-fan' }, sample.map((card, index) => node('div', { class: `fan-card fan-card-${index}` }, picture(card, { decorative: true, eager: true })))),
      node('span', { class: 'visual-caption' }, '발견하고, 비교하고, 연결하기.')));
}

function productTile(product) {
  const thumbnails = entriesOf(product, 'card').map(entry => cards.get(entry.target_id)).filter(Boolean).slice(0, 3);
  const target = `/${'products'}/${encodeURIComponent(product.id)}`;
  const priceSummary = product.price === null ? '가격 미확인' : product.price.amount !== undefined && product.price.amount !== null
    ? `${typeof product.price.amount === 'number' ? number.format(product.price.amount) : product.price.amount} ${product.price.currency ?? product.currency ?? '재화 미확인'}`
    : displayValue(product.price);
  return node('article', { class: 'product-tile' },
    node('a', { href: target, 'data-nav': '', class: 'product-art', tabindex: '-1', 'aria-hidden': 'true' },
      node('span', { class: 'art-label' }, 'PLAYER COLLECTION'),
      node('div', { class: 'pack-lineup' }, thumbnails.map(card => picture(card, { decorative: true }))),
      node('span', { class: 'art-count' }, `${number.format(quantity(entriesOf(product, 'card')))}명 확보`)),
    node('div', { class: 'product-body' },
      node('div', { class: 'badge-row' }, badge(kindLabels[product.kind] ?? '종류 미확인'), badge('전체 구성 미확인', 'muted')),
      node('h3', {}, link('products', product)),
      node('p', { class: 'product-subtitle' }, product.list_types.length ? product.list_types.join(' · ') : '명단 분류 미확인'),
      node('div', { class: 'product-meta' }, node('span', {}, '확보 선수 ', node('strong', {}, `${number.format(quantity(entriesOf(product, 'card')))}명`)), node('span', {}, priceSummary))));
}

function cardTile(card) {
  return node('article', { class: 'player-tile' },
    node('a', { href: `/cards/${encodeURIComponent(card.id)}`, 'data-nav': '', class: 'player-art', tabindex: '-1', 'aria-hidden': 'true' }, picture(card, { decorative: true })),
    node('div', { class: 'player-body' },
      node('div', { class: 'player-rating' }, node('span', {}, 'OVR'), card.overall.value === null ? unknown() : node('strong', {}, card.overall.value)),
      node('h3', {}, link('cards', card)),
      node('div', { class: 'badge-row compact' }, card.types.length ? card.types.map(type => badge(typeLabel(type))) : badge('분류 미확인', 'muted'))));
}

function catalog() {
  const url = new URL(location.href);
  const tab = routeTab();
  const query = url.searchParams.get('q') ?? '';
  const types = tab === 'products' ? [...new Set(data.products.map(product => product.kind).filter(Boolean))].map(value => ({ value, label: kindLabels[value] ?? value })) : tab === 'cards' ? [...new Set(data.cards.flatMap(card => card.types.map(typeLabel)))].sort().map(value => ({ value, label: value })) : [];
  const requestedType = url.searchParams.get('type') ?? '';
  const selectedType = types.some(type => type.value === requestedType) ? requestedType : '';
  const filtered = data[tab].filter(entity => matches(entity, query) && (!selectedType || (tab === 'products' ? entity.kind === selectedType : entity.types.some(type => typeLabel(type) === selectedType))));
  const search = node('input', { type: 'search', name: 'q', id: 'catalog-search', value: query, placeholder: tab === 'products' ? '상품 이름 또는 출처 ID로 검색' : '선수 이름 또는 카드 ID로 검색', autocomplete: 'off', maxlength: '200' });
  const form = node('form', { class: 'search-form', action: '/', method: 'get', 'data-search': '' },
    node('input', { type: 'hidden', name: 'tab', value: tab }), node('label', { for: 'catalog-search', class: 'visually-hidden' }, `${tabs[tab]} 검색`),
    node('div', { class: 'search-input-wrap' }, node('span', { class: 'search-icon', 'aria-hidden': 'true' }), search),
    node('button', { type: 'submit', class: 'button button-dark' }, '검색'));
  if (types.length) {
    const select = node('select', { name: 'type', id: 'catalog-type', 'aria-label': tab === 'products' ? '상품 종류 필터' : '카드 분류 필터' },
      node('option', { value: '' }, '모든 종류'), types.map(type => node('option', { value: type.value, selected: selectedType === type.value }, type.label)));
    select.addEventListener('change', () => form.requestSubmit());
    form.insertBefore(select, form.lastChild);
  }
  const title = tab === 'products' ? '선수팩에서 시작하는 탐색' : '한 선수, 여러 장의 기록';
  const layout = tab === 'products' ? 'product-grid' : 'player-grid';
  const renderTile = tab === 'products' ? productTile : cardTile;
  return node('section', { class: 'catalog-section', 'aria-label': '자료 검색' },
    sectionTitle('EXPLORE THE ARCHIVE', title, node('span', { class: 'section-counter' }, '01 — 03')),
    node('nav', { class: 'catalog-tabs', 'aria-label': '검색 대상' }, Object.entries(tabs).map(([key, label]) => node('a', { href: `/?tab=${key}`, 'data-nav': '', class: tab === key ? 'is-active' : '', 'aria-current': tab === key ? 'page' : null }, label, node('span', {}, number.format(data[key].length))))),
    form,
    node('div', { class: 'results-heading', role: 'status', 'aria-live': 'polite' }, node('p', {}, query ? `“${query}” 검색 결과 ` : '현재 확보한 자료 ', node('strong', {}, `${number.format(filtered.length)}건`)), node('span', {}, '출처에서 확인한 범위만 표시합니다.')),
    filtered.length ? node('div', { class: layout }, filtered.map(renderTile)) : node('div', { class: 'empty-state' }, node('span', { class: 'eyebrow' }, 'NO RESULTS'), node('h3', {}, '일치하는 자료가 없습니다.'), node('p', {}, '다른 이름으로 검색하거나 종류 필터를 바꿔 보세요. 아직 수집하지 않은 자료일 수도 있습니다.'), node('a', { href: `/?tab=${tab}`, 'data-nav': '', class: 'text-link' }, '검색 조건 초기화')));
}

function coverageDetails() {
  return node('section', { id: 'coverage', class: 'coverage-details' },
    sectionTitle('SCOPE & SOURCES', '확인한 범위, 남겨 둔 질문'),
    node('div', { class: 'coverage-columns' },
      node('div', {}, node('p', { class: 'coverage-description' }, '이 사이트는 출처를 검증하는 초기 자료 표본입니다. 공개된 카드 수가 선수팩의 전체 인원수와 같다는 뜻은 아닙니다.'),
        node('p', { class: 'service-scope-note' }, managerScopeNote), node('ul', { class: 'coverage-notes' }, [...new Set(data.coverage.notes)].map(note => node('li', {}, note)))),
      node('div', { class: 'source-card' }, node('span', { class: 'eyebrow' }, 'OBSERVED, NOT ASSUMED'),
        node('dl', { class: 'source-stats' }, node('div', {}, node('dt', {}, '사이트 확보 자료'), node('dd', {}, `상품 ${number.format(data.products.length)} · 카드 ${number.format(data.cards.length)}`)),
          node('div', {}, node('dt', {}, '출처 목록 관측 규모'), node('dd', {}, `상품 ${number.format(data.coverage.source_totals.products)} · 카드 ${number.format(data.coverage.source_totals.cards)}`)),
          node('div', {}, node('dt', {}, '표본 관찰 시각'), node('dd', {}, node('time', { datetime: data.observed_at }, timestamp(data.observed_at))))),
        node('p', { class: 'small-note' }, '출처 목록의 규모와 이 사이트의 수집 범위는 다릅니다. 자동 갱신 운영은 아직 검증하지 않았습니다.'), data.coverage.card_api_audit?.status === 'blocked' ? node('p', { class: 'small-note api-audit-note' }, '전체 카드 API 전수 검증은 접근 차단으로 미완료입니다.') : null,
        node('div', { class: 'source-links' }, data.sources.map(source => externalLink(source.url, source.name))))));
}

function breadcrumb(tab, name) {
  return node('nav', { class: 'breadcrumb', 'aria-label': '현재 위치' }, node('a', { href: '/', 'data-nav': '' }, '아카이브'), node('span', { 'aria-hidden': 'true' }, '/'), node('a', { href: `/?tab=${tab}`, 'data-nav': '' }, tabs[tab]), node('span', { 'aria-hidden': 'true' }, '/'), node('span', { 'aria-current': 'page' }, name));
}

function fact(label, value, hint) { return node('div', { class: 'fact' }, node('dt', {}, label), node('dd', {}, value === null || value === undefined ? unknown() : value), hint ? node('p', {}, hint) : null); }

function displayValue(value) {
  if (value === null || value === undefined) return '미확인';
  if (Array.isArray(value)) return value.length ? value.map(displayValue).join(' · ') : '확인된 항목 없음';
  if (typeof value === 'object') {
    const labels = { amount: '금액', price: '가격', currency: '재화', condition: '조건', conditions: '조건', count: '횟수', quantity: '수량', limit: '제한', name: '이름', label: '항목', start: '시작', end: '종료' };
    return Object.entries(value).map(([key, entry]) => `${labels[key] ?? key}: ${displayValue(entry)}`).join(' · ');
  }
  return String(value);
}

function evidence(entity) {
  const groups = new Map();
  for (const [field, observationId] of Object.entries(entity.provenance)) {
    if (!groups.has(observationId)) groups.set(observationId, []);
    groups.get(observationId).push(fieldLabels[field] ?? field);
  }
  const externalIds = entity.external_ids.map(id => node('div', { class: 'external-id' }, node('span', {}, `${id.source} · ${id.id_type}`), node('code', {}, id.value)));
  return node('section', { class: 'detail-section evidence-section' }, sectionTitle('SOURCE RECORD', '출처와 관찰 기록'),
    node('p', { class: 'section-description' }, '이 정보가 어디에서 확인되었는지 기록합니다. 관찰 이후 원본 정보는 달라질 수 있습니다.'),
    node('div', { class: 'evidence-list' }, [...groups].map(([id, fields]) => {
      const observation = observations.get(id);
      if (!observation) return node('p', { class: 'unknown' }, `${fields.join(' · ')}: 출처 기록 미확인`);
      const source = data.sources.find(item => item.id === observation.source_id);
      return node('article', { class: 'evidence-item' }, node('div', {}, node('h3', {}, fields.join(' · ')), externalLink(observation.url, source?.name ?? observation.source_id), node('time', { datetime: observation.observed_at }, timestamp(observation.observed_at))),
        observation.excerpt ? node('details', {}, node('summary', {}, '원문 근거'), node('p', {}, observation.excerpt)) : null);
    })), node('div', { class: 'external-ids' }, externalIds));
}

function productDetail(product) {
  const cardEntries = entriesOf(product, 'card');
  const otherEntries = entriesOf(product, 'other');
  const isBundle = product.kind === 'pack' || product.purchase_mode === 'bundle';
  return [breadcrumb('products', product.name), coverage(),
    node('section', { class: 'product-detail-heading' }, node('span', { class: 'eyebrow' }, 'PLAYER COLLECTION'), node('h1', { id: 'page-title', tabindex: '-1' }, product.name),
      node('div', { class: 'badge-row' }, badge(kindLabels[product.kind] ?? '상품 종류 미확인'), product.list_types.map(type => badge(type)), badge('전체 구성 미확인', 'muted'))),
    isBundle ? node('aside', { class: 'bundle-note' }, node('strong', {}, '일괄 지급형 팩'), node('p', {}, '구매 시 확인된 구성품을 일괄 지급하는 상품입니다. 세부 구성의 미확인 상태는 별도로 표시합니다. 코인으로 결제해도 향후 개봉 시뮬레이터 대상에서 제외합니다.')) : null,
    node('dl', { class: 'facts-grid' }, fact('확보한 선수 구성', `${number.format(quantity(cardEntries))}명`), fact('출처 표시 목록 수', product.source_listed_player_count === null ? null : `${number.format(product.source_listed_player_count)}명`, '전체 인원수와 다를 수 있습니다.'), fact('전체 선수 수', product.total_player_count === null ? null : `${number.format(product.total_player_count)}명`), fact('가격', product.price === null ? null : displayValue(product.price)), fact('사용 재화', product.currency), fact('구매 방식', ({ bundle: '구성품 일괄 지급', draw: '추첨' })[product.purchase_mode] ?? null)),
    node('aside', { class: 'composition-note' }, node('strong', {}, '아래 목록은 전체 구성이 아닐 수 있습니다.'), node('p', {}, '확보한 선수 카드만 표시합니다. 출처의 목록 수와 전체 선수 수를 동일하게 취급하지 않습니다.')),
    node('section', { class: 'detail-section' }, sectionTitle('COLLECTION', '확보한 선수 카드', node('span', { class: 'section-counter' }, `${number.format(quantity(cardEntries))} PLAYERS`)),
      cardEntries.length ? node('div', { class: 'player-grid' }, cardEntries.map(entry => cards.get(entry.target_id)).filter(Boolean).map(cardTile)) : node('p', { class: 'empty-message' }, '확인한 선수 카드 연결이 없습니다.')),
    node('section', { class: 'detail-section' }, sectionTitle('OTHER ITEMS & SERVICE SCOPE', '기타 구성과 지원 범위'),
      node('p', { class: 'service-scope-note' }, managerScopeNote),
      otherEntries.length ? node('ul', { class: 'item-list' }, otherEntries.map(entry => node('li', {}, `기타 구성품 · ${number.format(entry.quantity)}개`))) : node('p', { class: 'small-note' }, '기타 구성품은 미확인입니다.')),
    node('section', { class: 'detail-section' }, sectionTitle('TERMS & AVAILABILITY', '가격과 이용 조건'), node('dl', { class: 'terms-grid' },
      fact('개봉 옵션별 가격', product.opening_options === null ? null : displayValue(product.opening_options)), fact('개봉·구매 제한', product.limits === null ? null : displayValue(product.limits)), fact('이용 시작', product.availability.start ? timestamp(product.availability.start) : null), fact('이용 종료', product.availability.end ? timestamp(product.availability.end) : null), fact('이용 상태', ({ active: '이용 가능', ended: '이용 종료' })[product.availability.status] ?? null))), evidence(product)];
}

function relatedProducts(entity, kind) {
  const related = productsFor(kind, entity.id);
  return node('section', { class: 'detail-section' }, sectionTitle('IN THE COLLECTION', '포함 상품'), related.length ? node('div', { class: 'product-grid' }, related.map(productTile)) : node('p', { class: 'empty-message' }, '출처로 확인한 포함 상품 연결이 없습니다.'));
}

function cardDetail(card) {
  const otherVersions = card.other_version_ids.map(id => cards.get(id)).filter(Boolean);
  const asset = imageAsset(card);
  const composition = { combined: '카드 합성 이미지', separate: '분리 이미지 자산', unknown: '합성·분리 형태 미확인' }[asset?.composition] ?? '이미지 구성 미확인';
  return [breadcrumb('cards', card.name), coverage(),
    node('section', { class: 'entity-detail' }, node('div', { class: 'entity-portrait' }, picture(card, { eager: true }), composition ? node('span', { class: 'portrait-caption' }, composition) : null),
      node('div', { class: 'entity-copy' }, node('span', { class: 'eyebrow' }, 'PLAYER CARD'), node('h1', { id: 'page-title', tabindex: '-1' }, card.name), node('div', { class: 'badge-row' }, card.types.length ? card.types.map(type => badge(typeLabel(type))) : badge('카드 분류 미확인', 'muted')),
        node('div', { class: 'overall-block' }, node('span', {}, '출처 표시 종합 능력'), node('strong', {}, card.overall.value === null ? '—' : card.overall.value), node('p', {}, card.overall.conditions ?? '능력치 적용 조건은 미확인입니다.')),
        node('p', { class: 'entity-note' }, '같은 선수의 카드라도 출시 버전은 별도의 카드로 관리합니다. 복수 분류와 출처에서 확인한 버전 연결을 보존합니다.'))),
    node('section', { class: 'detail-section' }, sectionTitle('OTHER VERSIONS', '확인된 다른 버전'), otherVersions.length ? node('div', { class: 'player-grid' }, otherVersions.map(cardTile)) : node('p', { class: 'empty-message' }, '확인된 다른 버전 연결이 없습니다. 다른 버전이 없다는 뜻은 아닙니다.')),
    relatedProducts(card, 'card'), evidence(card)];
}

function missingPage() {
  return node('section', { class: 'state-panel' }, node('span', { class: 'eyebrow' }, 'RECORD NOT FOUND'), node('h1', { id: 'page-title', tabindex: '-1' }, '이 자료를 찾을 수 없습니다.'), node('p', {}, '주소를 확인하거나 현재 확보한 자료에서 다시 찾아보세요.'), node('a', { href: '/', 'data-nav': '', class: 'button button-dark' }, '아카이브로 돌아가기'));
}

function render({ focus = false } = {}) {
  if (!data) return;
  let path;
  try { path = location.pathname.split('/').filter(Boolean).map(decodeURIComponent); } catch { path = ['invalid']; }
  let content;
  let title = 'efsimulator · 선수팩과 카드 아카이브';
  if (path.length === 0 || (path.length === 1 && tabs[path[0]])) content = [intro(), coverage(), catalog(), coverageDetails()];
  else if (path.length === 2 && ['products', 'cards'].includes(path[0])) {
    const entity = ({ products, cards })[path[0]].get(path[1]);
    content = entity ? ({ products: productDetail, cards: cardDetail })[path[0]](entity) : missingPage();
    if (entity) title = `${entity.name} · efsimulator`;
  } else content = missingPage();
  app.replaceChildren(...[content].flat(Infinity));
  app.setAttribute('aria-busy', 'false');
  document.title = title;
  for (const anchor of document.querySelectorAll('.main-nav a')) {
    const active = anchor.dataset.tab === routeTab();
    anchor.classList.toggle('is-active', active);
    if (active) anchor.setAttribute('aria-current', 'page'); else anchor.removeAttribute('aria-current');
  }
  if (location.hash === '#coverage') document.querySelector('#coverage')?.scrollIntoView();
  else if (focus) { window.scrollTo({ top: 0, behavior: 'instant' }); document.querySelector('#page-title')?.focus({ preventScroll: true }); }
}

function navigate(url) { history.pushState({}, '', url); render({ focus: true }); }

document.addEventListener('click', event => {
  if (!(event.target instanceof Element) || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.target.closest('a[data-nav]');
  if (!anchor) return;
  const url = new URL(anchor.href, location.href);
  if (url.origin !== location.origin || anchor.target || anchor.hasAttribute('download')) return;
  event.preventDefault();
  navigate(url);
});

document.addEventListener('submit', event => {
  if (!(event.target instanceof HTMLFormElement) || !event.target.hasAttribute('data-search')) return;
  event.preventDefault();
  const form = new FormData(event.target);
  const url = new URL('/', location.origin);
  for (const key of ['tab', 'q', 'type']) {
    const value = String(form.get(key) ?? '').trim();
    if (value) url.searchParams.set(key, value);
  }
  navigate(url);
  document.querySelector('#catalog-search')?.focus({ preventScroll: true });
  document.querySelector('.catalog-section')?.scrollIntoView({ block: 'start' });
});

window.addEventListener('popstate', () => render());

async function load() {
  app.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('/data/catalog.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`catalog HTTP ${response.status}`);
    const received = await response.json();
    if (received.version !== 1 || !['cards', 'products', 'assets', 'observations', 'sources'].every(key => Array.isArray(received[key])) || !received.coverage) throw new Error('지원하지 않는 자료 형식');
    if (!Array.isArray(received.managers) || received.managers.length !== 0 || received.coverage.manager_support !== 'excluded_bulk_api_unavailable' || received.products.some(product => product.entries.some(entry => entry.kind === 'manager') || product.composition_status === 'complete')) throw new Error('지원 범위와 다른 자료');
    data = received;
    cards = new Map(data.cards.map(card => [card.id, card]));
    products = new Map(data.products.map(product => [product.id, product]));
    assets = new Map(data.assets.map(asset => [asset.id, asset]));
    observations = new Map(data.observations.map(observation => [observation.id, observation]));
    render();
  } catch {
    data = null;
    const retry = node('button', { class: 'button button-dark', type: 'button' }, '다시 불러오기');
    retry.addEventListener('click', () => { retry.disabled = true; retry.textContent = '불러오는 중…'; load(); });
    app.replaceChildren(node('section', { class: 'state-panel', role: 'alert' }, node('span', { class: 'eyebrow' }, 'COULD NOT LOAD'), node('h1', { id: 'page-title', tabindex: '-1' }, '자료를 불러오지 못했습니다.'), node('p', {}, '연결 상태를 확인한 뒤 다시 시도해 주세요. 빈 검색 결과와는 다른 조회 오류입니다.'), retry));
    app.setAttribute('aria-busy', 'false');
  }
}

load();
