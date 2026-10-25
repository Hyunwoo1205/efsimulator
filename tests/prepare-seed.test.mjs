import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { importCatalog, validateCatalog } from '../scripts/catalog.mjs';

test('실제 조사 표본을 재현하고 새 관측 ID로 재수입해도 카드 ID와 과거 근거를 보존한다', t => {
  const root = mkdtempSync(join(tmpdir(), 'efsimulator-seed-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'data/research'), { recursive: true });
  for (const path of ['scripts/prepare-seed.mjs', 'scripts/catalog.mjs', 'scripts/catalog-history.mjs', 'scripts/collected-products.mjs', 'scripts/collect-efhub.mjs', 'data/research/source-observations.json']) {
    copyFileSync(new URL(`../${path}`, import.meta.url), join(root, path));
  }
  const prepare = () => {
    execFileSync(process.execPath, [join(root, 'scripts/prepare-seed.mjs')], { stdio: 'pipe' });
    return JSON.parse(readFileSync(join(root, 'data/catalog.seed.json'), 'utf8'));
  };
  const before = prepare();
  assert.deepEqual(prepare(), before, '같은 원본은 같은 ID·값으로 재현된다');
  assert.equal(before.coverage.complete, false);
  assert.equal(before.products[0].total_player_count, null);
  assert.equal(before.products[0].entries.some(entry => entry.kind === 'manager'), false);
  assert.ok(before.cards.every(card => card.external_ids.every(id => typeof id.value === 'string')));
  assert.equal(JSON.stringify(before).includes('"$undefined"'), false);
  const evidencePath = join(root, 'data/research/source-observations.json');
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  const observation = evidence.observations.find(item => item.id === 'efhub_player_payload');
  observation.observed_at = '2026-10-26T03:00:00Z';
  observation.sha256 = 'b'.repeat(64);
  observation.verified_fields.card.overallRating += 1;
  evidence.observed_at = observation.observed_at;
  writeFileSync(evidencePath, JSON.stringify(evidence));
  const after = prepare();
  assert.deepEqual(after.cards.map(card => card.id), before.cards.map(card => card.id));
  const baseCard = before.cards.find(card => card.other_version_ids.length === 3);
  const nextCard = after.cards.find(card => card.id === baseCard.id);
  assert.notEqual(baseCard.provenance.overall, nextCard.provenance.overall);
  const dbPath = join(root, 'catalog.sqlite');
  importCatalog(before, { dbPath });
  assert.doesNotThrow(() => importCatalog(after, { dbPath }));
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM revisions WHERE entity_id=?').get(baseCard.id).n, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM observations WHERE id IN (?,?)').get(baseCard.provenance.overall, nextCard.provenance.overall).n, 2);
  } finally { db.close(); }
});

function sandbox(t, { canonical = false, collection = false, audit = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'efsimulator-seed-history-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const paths = ['scripts/prepare-seed.mjs', 'scripts/catalog.mjs', 'scripts/catalog-history.mjs', 'scripts/collected-products.mjs', 'scripts/collect-efhub.mjs', 'data/research/source-observations.json'];
  if (canonical) paths.push('data/catalog.seed.json');
  if (collection) paths.push('data/research/current-catalog-observations.json');
  if (audit) paths.push('data/research/card-api-audit.json');
  for (const path of paths) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(new URL(`../${path}`, import.meta.url), join(root, path));
  }
  const target = join(root, 'data/catalog.seed.json');
  const get = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
  const put = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), `${JSON.stringify(value, null, 2)}\n`); };
  const prepare = (extra = []) => {
    execFileSync(process.execPath, [...extra, join(root, 'scripts/prepare-seed.mjs')], { stdio: 'pipe' });
    return JSON.parse(readFileSync(target, 'utf8'));
  };
  return { root, target, get, put, prepare };
}

function changedWindow(original, { sameSize = false, shrinkExisting = false } = {}) {
  const incoming = structuredClone(original);
  const product = structuredClone(incoming.products[0]);
  const listing = structuredClone(incoming.observations.find(item => item.id === product.list_observation_id));
  const detail = structuredClone(incoming.observations.find(item => item.id === product.observation_id));
  const oldSlug = product.slug;
  const at = '2026-10-26T05:00:00Z';
  if (shrinkExisting) {
    product.players_payload.pop();
    product.playerCount--;
  } else {
    product.name = 'Independent Fresh CI Window Fixture';
    product.slug = 'independent-fresh-ci-window-fixture';
    product.players_payload = (sameSize ? product.players_payload : product.players_payload.slice(0, 1)).map((card, index) => {
      const id = `00090071992547409931234${String(index).padStart(3, '0')}`;
      return { ...card, id, name: `새 창의 회귀 표본 카드 ${index}`, imageUrl: `https://efimg.com/efootballhub22/images/player_cards/${id}_l.png` };
    });
    product.playerCount = product.players_payload.length;
  }
  listing.id = 'fixture-list-window-new';
  listing.observed_at = at;
  listing.sha256 = 'e'.repeat(64);
  listing.excerpts = [{ text: '독립 회귀 fixture: 새 목록 창. 기존 canonical과 별개의 원본 관측.' }];
  const listed = listing.verified_fields.packs.findIndex(item => item.slug === oldSlug);
  listing.verified_fields.packs[listed] = { name: product.name, slug: product.slug, date: product.date, playerCount: product.playerCount };
  detail.id = 'fixture-detail-window-new';
  detail.observed_at = at;
  detail.sha256 = 'f'.repeat(64);
  detail.url = `https://efhub.com/ko/packs/${product.slug}`;
  detail.excerpts = [{ text: '독립 회귀 fixture: 같은 경계에서 확인한 새 카드 구성.' }];
  Object.assign(detail.verified_fields, { source_entity_id: product.slug, pack_source_id: product.slug, source_listed_player_count: product.playerCount, players_payload_count: product.playerCount, players_payload: product.players_payload });
  product.list_observation_id = listing.id;
  product.observation_id = detail.id;
  incoming.products = sameSize ? incoming.products.map(item => item.slug === oldSlug ? product : { ...item, list_observation_id: listing.id }) : [product];
  const selectedDetailIds = new Set(incoming.products.map(item => item.observation_id));
  incoming.observations = [listing, ...incoming.observations.filter(item => selectedDetailIds.has(item.id)), detail];
  incoming.observed_at = at;
  incoming.scope.description = '현재 목록 창의 크기를 유지하거나 축소한 독립 회귀 fixture';
  return incoming;
}

function assertOldIdsKept(before, after) {
  for (const group of ['products', 'cards', 'assets', 'observations', 'persons']) {
    const ids = new Set(after[group].map(item => item.id));
    for (const item of before[group]) assert.ok(ids.has(item.id), `이전 ${group} ID 소실: ${item.id}`);
  }
}

function assertFailureKeepsSeed(f, args = []) {
  const before = readFileSync(f.target);
  const execution = spawnSync(process.execPath, [...args, join(f.root, 'scripts/prepare-seed.mjs')], { encoding: 'utf8' });
  assert.notEqual(execution.status, 0, `실패해야 하는 입력을 반영했습니다: ${execution.stdout}`);
  assert.deepEqual(readFileSync(f.target), before, '준비 실패는 committed seed 바이트를 변경하지 않는다');
  assert.deepEqual(readdirSync(join(f.root, 'data')).filter(path => path.endsWith('.tmp')), [], '임시 파일을 남기지 않는다');
  return execution.stderr;
}

test('DB 없는 fresh CI도 추적 seed를 누적 기준으로 사용하며 같은 입력은 byte diff를 만들지 않는다', t => {
  const f = sandbox(t, { canonical: true, collection: true, audit: true });
  const before = readFileSync(f.target);
  assert.equal(existsSync(join(f.root, 'artifacts/catalog.sqlite')), false);
  f.prepare();
  assert.deepEqual(readFileSync(f.target), before);
  f.prepare();
  assert.deepEqual(readFileSync(f.target), before);
  assert.equal(existsSync(join(f.root, 'artifacts/catalog.sqlite')), false);
});

for (const sameSize of [false, true]) test(`새 ${sameSize ? '동일 크기' : '축소된'} 목록 창에서 빠진 이전 개체·관측을 fresh CI에서 보존한다`, t => {
  const f = sandbox(t, { canonical: true, collection: true });
  const before = f.get('data/catalog.seed.json');
  const current = f.get('data/research/current-catalog-observations.json');
  const incoming = changedWindow(current, { sameSize });
  f.put('data/research/current-catalog-observations.json', incoming);
  assert.equal(existsSync(join(f.root, 'artifacts/catalog.sqlite')), false);
  const after = f.prepare();
  assertOldIdsKept(before, after);
  assert.equal(after.products.length, before.products.length + 1, '같은 개수의 수집 창도 누적 상품은 증가한다');
  const addedCount = incoming.products.find(product => product.slug === 'independent-fresh-ci-window-fixture').players_payload.length;
  assert.equal(after.cards.length, before.cards.length + addedCount);
  const currentSlugs = new Set(incoming.products.map(product => product.slug));
  for (const product of before.products) {
    const actual = after.products.find(item => item.id === product.id);
    const isCurrent = product.external_ids.some(external => external.source === 'efhub' && currentSlugs.has(external.value));
    if (!isCurrent) assert.deepEqual(actual, product, 'window 밖 상품과 기존 근거를 되돌리지 않는다');
    else assert.deepEqual(actual.entries, product.entries, '새 목록 관측은 더 최신의 기존 상세 관계 근거를 되돌리지 않는다');
  }
  for (const observation of before.observations) assert.deepEqual(after.observations.find(item => item.id === observation.id), observation);
  const firstBytes = readFileSync(f.target);
  f.prepare();
  assert.deepEqual(readFileSync(f.target), firstBytes);
  assert.match(after.coverage.scope, new RegExp(`상품 ${after.products.length}개`));
});

test('추적 누적 기준의 가격·조건·버전·복수 분류와 검증된 이미지를 bootstrap으로 되돌리지 않는다', t => {
  const f = sandbox(t, { canonical: true, collection: true });
  const canonical = f.get('data/catalog.seed.json');
  const raw = f.get('data/research/current-catalog-observations.json');
  const firstRaw = raw.products[0];
  const product = canonical.products.find(item => item.external_ids.some(external => external.source === 'efhub' && external.value === firstRaw.slug));
  const card = canonical.cards.find(item => item.id === product.entries[0].target_id);
  const at = '2026-10-25T03:00:00Z';
  const proof = (id, kind, external) => ({ id, source_id: 'efhub', source_entity_kind: kind, source_entity_id: external, observed_at: at, url: 'https://efhub.com/ko', http_status: 200, excerpt: '독립 회귀 fixture: 이미 누적한 구매·능력·이미지 조건' });
  canonical.observations.push(proof('fixture-known-product', 'product', firstRaw.slug), proof('fixture-known-card', 'card', firstRaw.players_payload[0].id));
  Object.assign(product, { kind: 'pack', purchase_mode: 'bundle', price: { amount: 750, currency: 'eFootball 코인', conditions: '확인한 fixture 조건' }, currency: 'eFootball 코인' });
  for (const field of ['kind', 'purchase_mode', 'price', 'currency']) product.provenance[field] = 'fixture-known-product';
  card.overall = { value: 99, conditions: '확인한 fixture 레벨 조건' };
  card.provenance.overall = 'fixture-known-card';
  card.other_version_ids = [canonical.cards.find(item => item.id !== card.id).id];
  card.provenance.other_version_ids = 'fixture-known-card';
  card.types = [{ label: 'Epic', raw_value: '5', source: 'efhub' }, { label: 'Big Time', raw_value: '7', source: 'efhub' }];
  card.provenance.types = 'fixture-known-card';
  const asset = canonical.assets.find(item => item.id === card.asset_ids[0]);
  asset.composition = 'combined';
  asset.observation_id = 'fixture-known-card';
  validateCatalog(canonical);
  f.put('data/catalog.seed.json', canonical);
  // The current source summary is newer, but has no conditions or extra types.
  // It must not be mistaken for a retraction of the earlier detailed values.
  const after = f.prepare();
  assert.deepEqual(after.products.find(item => item.id === product.id), product);
  assert.deepEqual(after.cards.find(item => item.id === card.id), card);
  assert.deepEqual(after.assets.find(item => item.id === asset.id), asset);
});

test('새 상세의 실제 구성 축소는 임의 union으로 숨기지 않고 기존 seed를 보존한다', t => {
  const f = sandbox(t, { canonical: true, collection: true });
  f.put('data/research/current-catalog-observations.json', changedWindow(f.get('data/research/current-catalog-observations.json'), { shrinkExisting: true }));
  const error = assertFailureKeepsSeed(f);
  assert.match(error, /기존 상품 카드|새 구성/);
});

test('관측 ID 충돌·새로운 과거 근거·숫자 ID·감독 범위 침범은 seed 바이트를 보존하며 실패한다', t => {
  for (const mode of ['observation-conflict', 'backdated-value', 'numeric-id', 'manager-scope']) {
    const f = sandbox(t, { canonical: true, collection: true });
    const canonical = f.get('data/catalog.seed.json');
    const evidence = f.get('data/research/source-observations.json');
    const detail = evidence.observations.find(item => item.id === 'efhub_player_payload');
    if (mode === 'observation-conflict') {
      const item = canonical.observations.find(observation => observation.research_id === 'efhub_player_payload');
      item.excerpt = '같은 관측 ID로 다른 원문을 저장하려는 충돌';
    } else if (mode === 'backdated-value') {
      const card = canonical.cards.find(item => item.external_ids.some(external => external.value === detail.verified_fields.card.id));
      canonical.observations.push({ id: 'fixture-newer-card', source_id: 'efhub', source_entity_kind: 'card', source_entity_id: detail.verified_fields.card.id, observed_at: '2026-10-28T03:00:00Z', url: 'https://efhub.com/ko', http_status: 200, excerpt: '독립 회귀 fixture: canonical에 이미 있는 최신 값' });
      card.name = '이미 확인한 최신 이름';
      card.provenance.name = 'fixture-newer-card';
      detail.observed_at = '2026-10-27T03:00:00Z';
      detail.sha256 = 'c'.repeat(64);
      detail.verified_fields.card.name = '뒤늦게 제출한 과거 값';
    } else if (mode === 'numeric-id') detail.verified_fields.card.id = 12345678901234568;
    else canonical.managers.push({ id: 'out-of-scope-manager' });
    f.put('data/catalog.seed.json', canonical);
    f.put('data/research/source-observations.json', evidence);
    assertFailureKeepsSeed(f);
  }
});

test('원본 JSON 손상과 임시 파일 쓰기 실패도 추적 누적 seed를 덮어쓰지 않는다', t => {
  const malformed = sandbox(t, { canonical: true });
  writeFileSync(join(malformed.root, 'data/research/source-observations.json'), '{malformed');
  assertFailureKeepsSeed(malformed);
  const f = sandbox(t, { canonical: true, collection: true });
  f.put('data/research/current-catalog-observations.json', changedWindow(f.get('data/research/current-catalog-observations.json')));
  const preload = join(f.root, 'write-failure.mjs');
  writeFileSync(preload, `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module'; const write=fs.writeFile; fs.writeFile=async(path,...args)=>{if(String(path).includes('catalog.seed.json.')&&String(path).endsWith('.tmp'))throw Object.assign(new Error('injected ENOSPC'),{code:'ENOSPC'});return write(path,...args)};syncBuiltinESMExports();`);
  assert.match(assertFailureKeepsSeed(f, ['--import', preload]), /injected ENOSPC/);
});
