import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { collectEfhub, parsePackList, parseProductPlayers } from '../scripts/collect-efhub.mjs';

const fixedNow = () => new Date('2026-10-25T04:00:00.000Z');
const packs = [
  { name: 'Test Pack One', slug: 'test-pack-one', date: '2026-10-22', playerCount: 2 },
  { name: 'Test Pack Two', slug: 'test-pack-two', date: '2026-10-22', playerCount: 1 },
];
const players = [
  { id: '00012345678901234567890', name: '테스트 "A" 선수', overallRating: 86, imageUrl: 'https://efimg.com/efootballhub22/images/player_cards/00012345678901234567890_l.png', playerType: 5 },
  { id: '900719925474099312345', name: 'Second Player', overallRating: 85, imageUrl: 'https://efimg.com/efootballhub22/images/player_cards/900719925474099312345_l.png', playerType: 8 },
];

function packList(items = packs) {
  return { packs: items, total: items.length, page: 1, limit: 30, hasMore: false };
}

function flightHtml(groups, { split = false, scriptPrefix = '', name = 'Test Pack One', lazyChildren = false, missingReference = false } = {}) {
  const count = groups[0].length;
  const gridClass = 'grid gap-3 grid-cols-3 md:grid-cols-[repeat(auto-fill,minmax(168px,1fr))]';
  const deferredRecords = [];
  const grids = groups.map((group) => ['$', 'div', null, {
    className: gridClass,
    children: group.map((player, index) => {
      const element = ['$', '$L1', player.id, { player }];
      if (!lazyChildren || index === 0) return element;
      const recordId = (80 + deferredRecords.length).toString(16);
      if (!missingReference) deferredRecords.push(`${recordId}:${JSON.stringify(element)}\n`);
      return `$L${recordId}`;
    }),
  }]);
  const header = ['$', 'div', null, { className: 'mb-6', children: [
    ['$', 'h1', null, { children: name }],
    ['$', 'p', null, { children: ['22 October 2026', ['$', 'span', null, { children: '·' }], count, ' players'] }],
  ] }];
  const record = `a:${JSON.stringify(['$', 'div', null, { className: 'py-6 md:px-6', children: [header, ...grids] }])}\n${deferredRecords.join('')}`;
  const chunks = split ? [record.slice(0, 47), record.slice(47, 131), record.slice(131)] : [record];
  const gridHtml = groups.map((group) => `<div class="${gridClass}">${group.map((player) => `<a href="/ko/players/${player.id}">card</a>`).join('')}</div>`).join('');
  const scripts = chunks.map((chunk) => `<script>${scriptPrefix}self.__next_f.push(${JSON.stringify([1, chunk])})</script>`).join('');
  return `<html><body><div class="py-6 md:px-6"><div class="mb-6"><h1>${name}</h1><p>22 October 2026 <span>·</span> ${count} players</p></div>${gridHtml}</div>${scripts}</body></html>`;
}

async function outputFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'efsimulator-collect-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = join(root, 'snapshots', 'efhub.json');
  await mkdir(dirname(output), { recursive: true });
  return { root, output };
}

function mockFetch({ list = packList(), details = {}, listStatus = 200 } = {}) {
  const requested = [];
  const fetchImpl = async (input) => {
    const url = new URL(String(input));
    requested.push(url.href);
    if (url.pathname === '/api/public/packs') {
      return new Response(JSON.stringify(list), { status: listStatus, headers: { 'content-type': 'application/json' } });
    }
    const slug = url.pathname.replace(/^\/ko\/packs\//, '');
    const detail = details[slug];
    if (!detail) return new Response('not found', { status: 404 });
    return new Response(detail.body, { status: detail.status ?? 200, headers: { 'content-type': 'text/html' } });
  };
  return { fetchImpl, requested };
}

const collectOptions = { pageLimit: 1, maxProducts: 2, delayMs: 0, sleep: async () => {}, now: fixedNow };

test('실제 목록 계약의 상품·문자열 slug·페이지 정보를 검증한다', () => {
  const result = parsePackList(packList(), { page: 1, limit: 30 });
  assert.deepEqual(result.packs, packs);
  assert.equal(result.total, 2);
  assert.equal(result.page, 1);
  assert.equal(result.limit, 30);
  assert.equal(result.hasMore, false);
});

test('요청과 다른 페이지·부정확한 hasMore·상품 필드 손상을 거부한다', () => {
  for (const invalid of [
    { ...packList(), page: 2 },
    { ...packList(), hasMore: 'false' },
    { ...packList(), hasMore: false, total: 60 },
    { ...packList(), packs: [{ ...packs[0], playerCount: -1 }] },
  ]) {
    assert.throws(() => parsePackList(invalid, { page: 1, limit: 30 }));
  }
});

test('Flight React props.player를 읽고 긴 숫자·선행 0 ID와 이스케이프 이름을 보존한다', () => {
  const result = parseProductPlayers(flightHtml([players]), { expectedPlayerCount: 2 });
  assert.deepEqual(result, players);
  assert.equal(typeof result[0].id, 'string');
  assert.equal(result[0].id, '00012345678901234567890');
});

test('여러 push로 나뉜 Flight record를 합치되 스크립트를 실행하지 않는다', () => {
  delete globalThis.__efsim_collect_eval_probe;
  const html = flightHtml([players], { split: true, scriptPrefix: 'globalThis.__efsim_collect_eval_probe=true;' });
  assert.deepEqual(parseProductPlayers(html, { expectedPlayerCount: 2 }), players);
  assert.equal(globalThis.__efsim_collect_eval_probe, undefined);
});

test('실측한 grid 자식의 지연 JSON record 참조만 정확한 경계 안에서 해석한다', () => {
  const html = flightHtml([players], { split: true, lazyChildren: true });
  assert.deepEqual(parseProductPlayers(html, { expectedPlayerCount: 2 }), players);
  assert.throws(() => parseProductPlayers(flightHtml([players], { lazyChildren: true, missingReference: true }), { expectedPlayerCount: 2 }), /Flight 자식 참조/);
});

test('추천 카드가 섞인 모호한 그룹·일치하지 않는 표시 인원수·앵커 누락을 거부한다', () => {
  const extra = { ...players[0], id: '33333333333333333333', name: 'Recommended Player' };
  assert.throws(() => parseProductPlayers(flightHtml([players, [extra]]), { expectedPlayerCount: 2 }));
  assert.throws(() => parseProductPlayers(flightHtml([players]), { expectedPlayerCount: 3 }));
  const missingAnchor = flightHtml([players]).replace(`<a href="/ko/players/${players[1].id}">card</a>`, '');
  assert.throws(() => parseProductPlayers(missingAnchor, { expectedPlayerCount: 2 }));
});

test('JSON의 숫자 카드 ID는 정밀도 손실 위험으로 거부한다', () => {
  const numeric = [{ ...players[0], id: 12345678901234568 }];
  assert.throws(() => parseProductPlayers(flightHtml([numeric]), { expectedPlayerCount: 1 }));
});

test('목록 HTTP 403은 실패하며 기존 출력 파일을 보존한다', async (t) => {
  const f = await outputFixture(t);
  const previous = '{"last_good":"unchanged"}\n';
  await writeFile(f.output, previous);
  const network = mockFetch({ listStatus: 403 });
  await assert.rejects(collectEfhub({ ...collectOptions, output: f.output, fetchImpl: network.fetchImpl }));
  assert.equal(await readFile(f.output, 'utf8'), previous);
  assert.equal(network.requested.length, 1);
});

test('두 번째 상품 상세가 실패하면 일부 성공으로 기존 출력을 덮지 않는다', async (t) => {
  const f = await outputFixture(t);
  const previous = '{"last_good":"two-products"}\n';
  await writeFile(f.output, previous);
  const network = mockFetch({ details: {
    'test-pack-one': { body: flightHtml([players]) },
    'test-pack-two': { body: 'forbidden', status: 403 },
  } });
  await assert.rejects(collectEfhub({ ...collectOptions, output: f.output, fetchImpl: network.fetchImpl }));
  assert.equal(await readFile(f.output, 'utf8'), previous);
  assert.equal(network.requested.length, 3);
  assert.deepEqual(await readdir(dirname(f.output)), ['efhub.json']);
});

test('검증된 수집만 원자적으로 출력하고 전체 수집으로 표시하지 않는다', async (t) => {
  const f = await outputFixture(t);
  const network = mockFetch({ list: packList([packs[0]]), details: {
    'test-pack-one': { body: flightHtml([players], { split: true }) },
  } });
  const result = await collectEfhub({ ...collectOptions, maxProducts: 1, output: f.output, fetchImpl: network.fetchImpl });
  assert.equal(result.scope.complete, false);
  assert.equal(typeof result.scope.description, 'string');
  assert.equal(result.products.length, 1);
  assert.deepEqual(result.products[0].players_payload, players);
  assert.ok(result.observations.length >= 2);
  assert.deepEqual(JSON.parse(await readFile(f.output, 'utf8')), result);
  assert.deepEqual(await readdir(dirname(f.output)), ['efhub.json']);
});

test('요청 예산을 넘기기 전에 중단하고 추가 네트워크 요청을 만들지 않는다', async () => {
  const network = mockFetch({ list: packList([packs[0]]), details: {
    'test-pack-one': { body: flightHtml([players]) },
  } });
  await assert.rejects(collectEfhub({ ...collectOptions, maxProducts: 1, requestBudget: 1, fetchImpl: network.fetchImpl }));
  assert.equal(network.requested.length, 1);
});

test('같은 상품의 카드 목록이 줄어들면 일치하는 응답이어도 기존 관측을 보존한다', async (t) => {
  const f = await outputFixture(t);
  const first = mockFetch({ list: packList([packs[0]]), details: {
    'test-pack-one': { body: flightHtml([players]) },
  } });
  await collectEfhub({ ...collectOptions, maxProducts: 1, output: f.output, fetchImpl: first.fetchImpl });
  const previous = await readFile(f.output, 'utf8');
  const fewer = mockFetch({ list: packList([{ ...packs[0], playerCount: 1 }]), details: {
    'test-pack-one': { body: flightHtml([[players[0]]]) },
  } });
  await assert.rejects(collectEfhub({ ...collectOptions, maxProducts: 1, output: f.output, fetchImpl: fewer.fetchImpl }), /기존에 확보한 상품 카드가 빠졌습니다/);
  assert.equal(await readFile(f.output, 'utf8'), previous);
});
