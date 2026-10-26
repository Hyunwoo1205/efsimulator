import { createHash } from 'node:crypto';
import { validateCatalog } from './catalog.mjs';
import { parsePackList } from './collect-efhub.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0 && value !== '$undefined';
const count = value => Number.isSafeInteger(value) && value >= 0;
const timestamp = value => text(value) && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const stable = value => JSON.stringify(value, (_key, item) => object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const idFor = (kind, raw) => `${kind}_${createHash('sha256').update(`efhub:${kind}:${raw}`).digest('hex').slice(0, 24)}`;
const labels = { normal: 'Normal', featured: 'Featured', trending: 'Trending', legend: 'Legend', epic: 'Epic', highlight: 'Highlight', bigtime: 'Big Time', showtime: 'Showtime' };
const labelFor = value => Object.hasOwn(labels, value) ? labels[value] : (Object.values(labels).includes(value) ? value : null);
const externalId = (kind, value) => [{ source: 'efhub', id_type: kind, value }];
const sameExternal = (entity, kind, value) => entity.external_ids.some(external => external.source === 'efhub' && external.id_type === kind && external.value === value);

/** Merge only the EFHub fields this bounded collector actually observed. */
export function addCollectedProducts(seed, collection, { typeMap, typeObservationId } = {}) {
  assert(!Array.isArray(seed?.managers) || seed.managers.length === 0, '활성 감독 목록은 일괄 상품 연결 근거가 없어 수집 범위에서 제외합니다.');
  assert(!Array.isArray(seed?.products) || !seed.products.some(product => Array.isArray(product.entries) && product.entries.some(entry => entry?.kind === 'manager')), '감독 포함 상품 구성은 현재 지원 범위에서 제외합니다. 기존 관계를 묵시적으로 유지하거나 삭제할 수 없습니다.');
  validateCatalog(seed);
  assert(object(collection) && collection.schema_version === 1 && timestamp(collection.observed_at), '수집 원본의 버전·관찰 시각이 올바르지 않습니다.');
  assert(object(collection.scope) && collection.scope.complete === false && text(collection.scope.description), '수집 범위는 설명과 complete:false를 가진 표본이어야 합니다.');
  assert(object(collection.source_totals) && count(collection.source_totals.products) && collection.source_totals.products > 0, '실제 EFHub 상품 목록 총계가 필요합니다.');
  assert(collection.source_totals.products >= (seed.coverage.source_totals.products ?? 0), 'EFHub 상품 목록 총계가 감소했습니다. 별도 재검증이 필요합니다.');
  assert(Array.isArray(collection.products) && collection.products.length > 0 && Array.isArray(collection.observations) && collection.observations.length > 0, '수집한 상품과 관측 배열이 필요합니다.');
  assert(object(typeMap) && Object.entries(typeMap).length > 0 && Object.entries(typeMap).every(([raw, value]) => /^\d+$/.test(raw) && labelFor(value)), '확인된 카드 분류 ID와 표시명 매핑이 필요합니다.');
  const definition = seed.observations.find(observation => observation.id === typeObservationId);
  assert(definition?.source_id === 'efhub' && definition.source_entity_kind === 'definition' && definition.source_entity_id === 'player_type_translation_keys' && definition.http_status === 200, '실제 EFHub 카드 분류 정의 관측이 필요합니다.');

  // All validation and merging happens on a private copy; failures never mutate seed.
  const result = structuredClone(seed);
  const observations = new Map(result.observations.map(observation => [observation.id, observation]));
  const rawObservations = new Map();
  for (const raw of collection.observations) {
    assert(object(raw) && text(raw.id) && !rawObservations.has(raw.id) && raw.status === 200 && timestamp(raw.observed_at) && /^[a-f0-9]{64}$/.test(raw.sha256), '원본 관측의 고유 ID·성공 HTTP·시각·응답 SHA256이 필요합니다.');
    let url;
    try { url = new URL(raw.url); } catch { throw new Error('EFHub 관측 URL이 올바르지 않습니다.'); }
    assert(url.origin === 'https://efhub.com' && !url.hash, '다른 출처의 관측을 EFHub 관측으로 바꿀 수 없습니다.');
    const fields = raw.verified_fields;
    assert(object(fields) && ['product_list', 'product'].includes(fields.source_entity_kind) && text(fields.source_entity_id) && Array.isArray(raw.excerpts), '상품 목록·상세의 원본 대상과 근거가 필요합니다.');
    if (fields.source_entity_kind === 'product_list') {
      assert(url.pathname === '/api/public/packs' && url.searchParams.get('search') === '', '관측된 정상 상품 목록 경로와 다릅니다.');
      const pagination = fields.pagination;
      assert(object(pagination) && Number(url.searchParams.get('page')) === pagination.page && Number(url.searchParams.get('limit')) === pagination.limit && fields.source_entity_id === `page=${pagination.page}&limit=${pagination.limit}`, '목록 관측의 페이지·원본 ID가 다릅니다.');
      parsePackList({ ...pagination, packs: fields.packs }, { page: pagination.page, limit: 30 });
      assert(pagination.total === collection.source_totals.products, '목록 관측과 수집 결과의 출처 총계가 다릅니다.');
    } else {
      assert(url.pathname === `/ko/packs/${encodeURIComponent(fields.source_entity_id)}` && !url.search, '관측된 상품 상세 경로와 원본 slug가 다릅니다.');
    }
    const excerpts = raw.excerpts.map(excerpt => object(excerpt) ? excerpt.text : '').filter(text).join('\n');
    const projected = {
      id: raw.id, source_id: 'efhub', url: raw.url,
      source_entity_kind: fields.source_entity_kind, source_entity_id: fields.source_entity_id,
      observed_at: raw.observed_at, excerpt: (excerpts || JSON.stringify(fields)).slice(0, 6000),
      http_status: raw.status, body_sha256: raw.sha256,
    };
    const existing = observations.get(projected.id);
    assert(!existing || stable(existing) === stable(projected), `기존 관측 ID를 다른 내용으로 재사용할 수 없습니다: ${projected.id}`);
    if (!existing) { result.observations.push(projected); observations.set(projected.id, projected); }
    rawObservations.set(raw.id, raw);
  }

  const freshField = (entity, field, observationId) => {
    const existing = observations.get(entity?.provenance?.[field]);
    return !existing || Date.parse(observations.get(observationId).observed_at) >= Date.parse(existing.observed_at);
  };
  const addOrReplace = (items, value) => {
    const index = items.findIndex(item => item.id === value.id);
    if (index === -1) items.push(value);
    else items[index] = value;
  };
  const productSlugs = new Set();
  for (const rawProduct of collection.products) {
    assert(object(rawProduct) && text(rawProduct.slug) && !/[\/\\?#\0]/.test(rawProduct.slug) && !['.', '..'].includes(rawProduct.slug) && !productSlugs.has(rawProduct.slug) && text(rawProduct.name) && /^\d{4}-\d{2}-\d{2}$/.test(rawProduct.date) && count(rawProduct.playerCount), '수집 상품의 고유 문자열 slug·이름·날짜·표시 카드 수가 필요합니다.');
    productSlugs.add(rawProduct.slug);
    const listRaw = rawObservations.get(rawProduct.list_observation_id);
    const detailRaw = rawObservations.get(rawProduct.observation_id);
    assert(listRaw?.verified_fields.source_entity_kind === 'product_list' && detailRaw?.verified_fields.source_entity_kind === 'product' && detailRaw.verified_fields.source_entity_id === rawProduct.slug, '해당 상품의 정확한 목록·상세 관측 참조가 필요합니다.');
    const listed = listRaw.verified_fields.packs.find(pack => pack.slug === rawProduct.slug);
    assert(listed && ['name', 'slug', 'date', 'playerCount'].every(field => listed[field] === rawProduct[field]), '수집 상품이 실제 목록 행과 일치하지 않습니다.');
    const details = detailRaw.verified_fields;
    assert(details.pack_source_id === rawProduct.slug && details.source_listed_player_count === rawProduct.playerCount && details.players_payload_count === rawProduct.playerCount && details.total_player_count === null && details.composition_scope === 'source_displayed_subset', '상품 상세의 표시 범위·원본 ID·구성 수 계약이 다릅니다.');
    assert(Array.isArray(rawProduct.players_payload) && rawProduct.players_payload.length === rawProduct.playerCount && stable(rawProduct.players_payload) === stable(details.players_payload), '상품 원본 카드 목록과 상세 관측 payload가 다릅니다.');
    const cardIds = new Set();
    const cardEntries = [];
    for (const raw of rawProduct.players_payload) {
      assert(object(raw) && typeof raw.id === 'string' && /^\d+$/.test(raw.id) && !cardIds.has(raw.id), '카드 ID는 중복 없는 원본 숫자 문자열이어야 합니다.');
      cardIds.add(raw.id);
      assert(text(raw.name) && count(raw.overallRating) && count(raw.playerType) && labelFor(typeMap[String(raw.playerType)]), `카드 이름·표시 능력·확인된 분류 매핑이 필요합니다: ${raw.id}`);
      let image;
      try { image = new URL(raw.imageUrl); } catch { throw new Error(`카드 이미지 URL이 올바르지 않습니다: ${raw.id}`); }
      assert(image.protocol === 'https:', `카드 이미지의 HTTPS 원본 주소가 필요합니다: ${raw.id}`);
      const id = idFor('card', raw.id);
      const existing = result.cards.find(card => sameExternal(card, 'card_id', raw.id));
      assert(!existing || existing.id === id, `기존 EFHub 카드의 내부 ID 계약이 다릅니다: ${raw.id}`);
      assert(!result.cards.some(card => card.id === id && !sameExternal(card, 'card_id', raw.id)), '내부 카드 ID가 다른 원본 대상과 충돌했습니다.');
      const assetId = idFor('asset', raw.imageUrl);
      const previousAsset = result.assets.find(asset => asset.id === assetId);
      assert(!previousAsset || (previousAsset.url === raw.imageUrl && previousAsset.kind === 'card_image'), '카드 이미지 ID가 다른 자산과 충돌했습니다.');
      // Composition was not re-observed by this collector; keep a verified asset intact.
      const previousAssetProof = observations.get(previousAsset?.observation_id);
      const currentAssetProof = observations.get(rawProduct.observation_id);
      if (!previousAsset || (previousAsset.composition === 'unknown' && (!previousAssetProof || Date.parse(currentAssetProof.observed_at) >= Date.parse(previousAssetProof.observed_at)))) addOrReplace(result.assets, { ...(previousAsset ?? {}), id: assetId, url: raw.imageUrl, kind: 'card_image', composition: 'unknown', observation_id: rawProduct.observation_id });
      const card = existing ? structuredClone(existing) : {
        id, external_ids: externalId('card_id', raw.id), person_id: null, name: raw.name,
        overall: { value: raw.overallRating, conditions: null }, types: [], asset_ids: [], other_version_ids: [], provenance: {},
      };
      if (freshField(existing, 'name', rawProduct.observation_id)) { card.name = raw.name; card.provenance.name = rawProduct.observation_id; }
      // A summary with no conditions cannot safely replace a value with known conditions.
      if (card.overall.conditions === null && freshField(existing, 'overall', rawProduct.observation_id)) {
        card.overall = { value: raw.overallRating, conditions: null };
        card.provenance.overall = rawProduct.observation_id;
      }
      // A single primary classification is not evidence that additional classes vanished.
      if (card.types.length <= 1 && freshField(existing, 'types', rawProduct.observation_id)) {
        card.types = [{ label: labelFor(typeMap[String(raw.playerType)]), raw_value: String(raw.playerType), source: 'efhub' }];
        card.provenance.types = rawProduct.observation_id;
        card.provenance.type_mapping = typeObservationId;
      }
      const priorImage = existing && (observations.get(existing.provenance.asset_ids) ?? observations.get(result.assets.find(asset => asset.id === existing.asset_ids[0])?.observation_id));
      if (!priorImage || Date.parse(currentAssetProof.observed_at) >= Date.parse(priorImage.observed_at)) {
        card.asset_ids = [assetId, ...card.asset_ids.filter(previous => previous !== assetId)];
        card.provenance.asset_ids = rawProduct.observation_id;
      }
      addOrReplace(result.cards, card);
      cardEntries.push({ kind: 'card', target_id: card.id, quantity: 1, observation_id: rawProduct.observation_id });
    }

    const id = idFor('product', rawProduct.slug);
    const existing = result.products.find(product => sameExternal(product, 'pack_slug', rawProduct.slug));
    assert(!existing || existing.id === id, `기존 EFHub 상품의 내부 ID 계약이 다릅니다: ${rawProduct.slug}`);
    assert(!result.products.some(product => product.id === id && !sameExternal(product, 'pack_slug', rawProduct.slug)), '내부 상품 ID가 다른 원본 대상과 충돌했습니다.');
    const currentIds = new Set(cardEntries.map(entry => entry.target_id));
    assert(!existing || existing.entries.filter(entry => entry.kind === 'card').every(entry => currentIds.has(entry.target_id)), `기존 상품 카드가 수집 결과에서 빠졌습니다: ${rawProduct.slug}`);
    const product = existing ? structuredClone(existing) : {
      id, external_ids: externalId('pack_slug', rawProduct.slug), name: rawProduct.name,
      kind: null, purchase_mode: null, list_types: [], source_listed_player_count: rawProduct.playerCount,
      total_player_count: null, composition_status: 'partial', entries: [],
      price: null, currency: null, opening_options: null, limits: null,
      availability: { start: null, end: null, status: 'unknown' }, provenance: {},
    };
    if (freshField(existing, 'name', rawProduct.list_observation_id)) { product.name = rawProduct.name; product.provenance.name = rawProduct.list_observation_id; }
    if (freshField(existing, 'source_listed_player_count', rawProduct.list_observation_id)) { product.source_listed_player_count = rawProduct.playerCount; product.provenance.source_listed_player_count = rawProduct.list_observation_id; }
    product.entries = [
      ...cardEntries.map(entry => {
        const before = existing?.entries.find(old => old.kind === 'card' && old.target_id === entry.target_id);
        // Quantity beyond presence was not collected; retain its prior specific proof.
        return before && before.quantity !== 1 ? structuredClone(before) : entry;
      }),
      ...(existing?.entries.filter(entry => entry.kind === 'other') ?? []),
    ];
    addOrReplace(result.products, product);
  }

  const times = [seed.observed_at, collection.observed_at, ...result.observations.map(observation => observation.observed_at)];
  result.observed_at = times.reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest);
  result.coverage.complete = false;
  result.coverage.scope = `출처 조사·수집 표본: 상품 ${result.products.length}개, 선수 카드 ${result.cards.length}개. 감독 구성은 수집 범위에서 제외합니다. 게임 전체 구성·현재 판매 여부·지속 갱신은 검증 전입니다.`;
  result.coverage.source_totals.products = collection.source_totals.products;
  result.coverage.notes = [...new Set([...result.coverage.notes, 'EFHub 상품 수집은 출처에 표시된 카드 목록의 표본이며 게임 전체 구성이나 판매 중 상태를 뜻하지 않습니다.', '감독 구성은 일괄 검증 가능한 상품 연결 출처를 확보하지 못해 수집 범위에서 제외합니다.', 'EFHub 카드 목록 총계는 이번 상품 수집에서 재조회하지 않은 이전 관측값입니다.', ...(Array.isArray(collection.limitations) ? collection.limitations.filter(text).map(note => `EFHub 수집 범위: ${note}`) : [])])];
  validateCatalog(result);
  return result;
}
