import { createHash } from 'node:crypto';
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addCollectedProducts } from './collected-products.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidence = JSON.parse(await readFile(resolve(root, 'data/research/source-observations.json'), 'utf8'));
const byId = new Map(evidence.observations.map((observation) => [observation.id, observation]));
const requireObservation = (id) => {
  const observation = byId.get(id);
  if (!observation || observation.status !== 200) throw new Error(`검증된 관측이 필요합니다: ${id}`);
  return {
    ...observation, research_id: id,
    id: internalId('obs', `${id}:${observation.url}:${observation.observed_at}:${observation.sha256}`),
  };
};
const internalId = (kind, raw) => `${kind}_${createHash('sha256').update(`efhub:${kind}:${raw}`).digest('hex').slice(0, 24)}`;
const externalId = (kind, value) => {
  if (typeof value !== 'string' || !value) throw new Error(`외부 ${kind} ID는 원본 문자열이어야 합니다.`);
  return [{ source: 'efhub', id_type: kind, value }];
};

const productObservation = requireObservation('efhub_magical_payload');
const cardObservation = requireObservation('efhub_player_payload');
// The same response explicitly lists other cards. Keep that list's scope
// distinct from the primary card so another card's ID is never its proof.
const versionsObservation = { ...cardObservation, id: internalId('obs', `other_versions:${cardObservation.id}`) };
const typeObservation = requireObservation('efhub_types_js');
const listObservation = requireObservation('efhub_packs_page1_metadata');
const cardListObservation = requireObservation('efhub_players_page2');
const slug = productObservation.verified_fields.pack_source_id;
const listing = listObservation.verified_fields.sample.find((item) => item.slug === slug);
if (!listing) throw new Error('실제 상품 목록에 표본 상품이 없습니다.');
const rawTypes = typeObservation.verified_fields.raw_player_type_translation_keys;
const typeLabels = { normal: 'Normal', featured: 'Featured', trending: 'Trending', legend: 'Legend', epic: 'Epic', highlight: 'Highlight', bigtime: 'Big Time', showtime: 'Showtime' };
const assets = [];
const makeCard = (raw, observation, otherVersions = []) => {
  const id = internalId('card', raw.id);
  if (typeof raw.name !== 'string' || !Number.isFinite(raw.overallRating) || !rawTypes[String(raw.playerType)]) {
    throw new Error(`카드 필수 원본 필드나 분류 근거가 없습니다: ${raw.id}`);
  }
  const assetId = internalId('asset', raw.imageUrl);
  assets.push({ id: assetId, url: raw.imageUrl, kind: 'card_image', composition: 'unknown', observation_id: observation.id });
  return {
    id, external_ids: externalId('card_id', raw.id), person_id: null, name: raw.name,
    overall: { value: raw.overallRating, conditions: null },
    types: [{ label: typeLabels[rawTypes[String(raw.playerType)]], raw_value: String(raw.playerType), source: 'efhub' }],
    asset_ids: [assetId], other_version_ids: otherVersions.map((value) => internalId('card', value)),
    provenance: { name: observation.id, overall: observation.id, types: observation.id, type_mapping: typeObservation.id, ...(otherVersions.length ? { other_version_ids: observation.id } : {}) },
  };
};
const productCards = productObservation.verified_fields.players_payload;
if (!Array.isArray(productCards) || productCards.length !== listing.playerCount) throw new Error('출처 목록의 표본 구성 수가 달라졌습니다. 재조사가 필요합니다.');
const detail = cardObservation.verified_fields;
const versions = detail.other_versions.map((card) => card.id);
const cards = [
  ...productCards.map((card) => makeCard(card, productObservation)),
  makeCard(detail.card, cardObservation, versions),
  ...detail.other_versions.map((card) => makeCard(card, versionsObservation, [detail.card.id])),
];
const chosenObservations = [productObservation, cardObservation, versionsObservation, typeObservation, listObservation, cardListObservation];
const entityKinds = {
  [productObservation.id]: ['product', slug],
  [cardObservation.id]: ['card', detail.card.id],
  [versionsObservation.id]: ['card_list', `other_versions:${detail.card.id}`],
  [typeObservation.id]: ['definition', 'player_type_translation_keys'],
  [listObservation.id]: ['product_list', 'page=1&limit=30'],
  [cardListObservation.id]: ['card_list', 'page=2&limit=24'],
};
let seed = {
  version: 1, observed_at: evidence.observed_at,
  coverage: {
    scope: `출처 조사 표본: 상품 1개, 선수 카드 ${cards.length}개. 상품 감독 정보는 서비스 지원 범위에서 제외했습니다. 전체 수집·판매 중 여부·지속 갱신은 검증 전입니다.`,
    complete: false,
    manager_support: 'excluded_bulk_api_unavailable',
    notes: [
      'EFHub 목록 총계는 출처가 보고한 규모이며, 이 사이트가 확보한 수량이 아닙니다.',
      '상품 페이지의 11개 카드는 확보한 출처 목록입니다. 게임의 전체 구성 수는 미확인입니다.',
      '공식 동명 상품의 150명과 EFHub 상품은 명시적인 ID 연결이 없어 병합하지 않았습니다.',
      '가격·재화·개봉 옵션·이용 제한·판매 기간은 상품별 미확인입니다.',
      '감독 포함 정보를 일괄 조회하는 API를 확보하지 못해 모든 상품의 감독 정보와 독립 감독 목록을 지원 범위에서 제외했습니다. 실제 상품에 감독이 없다는 뜻이 아닙니다.',
      '일괄 지급형 팩은 DB·검색에 포함하지만 코인 결제여도 미래 개봉 시뮬레이터 대상에서 제외합니다.',
      '종합 능력은 관측한 표시값입니다. 레벨·부스터 등 적용 조건은 미확인입니다.',
      '이미지 URL은 출처에서 제공한 그대로 사용합니다. 배경/선수 자산의 분리 여부와 모든 이미지의 응답은 미검증입니다.',
      '선수의 내부 실인물 식별은 미확정이며, 다른 버전은 상세 페이지의 명시적인 링크만 연결했습니다.',
    ],
    source_totals: { products: listObservation.verified_fields.pagination.total, cards: cardListObservation.verified_fields.pagination.total },
  },
  sources: [{ id: 'efhub', name: 'EFHub', url: 'https://efhub.com/ko' }],
  observations: chosenObservations.map((observation) => ({
    id: observation.id, research_id: observation.research_id, source_id: 'efhub', url: observation.url,
    source_entity_kind: entityKinds[observation.id][0], source_entity_id: entityKinds[observation.id][1],
    observed_at: observation.observed_at,
    excerpt: observation.excerpts.map((excerpt) => excerpt.text || '').filter(Boolean).join('\n').slice(0, 6000) || JSON.stringify(observation.verified_fields).slice(0, 6000),
    http_status: observation.status, body_sha256: observation.sha256,
  })),
  persons: [], assets, cards,
  managers: [],
  products: [{
    id: internalId('product', slug), external_ids: externalId('pack_slug', slug), name: listing.name,
    kind: null, purchase_mode: null, list_types: [], source_listed_player_count: listing.playerCount, total_player_count: null,
    composition_status: 'partial',
    entries: productCards.map((card) => ({ kind: 'card', target_id: internalId('card', card.id), quantity: 1, observation_id: productObservation.id })),
    price: null, currency: null, opening_options: null, limits: null,
    availability: { start: null, end: null, status: 'unknown' },
    provenance: { name: listObservation.id, source_listed_player_count: listObservation.id },
  }],
};

// A changed research payload must pass the same contract as a published snapshot.
let collection;
try { collection = JSON.parse(await readFile(resolve(root, 'data/research/current-catalog-observations.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (collection) seed = addCollectedProducts(seed, collection, { typeMap: rawTypes, typeObservationId: typeObservation.id });
let cardAudit;
try { cardAudit = JSON.parse(await readFile(resolve(root, 'data/research/card-api-audit.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (cardAudit) {
  seed.coverage.card_api_audit = { status: cardAudit.status, complete: cardAudit.complete, pages_visited: cardAudit.pages.visited_count, unique_cards: cardAudit.cards.unique_ids_count, observed_at: cardAudit.observed_range.ended_at };
  if (!cardAudit.complete) seed.coverage.notes.push('전체 카드 API 전수 검증은 완료되지 않았습니다. 출처가 보고한 약 5만 카드 총계는 이 사이트의 확보 수량이나 서로 다른 실존 선수 수가 아닙니다.');
}
const { validateCatalog } = await import('./catalog.mjs');
validateCatalog(seed);
const target = resolve(root, 'data/catalog.seed.json');
await mkdir(dirname(target), { recursive: true });
await writeFile(`${target}.tmp`, `${JSON.stringify(seed, null, 2)}\n`);
await rename(`${target}.tmp`, target);
process.stdout.write(`검증된 조사 표본 준비: 상품 ${seed.products.length}개, 카드 ${seed.cards.length}개. 감독은 지원 범위 제외. 전체 수집 완료 아님.\n`);
