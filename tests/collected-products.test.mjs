import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { addCollectedProducts } from '../scripts/collected-products.mjs';
import { validateCatalog } from '../scripts/catalog.mjs';

const typeMap = { 1: 'normal', 2: 'featured', 3: 'trending', 4: 'legend', 5: 'epic', 6: 'highlight', 7: 'bigtime', 8: 'showtime' };
const idFor = (kind, raw) => `${kind}_${createHash('sha256').update(`efhub:${kind}:${raw}`).digest('hex').slice(0, 24)}`;

function fixture() {
  const seed = JSON.parse(readFileSync(new URL('../data/catalog.seed.json', import.meta.url), 'utf8'));
  const collection = JSON.parse(readFileSync(new URL('../data/research/current-catalog-observations.json', import.meta.url), 'utf8'));
  collection.products = collection.products.slice(0, 1);
  const product = collection.products[0];
  collection.observations = collection.observations.filter(observation => [product.observation_id, product.list_observation_id].includes(observation.id));
  const typeObservationId = seed.observations.find(observation => observation.source_id === 'efhub' && observation.source_entity_kind === 'definition' && observation.source_entity_id === 'player_type_translation_keys').id;
  return { seed, collection, options: { typeMap, typeObservationId } };
}

function synchronizeProductPayload(collection) {
  const product = collection.products[0];
  const detail = collection.observations.find(observation => observation.id === product.observation_id).verified_fields;
  detail.players_payload = structuredClone(product.players_payload);
  detail.players_payload_count = product.players_payload.length;
  detail.source_listed_player_count = product.playerCount;
  const list = collection.observations.find(observation => observation.id === product.list_observation_id).verified_fields;
  list.packs.find(pack => pack.slug === product.slug).playerCount = product.playerCount;
}

test('실측 원본을 정규화하고 기존 ID·출처 총계와 전체 범위 표시를 보존한다', () => {
  const { seed, collection, options } = fixture();
  const before = JSON.stringify(seed);
  const merged = addCollectedProducts(seed, collection, options);
  validateCatalog(merged);
  assert.equal(JSON.stringify(seed), before);
  for (const entity of seed.cards) assert.ok(merged.cards.some(card => card.id === entity.id));
  for (const observation of seed.observations) assert.deepEqual(merged.observations.find(item => item.id === observation.id), observation);
  const raw = collection.products[0];
  const product = merged.products.find(item => item.id === idFor('product', raw.slug));
  assert.equal(product.entries.filter(entry => entry.kind === 'card').length, raw.players_payload.length);
  assert.equal(product.total_player_count, null);
  assert.equal(product.composition_status, 'partial');
  assert.equal(product.purchase_mode, null);
  assert.equal(merged.managers.length, 0);
  assert.equal(merged.products.some(item => item.entries.some(entry => entry.kind === 'manager')), false);
  assert.equal(merged.coverage.complete, false);
  assert.equal(merged.coverage.source_totals.cards, seed.coverage.source_totals.cards);
  assert.equal(merged.coverage.source_totals.products, collection.source_totals.products);
  assert.match(merged.coverage.scope, new RegExp(`상품 ${merged.products.length}개`));
  const rawCard = raw.players_payload[0];
  const card = merged.cards.find(item => item.id === idFor('card', rawCard.id));
  assert.equal(card.external_ids.find(item => item.source === 'efhub').value, rawCard.id);
  assert.equal(card.provenance.name, raw.observation_id);
  assert.equal(card.types[0].raw_value, String(rawCard.playerType));
});

test('같은 수집 자료를 다시 병합해도 관측·카드·관계가 중복되지 않는다', () => {
  const { seed, collection, options } = fixture();
  const once = addCollectedProducts(seed, collection, options);
  const twice = addCollectedProducts(once, collection, options);
  assert.deepEqual(twice, once);
});

test('숫자 카드 ID·실패 관측·잘못된 상세 참조·미확인 분류를 거부하며 원본 seed를 수정하지 않는다', () => {
  for (const corrupt of [
    collection => { collection.products[0].players_payload[0].id = 12345678901234568; synchronizeProductPayload(collection); },
    collection => { collection.observations[0].status = 403; },
    collection => { collection.products[0].observation_id = collection.products[0].list_observation_id; },
    collection => { collection.products[0].players_payload[0].playerType = 999; synchronizeProductPayload(collection); },
  ]) {
    const { seed, collection, options } = fixture();
    const before = JSON.stringify(seed);
    corrupt(collection);
    assert.throws(() => addCollectedProducts(seed, collection, options));
    assert.equal(JSON.stringify(seed), before);
  }
});

test('상품 구성 축소를 자동 union으로 숨기지 않고 거부한다', () => {
  const { seed, collection, options } = fixture();
  const baseline = addCollectedProducts(seed, collection, options);
  const before = JSON.stringify(baseline);
  collection.products[0].players_payload.pop();
  collection.products[0].playerCount--;
  synchronizeProductPayload(collection);
  assert.throws(() => addCollectedProducts(baseline, collection, options), /기존 상품 카드가 수집 결과에서 빠졌습니다/);
  assert.equal(JSON.stringify(baseline), before);
});

test('새 상품 요약이 이전 가격·다른 버전·능력 조건·복수 분류를 지우지 않는다', () => {
  const { seed, collection, options } = fixture();
  const baseline = addCollectedProducts(seed, collection, options);
  const raw = collection.products[0];
  const product = baseline.products.find(item => item.id === idFor('product', raw.slug));
  const card = baseline.cards.find(item => item.id === product.entries[0].target_id);
  const at = new Date(Date.parse(collection.observed_at) - 1000).toISOString();
  const observed = (id, kind, original) => ({ id, source_id: 'efhub', url: 'https://efhub.com/ko', source_entity_kind: kind, source_entity_id: original, observed_at: at, http_status: 200, excerpt: '독립 회귀 fixture: 이전에 확인한 조건과 관계' });
  baseline.observations.push(observed('test-prior-product', 'product', raw.slug), observed('test-prior-card', 'card', raw.players_payload[0].id));
  product.price = { amount: 750, currency: 'coin', condition: '확인된 회귀 표본 조건' };
  product.currency = 'coin';
  product.provenance.price = 'test-prior-product';
  product.provenance.currency = 'test-prior-product';
  card.overall = { value: 99, conditions: '회귀 표본의 레벨 조건' };
  card.provenance.overall = 'test-prior-card';
  const other = baseline.cards.find(item => item.id !== card.id);
  card.other_version_ids = [other.id];
  card.provenance.other_version_ids = 'test-prior-card';
  card.types = [{ label: 'Epic', raw_value: '5', source: 'efhub' }, { label: 'Big Time', raw_value: '7', source: 'efhub' }];
  card.provenance.types = 'test-prior-card';
  const merged = addCollectedProducts(baseline, collection, options);
  const afterProduct = merged.products.find(item => item.id === product.id);
  const afterCard = merged.cards.find(item => item.id === card.id);
  assert.deepEqual(afterProduct.price, product.price);
  assert.equal(afterProduct.provenance.price, 'test-prior-product');
  assert.deepEqual(afterCard.overall, card.overall);
  assert.equal(afterCard.provenance.overall, 'test-prior-card');
  assert.deepEqual(afterCard.other_version_ids, card.other_version_ids);
  assert.deepEqual(afterCard.types, card.types);
  assert.equal(afterCard.provenance.types, 'test-prior-card');
});

test('활성 감독 목록이나 감독 포함 관계는 몰래 유지·삭제하지 않고 범위 위반으로 거부한다', () => {
  const { seed, collection, options } = fixture();
  const withManagers = structuredClone(seed);
  withManagers.managers.push({ id: 'test-manager-out-of-scope' });
  const beforeManagers = JSON.stringify(withManagers);
  assert.throws(() => addCollectedProducts(withManagers, collection, options), /활성 감독 목록.*수집 범위에서 제외/);
  assert.equal(JSON.stringify(withManagers), beforeManagers);
  const withEntry = structuredClone(seed);
  withEntry.products[0].entries.push({ kind: 'manager', target_id: 'test-manager-out-of-scope', quantity: 1, observation_id: withEntry.products[0].entries[0].observation_id });
  const beforeEntry = JSON.stringify(withEntry);
  assert.throws(() => addCollectedProducts(withEntry, collection, options), /감독 포함 상품 구성.*지원 범위에서 제외/);
  assert.equal(JSON.stringify(withEntry), beforeEntry);
});

test('기존 관측 ID 충돌과 출처 총계 감소는 병합하지 않는다', () => {
  const { seed, collection, options } = fixture();
  const baseline = addCollectedProducts(seed, collection, options);
  const conflict = structuredClone(collection);
  conflict.observations[0].sha256 = '0'.repeat(64);
  assert.throws(() => addCollectedProducts(baseline, conflict, options), /기존 관측 ID/);
  const smaller = structuredClone(collection);
  smaller.source_totals.products--;
  assert.throws(() => addCollectedProducts(baseline, smaller, options), /목록 총계가 감소/);
});
