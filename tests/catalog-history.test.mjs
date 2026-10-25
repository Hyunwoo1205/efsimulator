import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCatalog } from '../scripts/catalog.mjs';
import { mergeCatalogHistory } from '../scripts/catalog-history.mjs';

const firstAt = '2026-10-25T03:00:00Z';
const nextAt = '2026-10-26T03:00:00Z';
const external = (kind, value) => [{ source: 'efhub', id_type: kind, value }];
const observation = (id, kind, original, at = firstAt) => ({ id, source_id: 'efhub', source_entity_kind: kind, source_entity_id: original, observed_at: at, url: `https://efhub.com/ko/${kind}/${original}`, http_status: 200, excerpt: '누적 카탈로그 보존을 검증하는 독립 회귀 표본' });

function snapshot() {
  const rawIds = ['00012345678901234567890', '00012345678901234567891'];
  const cards = rawIds.map((raw, index) => ({
    id: `card-${index + 1}`, external_ids: external('card_id', raw), person_id: null,
    name: `확인한 선수 ${index + 1}`, overall: { value: 86 + index, conditions: null },
    types: [{ label: 'Epic', raw_value: '5', source: 'efhub' }, { label: 'Big Time', raw_value: '7', source: 'efhub' }],
    asset_ids: [], other_version_ids: [`card-${index === 0 ? 2 : 1}`],
    provenance: { name: `o-card-${index + 1}`, overall: `o-card-${index + 1}`, types: `o-card-${index + 1}`, other_version_ids: `o-card-${index + 1}` },
  }));
  const value = {
    version: 1, observed_at: firstAt,
    coverage: { scope: '이전에 확보한 표본', complete: false, manager_support: 'excluded_bulk_api_unavailable', notes: ['실제 상품의 감독 여부는 미확인이며 지원 범위에서 제외'], source_totals: { products: 100, cards: 100 } },
    sources: [{ id: 'efhub', name: 'EFHub', url: 'https://efhub.com' }],
    observations: [observation('o-card-1', 'card', rawIds[0]), observation('o-card-2', 'card', rawIds[1]), observation('o-product-1', 'product', 'pack-01')],
    persons: [], assets: [], cards, managers: [],
    products: [{
      id: 'product-1', external_ids: external('pack_slug', 'pack-01'), name: '이전에 확인한 팩',
      kind: 'pack', purchase_mode: 'bundle', list_types: [], source_listed_player_count: 2,
      total_player_count: null, composition_status: 'partial',
      entries: cards.map(card => ({ kind: 'card', target_id: card.id, quantity: 1, observation_id: 'o-product-1' })),
      price: { amount: 750, currency: 'eFootball 코인', conditions: '확인된 표본의 구매 조건' },
      currency: 'eFootball 코인', opening_options: null, limits: { purchases: 1, conditions: '확인된 표본의 이용 조건' },
      availability: { start: null, end: null, status: 'unknown' },
      provenance: { name: 'o-product-1', kind: 'o-product-1', purchase_mode: 'o-product-1', source_listed_player_count: 'o-product-1', price: 'o-product-1', currency: 'o-product-1', limits: 'o-product-1' },
    }],
  };
  validateCatalog(value);
  return value;
}

function newWindow() {
  const value = snapshot();
  const raw = '00090071992547409931234999';
  value.observed_at = nextAt;
  value.observations = [observation('o-card-new', 'card', raw, nextAt), observation('o-product-new', 'product', 'new-window-pack', nextAt)];
  value.cards = [{ ...value.cards[0], id: 'card-new', external_ids: external('card_id', raw), name: '새 창의 선수', other_version_ids: [], provenance: { name: 'o-card-new', overall: 'o-card-new', types: 'o-card-new' } }];
  value.products = [{ ...value.products[0], id: 'product-new', external_ids: external('pack_slug', 'new-window-pack'), name: '새 창의 상품', kind: null, purchase_mode: null, source_listed_player_count: 1, price: null, currency: null, limits: null, entries: [{ kind: 'card', target_id: 'card-new', quantity: 1, observation_id: 'o-product-new' }], provenance: { name: 'o-product-new', source_listed_player_count: 'o-product-new' } }];
  validateCatalog(value);
  return value;
}

test('새 입력 창 밖으로 이동한 상품·카드·관측·확인한 조건을 누적 기준에서 보존한다', () => {
  const canonical = snapshot();
  const incoming = newWindow();
  const before = structuredClone(canonical);
  const inputBefore = structuredClone(incoming);
  const merged = mergeCatalogHistory(canonical, incoming);
  validateCatalog(merged);
  assert.deepEqual(canonical, before);
  assert.deepEqual(incoming, inputBefore);
  assert.deepEqual(merged.products.find(product => product.id === 'product-1'), canonical.products[0]);
  for (const card of canonical.cards) assert.deepEqual(merged.cards.find(item => item.id === card.id), card);
  for (const observed of canonical.observations) assert.deepEqual(merged.observations.find(item => item.id === observed.id), observed);
  assert.equal(merged.products.length, 2);
  assert.equal(merged.cards.length, 3);
  assert.equal(merged.coverage.complete, false);
  assert.match(merged.coverage.scope, /상품 2개, 선수 카드 3개/, '범위 설명도 현재 창이 아닌 누적 확보 수량을 사용한다');
});

test('동일한 관측 입력의 재적용은 멱등이며 기존에 알려진 오래된 bootstrap은 최신 필드를 바꾸지 않는다', () => {
  const previous = snapshot();
  const incoming = structuredClone(previous);
  incoming.observed_at = nextAt;
  incoming.observations.push(observation('o-card-updated', 'card', incoming.cards[0].external_ids[0].value, nextAt));
  incoming.cards[0].name = '더 새롭게 확인한 선수 이름';
  incoming.cards[0].provenance.name = 'o-card-updated';
  const updated = mergeCatalogHistory(previous, incoming);
  assert.equal(updated.cards[0].name, incoming.cards[0].name);
  assert.equal(updated.cards[0].provenance.name, 'o-card-updated');
  assert.deepEqual(mergeCatalogHistory(updated, incoming), updated);
  assert.deepEqual(mergeCatalogHistory(updated, previous), updated);
});

test('미확인 optional 값과 빈 분류·버전 배열은 기존 근거와 확인값을 지우지 않는다', () => {
  const canonical = snapshot();
  canonical.cards[0].overall.conditions = '출처가 확인한 레벨 조건';
  const incoming = structuredClone(canonical);
  Object.assign(incoming.products[0], { kind: null, purchase_mode: null, price: null, currency: null, limits: null });
  incoming.cards[0].overall = { value: null, conditions: null };
  incoming.cards[0].types = [];
  incoming.cards[0].other_version_ids = [];
  const merged = mergeCatalogHistory(canonical, incoming);
  for (const field of ['kind', 'purchase_mode', 'price', 'currency', 'limits']) assert.deepEqual(merged.products[0][field], canonical.products[0][field]);
  for (const field of ['overall', 'types', 'other_version_ids']) assert.deepEqual(merged.cards[0][field], canonical.cards[0][field]);
  assert.equal(merged.cards[0].provenance.overall, canonical.cards[0].provenance.overall);
});

test('bootstrap의 미확인 이미지와 부족한 자산 목록은 확인한 합성 형태·다중 이미지·근거를 되돌리지 않는다', () => {
  const canonical = snapshot();
  canonical.observations.push(observation('o-image-confirmed', 'card', canonical.cards[0].external_ids[0].value, nextAt));
  canonical.assets = [
    { id: 'asset-confirmed', url: 'https://efimg.com/confirmed-card.png', kind: 'card_image', composition: 'combined', observation_id: 'o-image-confirmed' },
    { id: 'asset-additional', url: 'https://efimg.com/additional-card.png', kind: 'card_image', composition: 'separate', observation_id: 'o-image-confirmed' },
  ];
  canonical.cards[0].asset_ids = ['asset-confirmed', 'asset-additional'];
  canonical.cards[0].provenance.asset_ids = 'o-image-confirmed';
  const incoming = structuredClone(canonical);
  incoming.assets = [{ ...incoming.assets[0], composition: 'unknown', observation_id: 'o-card-1' }];
  incoming.cards[0].asset_ids = ['asset-confirmed'];
  incoming.cards[0].provenance.asset_ids = 'o-card-1';
  validateCatalog(canonical);
  validateCatalog(incoming);
  const merged = mergeCatalogHistory(canonical, incoming);
  assert.deepEqual(merged.assets, canonical.assets);
  assert.deepEqual(merged.cards[0].asset_ids, canonical.cards[0].asset_ids);
  assert.equal(merged.cards[0].provenance.asset_ids, 'o-image-confirmed');
  assert.deepEqual(merged.observations.find(item => item.id === 'o-image-confirmed'), canonical.observations.find(item => item.id === 'o-image-confirmed'));
});

test('새 수치의 적용 조건이 미확인이면 이전의 확인된 능력치·조건 쌍과 근거를 통째로 보존한다', () => {
  const canonical = snapshot();
  canonical.cards[0].overall = { value: 86, conditions: '레벨 30 적용 조건' };
  const incoming = structuredClone(canonical);
  const newObservation = { ...observation('o-overall-without-conditions', 'card', canonical.cards[0].external_ids[0].value, nextAt), excerpt: '표시 능력 99를 관측했지만 적용 조건은 미확인인 독립 회귀 표본' };
  incoming.observations.push(newObservation);
  incoming.cards[0].overall = { value: 99, conditions: null };
  incoming.cards[0].provenance.overall = newObservation.id;
  const inputBefore = structuredClone(incoming);
  const merged = mergeCatalogHistory(canonical, incoming);
  assert.deepEqual(merged.cards[0].overall, canonical.cards[0].overall);
  assert.equal(merged.cards[0].provenance.overall, canonical.cards[0].provenance.overall);
  assert.deepEqual(merged.observations.find(item => item.id === newObservation.id), newObservation, '새 관측 자체는 잃지 않는다');
  assert.deepEqual(incoming, inputBefore);
});

test('같은 관측 ID에 다른 원문을 넣거나 같은 내부 ID의 원본 식별자를 바꾸면 거부한다', () => {
  const canonical = snapshot();
  const changedObservation = structuredClone(canonical);
  changedObservation.observations[0].excerpt = '기존 관측 ID의 원문 바꿔치기';
  assert.throws(() => mergeCatalogHistory(canonical, changedObservation));
  const changedIdentity = structuredClone(canonical);
  const raw = '00099999999999999999999';
  changedIdentity.cards[0].external_ids[0].value = raw;
  changedIdentity.observations.push(observation('o-new-identity', 'card', raw, nextAt));
  for (const field of Object.keys(changedIdentity.cards[0].provenance)) changedIdentity.cards[0].provenance[field] = 'o-new-identity';
  validateCatalog(changedIdentity);
  assert.throws(() => mergeCatalogHistory(canonical, changedIdentity));
});

test('새로 제출한 과거 관측으로 더 최신 필드를 교체하려는 시도는 입력을 변경하지 않고 거부한다', () => {
  const canonical = snapshot();
  const incoming = structuredClone(canonical);
  incoming.observations.push(observation('o-backdated-new', 'card', incoming.cards[0].external_ids[0].value, '2026-10-24T03:00:00Z'));
  incoming.cards[0].name = '뒤늦게 제출한 과거 값';
  incoming.cards[0].provenance.name = 'o-backdated-new';
  const before = structuredClone(canonical);
  const inputBefore = structuredClone(incoming);
  assert.throws(() => mergeCatalogHistory(canonical, incoming));
  assert.deepEqual(canonical, before);
  assert.deepEqual(incoming, inputBefore);
});

test('같은 상품의 최신 구성에서 사라진 카드를 union으로 숨기지 않고 거부한다', () => {
  const canonical = snapshot();
  const incoming = structuredClone(canonical);
  incoming.observations.push(observation('o-product-shrunk', 'product', 'pack-01', nextAt));
  incoming.products[0].entries = [{ kind: 'card', target_id: 'card-1', quantity: 1, observation_id: 'o-product-shrunk' }];
  incoming.products[0].source_listed_player_count = 1;
  incoming.products[0].provenance.source_listed_player_count = 'o-product-shrunk';
  validateCatalog(incoming);
  const before = structuredClone(canonical);
  assert.throws(() => mergeCatalogHistory(canonical, incoming));
  assert.deepEqual(canonical, before);
});

test('숫자 외부 ID와 감독 범위 침범은 보존 병합에서도 받아들이지 않는다', () => {
  const canonical = snapshot();
  const numeric = structuredClone(canonical);
  numeric.cards[0].external_ids[0].value = 12345678901234568;
  assert.throws(() => mergeCatalogHistory(canonical, numeric));
  const manager = structuredClone(canonical);
  manager.observations.push(observation('o-manager', 'manager', 'manager-01'));
  manager.managers.push({ id: 'manager-01', external_ids: external('manager_id', 'manager-01'), name: '범위 밖 감독', asset_ids: [], provenance: { name: 'o-manager' } });
  assert.throws(() => mergeCatalogHistory(canonical, manager));
});
