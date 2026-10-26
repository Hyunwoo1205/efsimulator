import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { CatalogValidationError, importCatalog, publishCatalog, validateCatalog } from '../scripts/catalog.mjs';
import { buildSite } from '../scripts/build.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'efsimulator-catalog-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const observed_at = '2026-10-25T03:00:00Z';
  const observation = (id, kind, original) => ({ id, source_id: 'efhub', source_entity_kind: kind, source_entity_id: original, observed_at, url: `https://efhub.com/ko/${kind}/${original}`, excerpt: '실제 자료의 구조를 검증하기 위한 독립 테스트 표본', http_status: 200 });
  const external = (kind, value) => [{ source: 'efhub', id_type: kind, value }];
  const seed = {
    version: 1, observed_at,
    coverage: { scope: '검증용 소형 표본', complete: false, notes: ['표본과 전체 목록을 구분', '감독은 서비스 지원 범위에서 제외하며 실제 포함 여부·수량은 미확인'], source_totals: { products: 1698, cards: 50840 } },
    sources: [{ id: 'efhub', name: 'EFHub', url: 'https://efhub.com' }],
    observations: [observation('o-card', 'card', '00012345678901234567890'), observation('o-manager', 'manager', 'manager-01'), observation('o-product', 'product', 'pack-01')],
    persons: [],
    assets: [{ id: 'asset-card', url: 'https://efimg.com/test-card.png', kind: 'card_image', composition: 'unknown', observation_id: 'o-card' }],
    cards: [{ id: 'card-01', external_ids: external('card_id', '00012345678901234567890'), person_id: null, name: '테스트 선수', overall: { value: 86, conditions: null }, types: [{ label: 'Epic', raw_value: '5', source: 'efhub' }, { label: 'Big Time', raw_value: '7', source: 'efhub' }], asset_ids: ['asset-card'], other_version_ids: [], provenance: { name: 'o-card', overall: 'o-card', types: 'o-card' } }],
    managers: [],
    products: [{ id: 'product-01', external_ids: external('pack_slug', 'pack-01'), name: '테스트 명단', kind: null, list_types: [], source_listed_player_count: 1, total_player_count: null, composition_status: 'partial', entries: [{ kind: 'card', target_id: 'card-01', quantity: 1, observation_id: 'o-product' }], price: null, currency: null, opening_options: null, limits: null, availability: { start: null, end: null, status: 'unknown' }, provenance: { name: 'o-product', source_listed_player_count: 'o-product' } }],
  };
  const outDir = join(root, 'dist');
  const dbPath = join(root, 'artifacts/catalog.sqlite');
  const query = (sql, ...args) => { const db = new DatabaseSync(dbPath, { readOnly: true }); try { return db.prepare(sql).all(...args); } finally { db.close(); } };
  return { root, seed, outDir, dbPath, query };
}

test('긴 외부 ID·선행 0·복수 분류·미확인 조건을 그대로 저장한다', t => {
  const f = fixture(t);
  assert.equal(validateCatalog(f.seed), f.seed);
  importCatalog(f.seed, { dbPath: f.dbPath });
  assert.equal(f.query("SELECT original_value FROM external_ids WHERE entity_id='card-01'")[0].original_value, '00012345678901234567890');
  assert.equal(f.query("SELECT COUNT(*) AS n FROM card_types WHERE card_id='card-01'")[0].n, 2);
  assert.equal(f.query("SELECT overall_conditions FROM cards WHERE id='card-01'")[0].overall_conditions, null);
  const terms = JSON.parse(f.query('SELECT terms_json FROM products')[0].terms_json);
  assert.equal(terms.price, null);
  assert.equal(terms.limits, null);
});

test('숫자로 변환된 외부 ID와 원본 transport sentinel을 거부한다', t => {
  const f = fixture(t);
  f.seed.cards[0].external_ids[0].value = 123;
  assert.throws(() => validateCatalog(f.seed), /원본 문자열 외부 ID/);
  f.seed.cards[0].external_ids[0].value = '00012345678901234567890';
  f.seed.cards[0].overall.conditions = '$undefined';
  assert.throws(() => validateCatalog(f.seed), /sentinel/);
});

test('잘못된 중첩 입력은 일반 실행 오류 대신 검증 오류로 처리한다', t => {
  const f = fixture(t);
  f.seed.cards[0].external_ids = [null];
  f.seed.cards[0].types = [null];
  f.seed.cards[0].other_version_ids = 123;
  f.seed.products[0].entries = [null];
  assert.throws(() => validateCatalog(f.seed), CatalogValidationError);
});

test('감독 범위 제외를 실제 0명이나 상품 전체 구성 완료의 근거로 취급하지 않는다', t => {
  const f = fixture(t);
  const before = structuredClone(f.seed);
  assert.doesNotThrow(() => validateCatalog(f.seed));
  assert.deepEqual(f.seed, before);
  assert.deepEqual(f.seed.managers, []);
  assert.equal(f.seed.products[0].total_player_count, null);
  assert.equal(f.seed.products[0].composition_status, 'partial');
  assert.equal(f.seed.coverage.complete, false);
  assert.ok(f.seed.coverage.notes.some(note => note.includes('실제 포함 여부·수량은 미확인')));
  // An empty supported-manager collection is an application scope decision.
  // Completing even the player composition still requires separate product proof.
  f.seed.products[0].composition_status = 'complete';
  assert.throws(() => validateCatalog(f.seed), /전체 선수 수와 확보한 선수 구성/);
  f.seed.products[0].total_player_count = 1;
  f.seed.products[0].provenance.total_player_count = 'o-product';
  f.seed.products[0].provenance.composition_status = 'o-product';
  assert.throws(() => validateCatalog(f.seed), /감독을 수집하지 않는 지원 범위/);
  f.seed.products[0].composition_status = 'partial';
  importCatalog(f.seed, { dbPath: f.dbPath });
  assert.equal(f.query("SELECT SUM(quantity) AS n FROM product_entries WHERE target_kind='card'")[0].n, 1);
  assert.equal(f.seed.coverage.complete, false);
  assert.ok(f.seed.coverage.notes.some(note => note.includes('실제 포함 여부·수량은 미확인')));
});

test('범위에서 제외된 감독 엔터티를 거부하며 검증 입력을 수정하지 않는다', t => {
  const f = fixture(t);
  f.seed.managers.push({ id: 'manager-01', external_ids: [{ source: 'efhub', id_type: 'manager_id', value: 'manager-01' }], name: '테스트 감독', asset_ids: [], provenance: { name: 'o-manager' } });
  const before = structuredClone(f.seed);
  assert.throws(() => validateCatalog(f.seed), /감독은 서비스 지원 범위에서 제외되었습니다\./);
  assert.deepEqual(f.seed, before);
});

test('범위에서 제외된 상품 감독 항목을 거부하고 기존 공개 자료와 입력을 보존한다', t => {
  const f = fixture(t);
  publishCatalog(f.seed, { outDir: f.outDir, dbPath: f.dbPath });
  const published = readFileSync(join(f.outDir, 'data/catalog.json'));
  f.seed.products[0].entries.push({ kind: 'manager', target_id: 'manager-01', quantity: 1, observation_id: 'o-product' });
  const before = structuredClone(f.seed);
  assert.throws(() => publishCatalog(f.seed, { outDir: f.outDir, dbPath: f.dbPath }), /감독은 서비스 지원 범위에서 제외되었습니다\./);
  assert.deepEqual(f.seed, before);
  assert.deepEqual(readFileSync(join(f.outDir, 'data/catalog.json')), published);
  assert.equal(f.query('SELECT COUNT(*) AS n FROM imports')[0].n, 1);
});

test('출처 총계보다 적은 표본을 전체 수집으로 표시할 수 없다', t => {
  const f = fixture(t);
  f.seed.coverage.complete = true;
  assert.throws(() => validateCatalog(f.seed), /전체 수집 표시/);
});

test('코인 결제 팩도 일괄 지급형이며 추첨 명단과 혼합할 수 없다', t => {
  const f = fixture(t);
  const product = f.seed.products[0];
  Object.assign(product, { kind: 'pack', purchase_mode: 'bundle', currency: 'eFootball 코인', price: { amount: 750, currency: 'eFootball 코인', conditions: '검증 fixture의 명시된 일괄 상품 가격' } });
  for (const field of ['kind', 'purchase_mode', 'currency', 'price']) product.provenance[field] = 'o-product';
  assert.doesNotThrow(() => validateCatalog(f.seed));
  product.purchase_mode = 'draw';
  assert.throws(() => validateCatalog(f.seed), /팩은 일괄 구매·지급/);
  product.purchase_mode = 'bundle';
  product.kind = 'special_list';
  assert.throws(() => validateCatalog(f.seed), /일괄 지급형 팩과 특수 선수 명단/);
});

test('끊어진 관계·다른 대상 ID·실패한 HTTP 근거를 거부한다', t => {
  const f = fixture(t);
  f.seed.products[0].entries[0].target_id = 'missing';
  assert.throws(() => validateCatalog(f.seed), /구성 대상/);
  f.seed.products[0].entries[0].target_id = 'card-01';
  f.seed.observations[0].source_entity_id = 'other-card';
  assert.throws(() => validateCatalog(f.seed), /다른 원본 대상 ID/);
  f.seed.observations[0].source_entity_id = '00012345678901234567890';
  f.seed.observations[0].http_status = 403;
  assert.throws(() => validateCatalog(f.seed), /실패한 HTTP 관측/);
});

test('다른 출처의 분류와 필드 근거를 혼합하지 않는다', t => {
  const f = fixture(t);
  f.seed.sources.push({ id: 'konami', name: '공식', url: 'https://www.konami.com/efootball/' });
  f.seed.cards[0].types[0].source = 'konami';
  assert.throws(() => validateCatalog(f.seed), /분류의 출처와 분류 근거/);
});

test('감독 상세 관측은 상품과 카드의 포함 관계 근거가 될 수 없다', t => {
  const f = fixture(t);
  f.seed.products[0].entries[0].observation_id = 'o-manager';
  assert.throws(() => validateCatalog(f.seed), /해당 상품 상세의 정확한 출처·원본 ID/);
});

test('다른 상품의 상세와 단순 상품 목록으로 포함 관계를 만들 수 없다', t => {
  const f = fixture(t);
  f.seed.observations.push({ ...f.seed.observations[2], id: 'o-other-product', source_entity_id: 'different-pack' });
  f.seed.products[0].entries[0].observation_id = 'o-other-product';
  assert.throws(() => validateCatalog(f.seed), /해당 상품 상세의 정확한 출처·원본 ID/);
  f.seed.products[0].entries[0].observation_id = 'o-product';
  f.seed.observations[2].source_entity_kind = 'product_list';
  assert.throws(() => validateCatalog(f.seed), /해당 상품 상세의 정확한 출처·원본 ID/);
});

test('같은 상품 ID라도 출처가 다르거나 HTTP가 실패하면 관계 근거로 거부한다', t => {
  const f = fixture(t);
  f.seed.sources.push({ id: 'konami', name: '공식', url: 'https://www.konami.com/efootball/' });
  f.seed.observations.push({ ...f.seed.observations[2], id: 'o-wrong-source', source_id: 'konami' });
  f.seed.products[0].entries[0].observation_id = 'o-wrong-source';
  assert.throws(() => validateCatalog(f.seed), /해당 상품 상세의 정확한 출처·원본 ID/);
  f.seed.observations.push({ ...f.seed.observations[2], id: 'o-product-failed', http_status: 503 });
  f.seed.products[0].entries[0].observation_id = 'o-product-failed';
  assert.throws(() => validateCatalog(f.seed), /실패한 HTTP 관측/);
});

test('목록 표시 수의 근거를 게임 전체 인원수나 전체 구성의 근거로 승격할 수 없다', t => {
  const f = fixture(t);
  f.seed.observations.push({ ...f.seed.observations[2], id: 'o-product-list', source_entity_kind: 'product_list', source_entity_id: 'product-catalog' });
  const product = f.seed.products[0];
  product.total_player_count = 1;
  product.provenance.total_player_count = 'o-product-list';
  assert.throws(() => validateCatalog(f.seed), /total_player_count: 해당 상품 상세의 정확한 출처·원본 ID/);
  product.provenance.total_player_count = 'o-product';
  product.composition_status = 'complete';
  assert.throws(() => validateCatalog(f.seed), /composition_status: 존재하지 않는 관측/);
  product.provenance.composition_status = 'o-product-list';
  assert.throws(() => validateCatalog(f.seed), /composition_status: 해당 상품 상세의 정확한 출처·원본 ID/);
  product.provenance.composition_status = 'o-product';
  assert.throws(() => validateCatalog(f.seed), /감독을 수집하지 않는 지원 범위/);
  product.composition_status = 'partial';
  assert.doesNotThrow(() => validateCatalog(f.seed));
});

test('같은 자료를 재수집해도 대상·관측·개정본이 중복되지 않는다', t => {
  const f = fixture(t);
  importCatalog(f.seed, { dbPath: f.dbPath });
  importCatalog(structuredClone(f.seed), { dbPath: f.dbPath });
  assert.equal(f.query('SELECT COUNT(*) AS n FROM cards')[0].n, 1);
  assert.equal(f.query('SELECT COUNT(*) AS n FROM imports')[0].n, 1);
  assert.equal(f.query('SELECT COUNT(*) AS n FROM observations')[0].n, 3);
  assert.equal(f.query("SELECT COUNT(*) AS n FROM revisions WHERE entity_kind='card'")[0].n, 1);
});

test('새 관측의 값은 갱신하고 이전 개정본·근거·조건은 보존한다', t => {
  const f = fixture(t);
  importCatalog(f.seed, { dbPath: f.dbPath });
  const newer = structuredClone(f.seed);
  newer.observed_at = '2026-10-26T03:00:00Z';
  newer.observations.push({ ...newer.observations[0], id: 'o-card-new', observed_at: newer.observed_at, excerpt: '적용 조건이 확인된 새 관측' });
  newer.cards[0].overall = { value: 90, conditions: '출처가 표시한 새 조건' };
  newer.cards[0].provenance.overall = 'o-card-new';
  importCatalog(newer, { dbPath: f.dbPath });
  assert.equal(f.query('SELECT overall_value FROM cards')[0].overall_value, 90);
  assert.equal(f.query("SELECT COUNT(*) AS n FROM revisions WHERE entity_kind='card'")[0].n, 2);
  assert.equal(f.query('SELECT COUNT(*) AS n FROM observations')[0].n, 4);
});

test('부분 응답·총계 감소·미확인 덮어쓰기가 기존 DB와 공개 JSON을 훼손하지 않는다', t => {
  const f = fixture(t);
  publishCatalog(f.seed, { outDir: f.outDir, dbPath: f.dbPath });
  const before = readFileSync(join(f.outDir, 'data/catalog.json'));
  const empty = structuredClone(f.seed);
  empty.cards = [];
  empty.products[0].entries = empty.products[0].entries.filter(entry => entry.kind !== 'card');
  assert.throws(() => publishCatalog(empty, { outDir: f.outDir, dbPath: f.dbPath }), /기존 대상을 삭제/);
  const unknown = structuredClone(f.seed);
  unknown.cards[0].overall.value = null;
  assert.throws(() => publishCatalog(unknown, { outDir: f.outDir, dbPath: f.dbPath }), /확인된 값을 미확인/);
  const smaller = structuredClone(f.seed);
  smaller.coverage.source_totals.cards--;
  assert.throws(() => publishCatalog(smaller, { outDir: f.outDir, dbPath: f.dbPath }), /총계가 줄거나 사라졌습니다/);
  assert.deepEqual(readFileSync(join(f.outDir, 'data/catalog.json')), before);
  assert.equal(f.query('SELECT overall_value FROM cards')[0].overall_value, 86);
});

test('관측 ID 재사용 충돌은 트랜잭션을 롤백하고 공개 자료를 보존한다', t => {
  const f = fixture(t);
  publishCatalog(f.seed, { outDir: f.outDir, dbPath: f.dbPath });
  const before = readFileSync(join(f.outDir, 'data/catalog.json'));
  const changed = structuredClone(f.seed);
  changed.observations[0].excerpt = '같은 ID로 다른 관측을 덮어쓰려는 오류';
  assert.throws(() => publishCatalog(changed, { outDir: f.outDir, dbPath: f.dbPath }), /관측 ID를 다른 내용으로 재사용/);
  assert.deepEqual(readFileSync(join(f.outDir, 'data/catalog.json')), before);
  assert.equal(f.query('SELECT COUNT(*) AS n FROM imports')[0].n, 1);
});

test('빌드 실패는 기존 사이트와 DB를 보존하고 성공 시 직접주소 규칙을 생성한다', t => {
  const f = fixture(t);
  mkdirSync(join(f.root, 'data'), { recursive: true });
  mkdirSync(join(f.root, 'web'), { recursive: true });
  writeFileSync(join(f.root, 'data/catalog.seed.json'), JSON.stringify(f.seed));
  writeFileSync(join(f.root, 'web/index.html'), '<!doctype html><title>fixture</title>');
  buildSite({ root: f.root });
  const rewrites = readFileSync(join(f.outDir, '_redirects'), 'utf8');
  assert.deepEqual(new Set(rewrites.trim().split('\n')), new Set([
    '/products / 200', '/products/ / 200', '/cards / 200', '/cards/ / 200',
    '/products/product-01 / 200', '/products/product-01/ / 200',
    '/cards/card-01 / 200', '/cards/card-01/ / 200',
  ]), '목록·실제 상세·trailing slash는 /index.html canonical redirect 없이 루트로 rewrite한다');
  assert.equal(rewrites.includes('/index.html'), false);
  assert.equal(rewrites.includes('*'), false, '누락 JSON을 성공 응답으로 바꾸는 wildcard를 만들지 않는다');
  assert.equal(existsSync(join(f.outDir, '404.html')), true);
  const before = readFileSync(join(f.outDir, 'data/catalog.json'));
  const broken = structuredClone(f.seed);
  broken.products[0].entries[0].target_id = 'missing';
  writeFileSync(join(f.root, 'data/catalog.seed.json'), JSON.stringify(broken));
  assert.throws(() => buildSite({ root: f.root }), CatalogValidationError);
  assert.deepEqual(readFileSync(join(f.outDir, 'data/catalog.json')), before);
  assert.equal(f.query('SELECT COUNT(*) AS n FROM cards')[0].n, 1);
  assert.equal(existsSync(join(f.outDir, 'index.html')), true);
});
