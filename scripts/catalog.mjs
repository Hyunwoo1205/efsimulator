import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const groups = ['persons', 'cards', 'managers', 'products', 'other_items'];
const kinds = { persons: 'person', cards: 'card', managers: 'manager', products: 'product', other_items: 'other' };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const timestamp = value => text(value) && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const url = value => { try { return new URL(value).protocol === 'https:'; } catch { return false; } };
const count = value => Number.isSafeInteger(value) && value >= 0;
const stable = value => JSON.stringify(value, (_key, item) => object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');

export class CatalogValidationError extends Error {
  constructor(errors) { super(`카탈로그 검증 실패:\n${errors.map(error => `- ${error}`).join('\n')}`); this.name = 'CatalogValidationError'; this.errors = errors; }
}

/** Validate source-backed data without filling unknown values or merging identities. */
export function validateCatalog(seed) {
  const errors = [];
  const fail = message => errors.push(message);
  if (!object(seed) || seed.version !== 1) throw new CatalogValidationError(['version: 1인 카탈로그 객체가 필요합니다.']);
  if (!timestamp(seed.observed_at)) fail('observed_at에 시간대가 포함된 관찰 시각이 필요합니다.');
  if (!object(seed.coverage) || !text(seed.coverage.scope) || typeof seed.coverage.complete !== 'boolean' || !Array.isArray(seed.coverage.notes) || !seed.coverage.notes.every(text)) fail('coverage의 범위·완전성·메모가 필요합니다.');
  if (!object(seed.coverage?.source_totals) || !Object.values(seed.coverage.source_totals).every(count)) fail('coverage.source_totals는 확인된 비음수 정수만 허용합니다.');
  for (const key of ['sources', 'observations', 'assets', 'persons', 'cards', 'managers', 'products']) if (!Array.isArray(seed[key])) fail(`${key} 배열이 필요합니다.`);
  if (seed.other_items !== undefined && !Array.isArray(seed.other_items)) fail('other_items는 배열이어야 합니다.');
  if (errors.length) throw new CatalogValidationError(errors);
  if (seed.managers.length !== 0) fail('감독은 서비스 지원 범위에서 제외되었습니다.');
  if (seed.coverage.complete && (seed.cards.length !== seed.coverage.source_totals.cards || seed.products.length !== seed.coverage.source_totals.products)) fail('전체 수집 표시는 출처 목록 총계와 확보 카드·상품 수가 일치해야 합니다.');
  const indexed = (items, label) => {
    const result = new Map();
    for (const item of items) {
      if (!object(item) || !text(item.id)) { fail(`${label}: 내부 문자열 ID가 필요합니다.`); continue; }
      if (result.has(item.id)) fail(`${label}: 중복 ID ${item.id}`);
      result.set(item.id, item);
    }
    return result;
  };
  const sources = indexed(seed.sources, 'sources');
  const observations = indexed(seed.observations, 'observations');
  const assets = indexed(seed.assets, 'assets');
  const byGroup = Object.fromEntries(groups.map(group => [group, indexed(seed[group] ?? [], group)]));
  const all = new Map();
  for (const group of groups) for (const [id, entity] of byGroup[group]) {
    if (all.has(id)) fail(`종류가 다른 대상에 같은 내부 ID를 사용할 수 없습니다: ${id}`);
    all.set(id, { kind: kinds[group], entity });
  }
  for (const source of sources.values()) if (!text(source.name) || !url(source.url)) fail(`${source.id}: 출처 이름과 HTTPS 주소가 필요합니다.`);
  for (const observation of observations.values()) {
    if (!sources.has(observation.source_id)) fail(`${observation.id}: 존재하지 않는 출처입니다.`);
    if (!url(observation.url) || !timestamp(observation.observed_at) || !text(observation.source_entity_kind) || !text(observation.source_entity_id) || !text(observation.excerpt)) fail(`${observation.id}: 원본 URL·문자열 ID·대상 종류·관찰 시각·근거가 필요합니다.`);
    if (!Number.isInteger(observation.http_status) || observation.http_status < 100 || observation.http_status > 599) fail(`${observation.id}: HTTP 상태가 올바르지 않습니다.`);
    if (observation.body_sha256 !== undefined && !/^[a-f0-9]{64}$/.test(observation.body_sha256)) fail(`${observation.id}: body_sha256이 올바르지 않습니다.`);
  }
  const support = (id, label, entity) => {
    const observation = observations.get(id);
    if (!observation) { fail(`${label}: 존재하지 않는 관측 ${String(id)}`); return; }
    if (observation.http_status < 200 || observation.http_status >= 300) fail(`${label}: 실패한 HTTP 관측을 확인된 값의 근거로 사용할 수 없습니다.`);
    if (entity && !(Array.isArray(entity.external_ids) && entity.external_ids.some(external => object(external) && external.source === observation.source_id))) fail(`${label}: 대상의 외부 ID와 다른 출처의 근거입니다.`);
    return observation;
  };
  for (const asset of assets.values()) {
    if (!url(asset.url) || !['card_image', 'manager_image', 'background', 'product_screenshot'].includes(asset.kind) || !['unknown', 'combined', 'separate'].includes(asset.composition)) fail(`${asset.id}: 이미지 주소·종류·합성/분리 상태가 올바르지 않습니다.`);
    support(asset.observation_id, asset.id);
  }
  const externalKeys = new Map();
  const requireProof = (entity, field, value, kind) => {
    if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) return;
    const proof = support(entity.provenance?.[field], `${entity.id}.${field}`, entity);
    if (!proof) return;
    const permitted = { card: ['card', 'card_list', 'product', 'product_list'], manager: ['manager', 'manager_list', 'product'], product: ['product', 'product_list'], person: ['person', 'card'], other: ['other', 'product'] };
    if (!permitted[kind].includes(proof.source_entity_kind)) fail(`${entity.id}.${field}: ${kind} 값에 맞지 않는 관측 대상 종류입니다.`);
    if (proof.source_entity_kind === kind && !(Array.isArray(entity.external_ids) && entity.external_ids.some(external => object(external) && external.source === proof.source_id && external.value === proof.source_entity_id))) fail(`${entity.id}.${field}: 다른 원본 대상 ID의 근거입니다.`);
  };
  const requireProductProof = (entity, field, observationId) => {
    const proof = support(observationId, `${entity.id}.${field}`, entity);
    if (proof && (proof.source_entity_kind !== 'product' || !(Array.isArray(entity.external_ids) && entity.external_ids.some(external => object(external) && external.source === proof.source_id && external.value === proof.source_entity_id)))) fail(`${entity.id}.${field}: 해당 상품 상세의 정확한 출처·원본 ID를 가진 근거가 필요합니다.`);
  };
  const stringList = (items, map, label) => {
    if (!Array.isArray(items) || !items.every(id => text(id) && map.has(id)) || new Set(items).size !== items.length) fail(`${label}: 중복 없이 존재하는 대상 ID 배열이 필요합니다.`);
  };
  for (const group of groups) for (const entity of byGroup[group].values()) {
    const kind = kinds[group];
    if (!Array.isArray(entity.external_ids) || entity.external_ids.length === 0) fail(`${entity.id}: 원본 문자열 외부 ID가 필요합니다.`);
    else for (const external of entity.external_ids) {
      if (!object(external) || !sources.has(external.source) || !text(external.id_type) || !text(external.value)) { fail(`${entity.id}: 출처·ID 종류·원본 문자열 외부 ID가 필요합니다.`); continue; }
      const key = stable([kind, external.source, external.id_type, external.value]);
      if (externalKeys.has(key)) fail(`${entity.id}: 외부 ID가 다른 대상 또는 같은 대상에 중복됩니다.`);
      externalKeys.set(key, entity.id);
    }
    if (!text(entity.name)) fail(`${entity.id}: 이름이 필요합니다.`);
    if (!object(entity.provenance)) fail(`${entity.id}: 필드별 provenance가 필요합니다.`);
    else for (const [field, observation] of Object.entries(entity.provenance)) support(observation, `${entity.id}.${field}`, entity);
    requireProof(entity, 'name', entity.name, kind);
    if (group === 'cards' || group === 'managers' || entity.asset_ids !== undefined) stringList(entity.asset_ids, assets, `${entity.id}.asset_ids`);
    if (group === 'cards') {
      if (entity.person_id !== null && !byGroup.persons.has(entity.person_id)) fail(`${entity.id}: person_id는 확인된 선수 ID 또는 null이어야 합니다.`);
      if (!object(entity.overall) || !(entity.overall.value === null || count(entity.overall.value)) || !(entity.overall.conditions === null || text(entity.overall.conditions))) fail(`${entity.id}: 표시 종합 능력과 조건은 확인값 또는 null이어야 합니다.`);
      else if (entity.overall.value !== null || entity.overall.conditions !== null) requireProof(entity, 'overall', entity.overall, kind);
      if (!Array.isArray(entity.types)) fail(`${entity.id}: 복수 분류 배열이 필요합니다.`);
      else {
        const seen = new Set();
        for (const type of entity.types) {
          if (!object(type) || !text(type.label) || !text(type.raw_value) || !sources.has(type.source)) fail(`${entity.id}: 카드 분류에 표시명·원본 문자열·출처가 필요합니다.`);
          const key = stable(type);
          if (seen.has(key)) fail(`${entity.id}: 동일한 카드 분류가 중복됩니다.`);
          seen.add(key);
        }
        requireProof(entity, 'types', entity.types, kind);
        const classificationProof = observations.get(entity.provenance?.types);
        if (classificationProof && entity.types.some(type => type?.source !== classificationProof.source_id)) fail(`${entity.id}: 카드 분류의 출처와 분류 근거의 출처가 다릅니다.`);
      }
      stringList(entity.other_version_ids, byGroup.cards, `${entity.id}.other_version_ids`);
      if (Array.isArray(entity.other_version_ids) && entity.other_version_ids.includes(entity.id)) fail(`${entity.id}: 자기 자신은 다른 버전이 아닙니다.`);
      requireProof(entity, 'other_version_ids', entity.other_version_ids, kind);
    }
    if (group === 'products') {
      if (Array.isArray(entity.entries) && entity.entries.some(entry => entry?.kind === 'manager')) fail('감독은 서비스 지원 범위에서 제외되었습니다.');
      if (![null, 'special_list', 'pack'].includes(entity.kind)) fail(`${entity.id}: 상품 종류가 올바르지 않습니다.`);
      if (![undefined, null, 'bundle', 'draw'].includes(entity.purchase_mode)) fail(`${entity.id}: 지급 방식은 bundle·draw 또는 미확인이어야 합니다.`);
      if (entity.kind === 'pack' && entity.purchase_mode !== 'bundle') fail(`${entity.id}: 팩은 일괄 구매·지급 상품이며 추첨 상품으로 분류할 수 없습니다.`);
      if (entity.kind === 'special_list' && entity.purchase_mode === 'bundle') fail(`${entity.id}: 일괄 지급형 팩과 특수 선수 명단을 혼합할 수 없습니다.`);
      if (!Array.isArray(entity.list_types) || !entity.list_types.every(text)) fail(`${entity.id}: 명단 분류 배열이 필요합니다.`);
      for (const field of ['source_listed_player_count', 'total_player_count']) if (!(entity[field] === null || count(entity[field]))) fail(`${entity.id}.${field}: 수량은 확인값 또는 null이어야 합니다.`);
      if (!['partial', 'complete', 'unknown'].includes(entity.composition_status)) fail(`${entity.id}: 구성 완전성 상태가 필요합니다.`);
      if (entity.composition_status === 'complete') fail(`${entity.id}: 감독을 수집하지 않는 지원 범위에서는 상품 전체 구성을 완료로 표시할 수 없습니다.`);
      if (entity.total_player_count !== null) requireProductProof(entity, 'total_player_count', entity.provenance?.total_player_count);
      if (entity.composition_status === 'complete') requireProductProof(entity, 'composition_status', entity.provenance?.composition_status);
      if (!Array.isArray(entity.entries)) fail(`${entity.id}: 구성 배열이 필요합니다.`);
      else {
        const seen = new Set();
        let playerCount = 0;
        for (const entry of entity.entries) {
          if (!object(entry)) { fail(`${entity.id}: 구성 항목은 종류·대상·수량·근거를 가진 객체여야 합니다.`); continue; }
          if (!object(entry) || !['card', 'manager', 'other'].includes(entry.kind) || !text(entry.target_id) || all.get(entry.target_id)?.kind !== entry.kind || !Number.isSafeInteger(entry.quantity) || entry.quantity <= 0) fail(`${entity.id}: 구성 대상 종류·ID·양수 수량이 올바르지 않습니다.`);
          const key = stable([entry.kind, entry.target_id]);
          if (seen.has(key)) fail(`${entity.id}: 구성 대상이 중복됩니다. 수량으로 표현하세요.`);
          seen.add(key);
          requireProductProof(entity, 'entries', entry.observation_id);
          if (entry.kind === 'card') playerCount += entry.quantity;
        }
        if (entity.total_player_count !== null && playerCount > entity.total_player_count) fail(`${entity.id}: 확보 선수 수가 확인된 전체 선수 수보다 많습니다.`);
        if (entity.composition_status === 'complete' && (entity.total_player_count === null || playerCount !== entity.total_player_count)) fail(`${entity.id}: 전체 선수 수와 확보한 선수 구성이 일치해야 전체 구성으로 표시할 수 있습니다.`);
      }
      if (!(entity.price === null || object(entity.price)) || !(entity.currency === null || text(entity.currency)) || !(entity.opening_options === null || Array.isArray(entity.opening_options)) || !(entity.limits === null || object(entity.limits))) fail(`${entity.id}: 가격·재화·개봉 옵션·제한은 확인값 또는 null이어야 합니다.`);
      if (!object(entity.availability) || !['unknown', 'active', 'ended'].includes(entity.availability.status) || ![entity.availability.start, entity.availability.end].every(value => value === null || timestamp(value))) fail(`${entity.id}: 이용 기간·상태가 올바르지 않습니다.`);
      for (const field of ['kind', 'purchase_mode', 'list_types', 'source_listed_player_count', 'total_player_count', 'price', 'currency', 'opening_options', 'limits']) requireProof(entity, field, entity[field], kind);
      if (object(entity.availability) && (entity.availability.status !== 'unknown' || entity.availability.start !== null || entity.availability.end !== null)) requireProof(entity, 'availability', entity.availability, kind);
    }
    // React transport sentinels are missing values, never product data.
    if (stable(entity).includes('"$undefined"')) fail(`${entity.id}: 원본 직렬화 sentinel을 확인값으로 저장할 수 없습니다.`);
  }
  if (errors.length) throw new CatalogValidationError(errors);
  return seed;
}

function protectSnapshot(previous, next) {
  if (!previous) return;
  if (Date.parse(next.observed_at) < Date.parse(previous.observed_at)) throw new CatalogValidationError(['이전보다 오래된 관찰로 정상 스냅샷을 교체할 수 없습니다.']);
  for (const [key, value] of Object.entries(previous.coverage.source_totals)) if (next.coverage.source_totals[key] === undefined || next.coverage.source_totals[key] < value) throw new CatalogValidationError([`출처 목록 총계가 줄거나 사라졌습니다: ${key}. 삭제 여부를 별도로 재검증하세요.`]);
  const known = (oldValue, newValue, path) => {
    if (oldValue === null || oldValue === undefined || oldValue === 'unknown') return;
    if (newValue === null || newValue === undefined || (newValue === 'unknown' && oldValue !== 'unknown')) throw new CatalogValidationError([`확인된 값을 미확인으로 덮어쓸 수 없습니다: ${path}`]);
    if (Array.isArray(oldValue)) {
      if (oldValue.length > 0 && (!Array.isArray(newValue) || newValue.length === 0)) throw new CatalogValidationError([`확인된 목록을 비울 수 없습니다: ${path}`]);
      return;
    }
    if (object(oldValue)) for (const [key, value] of Object.entries(oldValue)) {
      if (key !== 'provenance') known(value, newValue?.[key], `${path}.${key}`);
    }
  };
  for (const group of [...groups, 'assets']) {
    const newEntities = new Map((next[group] ?? []).map(entity => [entity.id, entity]));
    for (const before of previous[group] ?? []) {
      const after = newEntities.get(before.id);
      if (!after) throw new CatalogValidationError([`부분 응답에서 기존 대상을 삭제할 수 없습니다: ${before.id}`]);
      known(before, after, before.id);
      for (const key of ['external_ids', 'asset_ids', 'other_version_ids', 'entries']) if (Array.isArray(before[key])) {
        const identity = value => object(value) ? stable(key === 'entries' ? [value.kind, value.target_id] : value) : value;
        const present = new Set((after[key] ?? []).map(identity));
        if (before[key].some(value => !present.has(identity(value)))) throw new CatalogValidationError([`기존 식별자·관계가 빠졌습니다: ${before.id}.${key}`]);
      }
    }
  }
}

const schema = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = DELETE;
CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS observations (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), source_entity_kind TEXT NOT NULL, source_entity_id TEXT NOT NULL, observed_at TEXT NOT NULL, url TEXT NOT NULL, http_status INTEGER NOT NULL, excerpt TEXT NOT NULL, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS persons (id TEXT PRIMARY KEY REFERENCES entities(id));
CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY REFERENCES entities(id), person_id TEXT REFERENCES persons(id), overall_value INTEGER, overall_conditions TEXT);
CREATE TABLE IF NOT EXISTS managers (id TEXT PRIMARY KEY REFERENCES entities(id));
CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY REFERENCES entities(id), kind TEXT, source_listed_player_count INTEGER, total_player_count INTEGER, composition_status TEXT NOT NULL, terms_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS other_items (id TEXT PRIMARY KEY REFERENCES entities(id));
CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, url TEXT NOT NULL, kind TEXT NOT NULL, composition TEXT NOT NULL, observation_id TEXT NOT NULL REFERENCES observations(id), payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS external_ids (entity_id TEXT NOT NULL REFERENCES entities(id), entity_kind TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES sources(id), id_type TEXT NOT NULL, original_value TEXT NOT NULL, PRIMARY KEY(entity_id, source_id, id_type, original_value), UNIQUE(entity_kind,source_id,id_type,original_value));
CREATE TABLE IF NOT EXISTS entity_assets (entity_id TEXT NOT NULL REFERENCES entities(id), asset_id TEXT NOT NULL REFERENCES assets(id), PRIMARY KEY(entity_id,asset_id));
CREATE TABLE IF NOT EXISTS card_types (card_id TEXT NOT NULL REFERENCES cards(id), ordinal INTEGER NOT NULL, label TEXT NOT NULL, raw_value TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES sources(id), PRIMARY KEY(card_id,ordinal));
CREATE TABLE IF NOT EXISTS card_versions (card_id TEXT NOT NULL REFERENCES cards(id), other_card_id TEXT NOT NULL REFERENCES cards(id), PRIMARY KEY(card_id,other_card_id));
CREATE TABLE IF NOT EXISTS product_entries (product_id TEXT NOT NULL REFERENCES products(id), target_kind TEXT NOT NULL, target_id TEXT NOT NULL REFERENCES entities(id), quantity INTEGER NOT NULL CHECK(quantity>0), observation_id TEXT NOT NULL REFERENCES observations(id), PRIMARY KEY(product_id,target_kind,target_id));
CREATE TABLE IF NOT EXISTS field_provenance (entity_id TEXT NOT NULL REFERENCES entities(id), field_name TEXT NOT NULL, observation_id TEXT NOT NULL REFERENCES observations(id), PRIMARY KEY(entity_id,field_name));
CREATE TABLE IF NOT EXISTS revisions (entity_kind TEXT NOT NULL, entity_id TEXT NOT NULL, payload_sha256 TEXT NOT NULL, observed_at TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(entity_kind,entity_id,payload_sha256));
CREATE TABLE IF NOT EXISTS imports (id TEXT PRIMARY KEY, observed_at TEXT NOT NULL, imported_at TEXT NOT NULL, snapshot_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS catalog_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

/** Import transactionally, retaining observations and prior entity revisions. */
export function importCatalog(seed, { dbPath }) {
  validateCatalog(seed);
  mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(schema);
    const state = db.prepare("SELECT value FROM catalog_state WHERE key = 'current_import'").get();
    const previous = state ? JSON.parse(db.prepare('SELECT snapshot_json FROM imports WHERE id = ?').get(state.value).snapshot_json) : null;
    protectSnapshot(previous, seed);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const source of seed.sources) db.prepare('INSERT INTO sources VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url').run(source.id, source.name, source.url);
      for (const observation of seed.observations) {
        const existing = db.prepare('SELECT payload_json FROM observations WHERE id=?').get(observation.id);
        if (existing && existing.payload_json !== stable(observation)) throw new CatalogValidationError([`관측 ID를 다른 내용으로 재사용할 수 없습니다: ${observation.id}`]);
        db.prepare('INSERT OR IGNORE INTO observations VALUES(?,?,?,?,?,?,?,?,?)').run(observation.id, observation.source_id, observation.source_entity_kind, observation.source_entity_id, observation.observed_at, observation.url, observation.http_status, observation.excerpt, stable(observation));
      }
      for (const group of groups) for (const entity of seed[group] ?? []) {
        db.prepare('INSERT INTO entities VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,name=excluded.name,payload_json=excluded.payload_json').run(entity.id, kinds[group], entity.name, stable(entity));
        db.prepare('INSERT OR IGNORE INTO revisions VALUES(?,?,?,?,?)').run(kinds[group], entity.id, hash(entity), seed.observed_at, stable(entity));
        for (const external of entity.external_ids) db.prepare('INSERT OR IGNORE INTO external_ids VALUES(?,?,?,?,?)').run(entity.id, kinds[group], external.source, external.id_type, external.value);
        db.prepare('DELETE FROM field_provenance WHERE entity_id=?').run(entity.id);
        for (const [field, observation] of Object.entries(entity.provenance)) db.prepare('INSERT INTO field_provenance VALUES(?,?,?)').run(entity.id, field, observation);
      }
      for (const person of seed.persons) db.prepare('INSERT OR IGNORE INTO persons VALUES(?)').run(person.id);
      for (const asset of seed.assets) {
        db.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url,kind=excluded.kind,composition=excluded.composition,observation_id=excluded.observation_id,payload_json=excluded.payload_json').run(asset.id, asset.url, asset.kind, asset.composition, asset.observation_id, stable(asset));
        db.prepare('INSERT OR IGNORE INTO revisions VALUES(?,?,?,?,?)').run('asset', asset.id, hash(asset), seed.observed_at, stable(asset));
      }
      for (const card of seed.cards) db.prepare('INSERT INTO cards VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET person_id=excluded.person_id,overall_value=excluded.overall_value,overall_conditions=excluded.overall_conditions').run(card.id, card.person_id, card.overall.value, card.overall.conditions);
      for (const manager of seed.managers) db.prepare('INSERT OR IGNORE INTO managers VALUES(?)').run(manager.id);
      for (const item of seed.other_items ?? []) db.prepare('INSERT OR IGNORE INTO other_items VALUES(?)').run(item.id);
      for (const product of seed.products) {
        const terms = { purchase_mode: product.purchase_mode ?? null, price: product.price, currency: product.currency, opening_options: product.opening_options, limits: product.limits, availability: product.availability };
        db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,source_listed_player_count=excluded.source_listed_player_count,total_player_count=excluded.total_player_count,composition_status=excluded.composition_status,terms_json=excluded.terms_json').run(product.id, product.kind, product.source_listed_player_count, product.total_player_count, product.composition_status, stable(terms));
        db.prepare('DELETE FROM product_entries WHERE product_id=?').run(product.id);
        for (const entry of product.entries) db.prepare('INSERT INTO product_entries VALUES(?,?,?,?,?)').run(product.id, entry.kind, entry.target_id, entry.quantity, entry.observation_id);
      }
      for (const entity of [...seed.cards, ...seed.managers, ...seed.products.filter(product => product.asset_ids !== undefined)]) {
        db.prepare('DELETE FROM entity_assets WHERE entity_id=?').run(entity.id);
        for (const asset of entity.asset_ids) db.prepare('INSERT INTO entity_assets VALUES(?,?)').run(entity.id, asset);
      }
      for (const card of seed.cards) {
        db.prepare('DELETE FROM card_types WHERE card_id=?').run(card.id);
        for (const [index, type] of card.types.entries()) db.prepare('INSERT INTO card_types VALUES(?,?,?,?,?)').run(card.id, index, type.label, type.raw_value, type.source);
        db.prepare('DELETE FROM card_versions WHERE card_id=?').run(card.id);
        for (const other of card.other_version_ids) db.prepare('INSERT INTO card_versions VALUES(?,?)').run(card.id, other);
      }
      const importId = hash(seed);
      db.prepare('INSERT OR IGNORE INTO imports VALUES(?,?,?,?)').run(importId, seed.observed_at, new Date().toISOString(), stable(seed));
      db.prepare("INSERT INTO catalog_state VALUES('current_import',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(importId);
      db.exec('COMMIT');
      return { importId, cards: seed.cards.length, managers: seed.managers.length, products: seed.products.length, observations: seed.observations.length };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
}

/** Stage the database and JSON; the last operation atomically replaces public JSON. */
export function publishCatalog(seed, { outDir, dbPath }) {
  validateCatalog(seed);
  const target = resolve(outDir, 'data/catalog.json');
  if (existsSync(target)) protectSnapshot(JSON.parse(readFileSync(target, 'utf8')), seed);
  mkdirSync(dirname(target), { recursive: true });
  mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const nonce = randomUUID();
  const stagedDb = `${resolve(dbPath)}.${nonce}.tmp`;
  const backupDb = `${resolve(dbPath)}.${nonce}.bak`;
  const stagedJson = join(dirname(target), `.catalog.${nonce}.tmp`);
  const existed = existsSync(dbPath);
  let replacedDb = false;
  try {
    if (existed) { copyFileSync(dbPath, stagedDb); copyFileSync(dbPath, backupDb); }
    const result = importCatalog(seed, { dbPath: stagedDb });
    writeFileSync(stagedJson, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
    renameSync(stagedDb, resolve(dbPath));
    replacedDb = true;
    renameSync(stagedJson, target);
    return { ...result, publicPath: target, dbPath: resolve(dbPath) };
  } catch (error) {
    if (replacedDb) {
      if (existed) copyFileSync(backupDb, resolve(dbPath));
      else rmSync(resolve(dbPath), { force: true });
    }
    throw error;
  } finally {
    for (const path of [stagedDb, backupDb, stagedJson]) { try { rmSync(path, { force: true }); } catch { /* Published data remains valid if only cleanup fails. */ } }
  }
}
