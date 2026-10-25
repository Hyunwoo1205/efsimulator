import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { runAudit } from '../scripts/audit-cards.mjs';

const fixedNow = () => '2026-10-25T07:00:00.000Z';
const baseOptions = {
  preferredLimit: 2,
  intervalMs: 0,
  requestBudget: 20,
  imageSampleSize: 0,
  now: fixedNow,
  sleep: async () => {},
  onProgress: () => {},
};

function card(id, playerType = 5) {
  return {
    id,
    name: `선수 ${id}`,
    imageUrl: `https://efimg.com/efootballhub22/images/player_cards/${id}_l.png`,
    overallRating: 86,
    playerType,
  };
}

function page(number, players, total, limit = 2) {
  return { players, total, page: number, limit, totalPages: Math.ceil(total / limit) };
}

function jsonResponse(payload, options = {}) {
  return new Response(JSON.stringify(payload), {
    status: options.status ?? 200,
    headers: { 'content-type': 'application/json', ...options.headers },
  });
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'efsimulator-card-audit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    artifactDir: join(root, 'artifacts'),
    summaryPath: join(root, 'research', 'card-api-audit.json'),
  };
}

function network(handler) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      const request = { url, method: options.method ?? 'GET', options };
      calls.push(request);
      return handler(request, calls.length);
    },
  };
}

async function previousSummary(f) {
  const body = '{"status":"complete","complete":true,"last_good":"preserve-byte-for-byte"}\n';
  await mkdir(dirname(f.summaryPath), { recursive: true });
  await writeFile(f.summaryPath, body);
  return body;
}

async function artifactSnapshot(f, pages = [1]) {
  const paths = [
    join(f.artifactDir, 'state.json'),
    ...pages.map(number => join(f.artifactDir, 'pages', `${number}.json`)),
    f.summaryPath,
    join(f.artifactDir, 'latest-summary.json'),
  ];
  return new Map(await Promise.all(paths.map(async path => [path, await readFile(path, 'utf8')])));
}

async function assertSnapshotPreserved(snapshot) {
  for (const [path, body] of snapshot) assert.equal(await readFile(path, 'utf8'), body, path);
}

test('모든 페이지와 마지막 개수·고유 카드 수를 대조하고 원본 문자열 ID를 보존한다', async (t) => {
  const f = await fixture(t);
  const players = [card('00012345678901234567890'), card('900719925474099312345'), card('00003')];
  const n = network(({ url }) => jsonResponse(Number(url.searchParams.get('page')) === 1
    ? page(1, players.slice(0, 2), 3)
    : page(2, players.slice(2), 3)));
  const { summary } = await runAudit({ ...baseOptions, ...f, fetchImpl: n.fetchImpl });

  assert.equal(summary.complete, true);
  assert.equal(summary.status, 'complete');
  assert.equal(summary.source.reported_total, 3);
  assert.equal(summary.source.total_stable, true);
  assert.equal(summary.pages.visited_count, 2);
  assert.equal(summary.pages.expected_count, 2);
  assert.equal(summary.pages.last_page, 2);
  assert.equal(summary.pages.last_page_count, 1);
  assert.deepEqual(summary.pages.missing, []);
  assert.equal(summary.cards.raw_count, 3);
  assert.equal(summary.cards.unique_ids_count, 3);
  assert.equal(summary.cards.missing_count, 0);
  assert.deepEqual(summary.cards.duplicates, []);
  assert.equal(n.calls.length, 2);
  assert.deepEqual(JSON.parse(await readFile(f.summaryPath, 'utf8')), summary);
  const rawPage = JSON.parse(await readFile(join(f.artifactDir, 'pages', '1.json'), 'utf8'));
  assert.equal(rawPage.players[0].id, '00012345678901234567890');
  assert.equal(rawPage.players[1].id, '900719925474099312345');
});

test('요청 limit100을 무시한 응답은 실제 limit24로 협상하고 다음 페이지부터 그대로 따른다', async (t) => {
  const f = await fixture(t);
  const first = Array.from({ length: 24 }, (_, i) => card(String(i + 1)));
  const n = network(({ url }) => jsonResponse(Number(url.searchParams.get('page')) === 1
    ? page(1, first, 25, 24)
    : page(2, [card('25')], 25, 24)));
  const { summary } = await runAudit({ ...baseOptions, ...f, preferredLimit: 100, fetchImpl: n.fetchImpl });

  assert.equal(n.calls[0].url.searchParams.get('limit'), '100');
  assert.equal(n.calls[1].url.searchParams.get('limit'), null);
  assert.equal(n.calls[1].url.searchParams.get('page'), '2');
  assert.equal(summary.source.negotiated_limit, 24);
  assert.equal(summary.cards.unique_ids_count, 25);
  assert.equal(summary.complete, true);
});

test('일반UI의24개 목록 모드는 첫 요청에 쿼리가 없고 다음 요청도 page만 사용한다', async (t) => {
  const f = await fixture(t);
  const first = Array.from({ length: 24 }, (_, i) => card(String(i + 1)));
  const n = network(({ url }) => jsonResponse(Number(url.searchParams.get('page') ?? 1) === 1
    ? page(1, first, 25, 24)
    : page(2, [card('25')], 25, 24)));
  const { summary } = await runAudit({ ...baseOptions, ...f, preferredLimit: 24, fetchImpl: n.fetchImpl });

  assert.equal(summary.complete, true);
  assert.equal(n.calls[0].url.href, 'https://efhub.com/api/public/players');
  assert.equal(n.calls[1].url.href, 'https://efhub.com/api/public/players?page=2');
  assert.equal(summary.source.negotiated_limit, 24);
  assert.equal(summary.cards.unique_ids_count, 25);
});

test('페이지 수·행 수가 맞아도 중복 ID와 실제 부족한 고유 카드를 완료로 승격하지 않는다', async (t) => {
  const f = await fixture(t);
  const n = network(({ url }) => jsonResponse(Number(url.searchParams.get('page')) === 1
    ? page(1, [card('1'), card('2')], 3)
    : page(2, [card('2')], 3)));
  const { summary } = await runAudit({ ...baseOptions, ...f, fetchImpl: n.fetchImpl });

  assert.equal(summary.complete, false);
  assert.equal(summary.status, 'blocked');
  assert.equal(summary.cards.raw_count, 3);
  assert.equal(summary.cards.unique_ids_count, 2);
  assert.equal(summary.cards.missing_count, 1);
  assert.ok(summary.cards.duplicates.some(item => item.id === '2'));
});

test('중간 페이지에서 출처 총계가 바뀌면 같은 수집 시점의 완전 목록으로 인정하지 않는다', async (t) => {
  const f = await fixture(t);
  const n = network(({ url }) => jsonResponse(Number(url.searchParams.get('page')) === 1
    ? page(1, [card('1'), card('2')], 3)
    : page(2, [card('3'), card('4')], 4)));
  const { summary } = await runAudit({ ...baseOptions, ...f, fetchImpl: n.fetchImpl });

  assert.equal(summary.complete, false);
  assert.equal(summary.status, 'blocked');
  assert.equal(summary.source.total_stable, false);
  assert.equal(summary.source.reported_total, 3);
  assert.ok(summary.errors.length > 0);
  assert.match(await readFile(join(f.artifactDir, 'pages', '1.json'), 'utf8'), /"1"/);
});

test('403은 즉시 중단해 정상 summary와 성공 페이지를 보존하고 resume으로 재시도하지 않는다', async (t) => {
  const f = await fixture(t);
  const previous = await previousSummary(f);
  const n = network(({ url }) => Number(url.searchParams.get('page')) === 1
    ? jsonResponse(page(1, [card('1'), card('2')], 3))
    : new Response('Forbidden', { status: 403 }));
  const { summary } = await runAudit({ ...baseOptions, ...f, fetchImpl: n.fetchImpl });

  assert.equal(summary.status, 'blocked');
  assert.equal(summary.complete, false);
  assert.equal(n.calls.length, 2);
  assert.equal(await readFile(f.summaryPath, 'utf8'), previous);
  assert.ok(JSON.parse(await readFile(join(f.artifactDir, 'state.json'), 'utf8')));
  assert.equal(JSON.parse(await readFile(join(f.artifactDir, 'latest-summary.json'), 'utf8')).complete, false);
  assert.match(await readFile(join(f.artifactDir, 'pages', '1.json'), 'utf8'), /"1"/);

  const resumed = network(() => { throw new Error('A terminal403 must not be retried by resume'); });
  const result = await runAudit({ ...baseOptions, ...f, resume: true, fetchImpl: resumed.fetchImpl });
  assert.equal(result.summary.complete, false);
  assert.equal(resumed.calls.length, 0);
  assert.equal(await readFile(f.summaryPath, 'utf8'), previous);
});

test('첫 요청403으로 카드 관측이0개이면 총계 안정성과 이미지 표본을 검증 완료로 표시하지 않는다', async (t) => {
  const f = await fixture(t);
  const n = network(() => new Response('Forbidden', { status: 403 }));
  const { summary } = await runAudit({ ...baseOptions, ...f, imageSampleSize: 30, fetchImpl: n.fetchImpl });

  assert.equal(n.calls.length, 1);
  assert.equal(summary.status, 'blocked');
  assert.equal(summary.complete, false);
  assert.equal(summary.pages.visited_count, 0);
  assert.equal(summary.cards.unique_ids_count, 0);
  assert.equal(summary.source.total_stable, null);
  assert.equal(summary.image_validation.requested_samples, 30);
  assert.equal(summary.image_validation.checked_samples, 0);
  assert.equal(summary.image_validation.complete, false);
});

test('JSON이나 응답 계약이 손상된 페이지는 성공 원본과 기존 정상 summary를 덮지 않는다', async (t) => {
  const f = await fixture(t);
  const previous = await previousSummary(f);
  const n = network(({ url }) => Number(url.searchParams.get('page')) === 1
    ? jsonResponse(page(1, [card('1'), card('2')], 3))
    : new Response('{not-json', { headers: { 'content-type': 'application/json' } }));
  const { summary } = await runAudit({ ...baseOptions, ...f, fetchImpl: n.fetchImpl });

  assert.equal(summary.status, 'blocked');
  assert.equal(summary.complete, false);
  assert.equal(n.calls.length, 2);
  assert.ok(summary.errors.length > 0);
  assert.equal(await readFile(f.summaryPath, 'utf8'), previous);
  assert.match(await readFile(join(f.artifactDir, 'pages', '1.json'), 'utf8'), /"1"/);
});

test('요청 예산 소진은 체크포인트를 남기고 늘린 예산의 resume은 성공 페이지를 다시 받지 않는다', async (t) => {
  const f = await fixture(t);
  const firstNetwork = network(() => jsonResponse(page(1, [card('1'), card('2')], 3)));
  const first = await runAudit({ ...baseOptions, ...f, requestBudget: 1, fetchImpl: firstNetwork.fetchImpl });
  assert.equal(first.summary.status, 'paused');
  assert.equal(first.summary.complete, false);
  assert.equal(firstNetwork.calls.length, 1);
  const before = await readFile(join(f.artifactDir, 'pages', '1.json'), 'utf8');

  const nextNetwork = network(({ url }) => {
    assert.equal(url.searchParams.get('page'), '2');
    return jsonResponse(page(2, [card('3')], 3));
  });
  const second = await runAudit({ ...baseOptions, ...f, requestBudget: 3, resume: true, fetchImpl: nextNetwork.fetchImpl });
  assert.equal(second.summary.complete, true);
  assert.equal(nextNetwork.calls.length, 1);
  assert.equal(second.summary.requests.count, 2);
  assert.equal(await readFile(join(f.artifactDir, 'pages', '1.json'), 'utf8'), before);
});

test('재개 전에 저장된 페이지의 해시가 달라졌으면 새 요청 없이 검증 실패로 남긴다', async (t) => {
  const f = await fixture(t);
  const n = network(() => jsonResponse(page(1, [card('1'), card('2')], 3)));
  await runAudit({ ...baseOptions, ...f, requestBudget: 1, fetchImpl: n.fetchImpl });
  const pagePath = join(f.artifactDir, 'pages', '1.json');
  await writeFile(pagePath, JSON.stringify(page(1, [card('1'), card('changed')], 3)));

  const resumed = network(() => { throw new Error('Corrupt checkpoint must not perform network work'); });
  const { summary } = await runAudit({ ...baseOptions, ...f, resume: true, fetchImpl: resumed.fetchImpl });
  assert.equal(summary.complete, false);
  assert.equal(summary.status, 'blocked');
  assert.equal(resumed.calls.length, 0);
});

test('Retry-After가60초를 넘으면 긴 대기를 실행하지 않고 paused 상태로 저장한다', async (t) => {
  const f = await fixture(t);
  const waits = [];
  const n = network(() => new Response('Too Many Requests', { status: 429, headers: { 'retry-after': '61' } }));
  const { summary } = await runAudit({ ...baseOptions, ...f, fetchImpl: n.fetchImpl, sleep: async ms => waits.push(ms) });

  assert.equal(summary.complete, false);
  assert.equal(summary.status, 'paused');
  assert.equal(n.calls.length, 1);
  assert.ok(waits.every(ms => ms <= 60_000));
});

test('일시적인503은 한정 백오프 뒤 복구할 수 있고 모든 실제 요청을 예산에 포함한다', async (t) => {
  const f = await fixture(t);
  const waits = [];
  const n = network((_request, index) => index === 1
    ? new Response('unavailable', { status: 503 })
    : jsonResponse(page(1, [card('1')], 1)));
  const { summary } = await runAudit({ ...baseOptions, ...f, fetchImpl: n.fetchImpl, sleep: async ms => waits.push(ms) });

  assert.equal(summary.complete, true);
  assert.equal(n.calls.length, 2);
  assert.equal(summary.requests.count, 2);
  assert.ok(waits.some(ms => ms > 0));
  assert.ok(waits.every(ms => ms <= 60_000));
});

test('부정확한 숫자 카드 ID를 원본 문자열인 것처럼 변환하여 완료하지 않는다', async (t) => {
  const f = await fixture(t);
  const n = network(() => new Response('{"players":[{"id":900719925474099312345,"name":"unsafe","overallRating":86,"playerType":5,"imageUrl":"https://efimg.com/unsafe.png"}],"total":1,"page":1,"limit":2,"totalPages":1}', {
    headers: { 'content-type': 'application/json' },
  }));
  const { summary } = await runAudit({ ...baseOptions, ...f, fetchImpl: n.fetchImpl });
  assert.equal(summary.complete, false);
  assert.equal(summary.status, 'blocked');
  assert.equal(n.calls.length, 1);
});

test('이미지는 카드 유형을 나눠 표본을 고르고 실제 GET의 MIME·크기를 검증한다', async (t) => {
  const f = await fixture(t);
  const cards = [card('1', 5), card('2', 5), card('3', 5), card('4', 8)];
  const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWQAAAABJRU5ErkJggg==', 'base64');
  const n = network(({ url, method }) => {
    if (url.hostname === 'efhub.com') {
      const number = Number(url.searchParams.get('page'));
      return jsonResponse(page(number, cards.slice((number - 1) * 2, number * 2), 4));
    }
    if (method === 'HEAD') return new Response(null, { status: 405 });
    return new Response(imageBytes, { headers: { 'content-type': 'image/png', 'content-length': String(imageBytes.length) } });
  });
  const { summary } = await runAudit({ ...baseOptions, ...f, imageSampleSize: 2, fetchImpl: n.fetchImpl });
  const checked = n.calls.filter(call => call.url.hostname === 'efimg.com' && call.method === 'GET');
  const types = new Set(checked.map(call => cards.find(item => call.url.pathname.endsWith(`/${item.id}_l.png`))?.playerType));

  assert.equal(summary.complete, true);
  assert.equal(summary.image_validation.checked_samples, 2);
  assert.equal(summary.image_validation.results.length, 2);
  assert.equal(checked.length, 2);
  assert.deepEqual(types, new Set([5, 8]));
  assert.ok(Object.hasOwn(summary.cards.field_coverage, 'background_asset'));
  assert.ok(Object.hasOwn(summary.cards.field_coverage, 'version_links'));
});

test('성공한 raw페이지 저장과 체크포인트 사이에 중단되어도 같은 페이지 파일을 안전하게 재개한다', async (t) => {
  const f = await fixture(t);
  const first = network(() => jsonResponse(page(1, [card('1'), card('2')], 3)));
  await runAudit({ ...baseOptions, ...f, requestBudget: 1, fetchImpl: first.fetchImpl });
  // A process may die after persisting page2 but before adding it to state.pages.
  const orphanPath = join(f.artifactDir, 'pages', '2.json');
  const orphanRaw = JSON.stringify(page(2, [card('3')], 3));
  await writeFile(orphanPath, orphanRaw);
  const resumed = network(({ url }) => {
    assert.equal(url.searchParams.get('page'), '2');
    return jsonResponse(page(2, [card('3')], 3));
  });
  const { summary } = await runAudit({ ...baseOptions, ...f, requestBudget: 5, resume: true, fetchImpl: resumed.fetchImpl });

  assert.equal(summary.complete, true);
  assert.equal(summary.pages.visited_count, 2);
  assert.equal(summary.cards.unique_ids_count, 3);
  assert.equal(await readFile(orphanPath, 'utf8'), orphanRaw);
  assert.ok(resumed.calls.every(call => call.url.searchParams.get('page') !== '1'));
});

test('체크포인트에 없는 raw페이지가 새 검증 응답과 다르면 원본과 정상 summary를 보존한다', async (t) => {
  const f = await fixture(t);
  const previous = await previousSummary(f);
  const first = network(() => jsonResponse(page(1, [card('1'), card('2')], 3)));
  await runAudit({ ...baseOptions, ...f, requestBudget: 1, fetchImpl: first.fetchImpl });
  const orphanPath = join(f.artifactDir, 'pages', '2.json');
  const orphanRaw = JSON.stringify(page(2, [card('333')], 3));
  await writeFile(orphanPath, orphanRaw);
  const resumed = network(({ url }) => {
    assert.equal(url.searchParams.get('page'), '2');
    return jsonResponse(page(2, [card('3')], 3));
  });
  const { summary } = await runAudit({ ...baseOptions, ...f, requestBudget: 5, resume: true, fetchImpl: resumed.fetchImpl });

  assert.equal(summary.complete, false);
  assert.equal(summary.status, 'blocked');
  assert.equal(await readFile(orphanPath, 'utf8'), orphanRaw);
  assert.equal(await readFile(f.summaryPath, 'utf8'), previous);
});

test('503 재시도를 끝까지 소진한 요청을 복구 성공으로 기록하지 않는다', async (t) => {
  const f = await fixture(t);
  const n = network(() => new Response('still unavailable', { status: 503 }));
  const { summary } = await runAudit({ ...baseOptions, ...f, fetchImpl: n.fetchImpl });

  assert.equal(summary.complete, false);
  assert.equal(summary.status, 'paused');
  assert.equal(n.calls.length, 4);
  const failures = summary.errors.filter(error => error.code === 'http_503');
  assert.equal(failures.length, 4);
  assert.ok(failures.every(error => error.recovered === false));
});

test('마지막 페이지가 예상 개수보다 짧으면 source총계가 맞아도 완료하지 않는다', async (t) => {
  const f = await fixture(t);
  const n = network(({ url }) => jsonResponse(Number(url.searchParams.get('page')) === 1
    ? page(1, [card('1'), card('2')], 3)
    : page(2, [], 3)));
  const { summary } = await runAudit({ ...baseOptions, ...f, fetchImpl: n.fetchImpl });

  assert.equal(summary.complete, false);
  assert.equal(summary.status, 'blocked');
  assert.equal(summary.pages.visited_count, 1);
  assert.ok(summary.errors.some(error => error.code === 'page_count_mismatch'));
});

test('HTTP200·image MIME이라도 본문이 이미지가 아니면 기존 정상 summary를 보존한다', async (t) => {
  const f = await fixture(t);
  const previous = await previousSummary(f);
  const n = network(({ url }) => url.hostname === 'efhub.com'
    ? jsonResponse(page(1, [card('1')], 1))
    : new Response('<html>not an image</html>', { headers: { 'content-type': 'image/png' } }));
  const { summary } = await runAudit({ ...baseOptions, ...f, imageSampleSize: 1, fetchImpl: n.fetchImpl });

  assert.equal(summary.complete, false);
  assert.equal(summary.status, 'blocked');
  assert.equal(summary.pages.pagination_complete, true);
  assert.equal(summary.image_validation.complete, false);
  assert.equal(summary.image_validation.results[0].valid, false);
  assert.equal(await readFile(f.summaryPath, 'utf8'), previous);
});

test('음수 요청 카운터가 든 체크포인트는 재개 전 거부하고 원본 파일을 보존한다', async (t) => {
  const f = await fixture(t);
  const previous = await previousSummary(f);
  const first = network(() => jsonResponse(page(1, [card('1'), card('2')], 5)));
  await runAudit({ ...baseOptions, ...f, requestBudget: 1, fetchImpl: first.fetchImpl });
  const statePath = join(f.artifactDir, 'state.json');
  const rawPath = join(f.artifactDir, 'pages', '1.json');
  const latestPath = join(f.artifactDir, 'latest-summary.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  state.request_count = -5;
  const corruptedBytes = `${JSON.stringify(state, null, 2)}\n`;
  await writeFile(statePath, corruptedBytes);
  const rawBefore = await readFile(rawPath, 'utf8');
  const latestBefore = await readFile(latestPath, 'utf8');
  const resumed = network(({ url }) => {
    const number = Number(url.searchParams.get('page'));
    return jsonResponse(number === 2
      ? page(2, [card('3'), card('4')], 5)
      : page(3, [card('5')], 5));
  });
  const operation = runAudit({ ...baseOptions, ...f, requestBudget: 1, resume: true, fetchImpl: resumed.fetchImpl }).then(result => {
    t.diagnostic(JSON.stringify({ unexpected_complete: result.summary.complete, resumed_mock_calls: resumed.calls.length, request_count: result.summary.requests.count, request_log_length: result.summary.requests.log.length }));
    return result;
  });

  await assert.rejects(operation, error => error.code === 'invalid_checkpoint');
  assert.equal(resumed.calls.length, 0);
  assert.equal(await readFile(statePath, 'utf8'), corruptedBytes);
  assert.equal(await readFile(rawPath, 'utf8'), rawBefore);
  assert.equal(await readFile(f.summaryPath, 'utf8'), previous);
  assert.equal(await readFile(latestPath, 'utf8'), latestBefore);
});

test('손상된 체크포인트 메타데이터는 네트워크·파일 변경 전에 거부한다', async (t) => {
  const cases = [
    ['정수가 아닌 요청 수', state => { state.request_count = 1.5; }],
    ['요청 수와 로그 길이 불일치', state => { state.request_count = 3; }],
    ['허용 출처와 다른 요청 URL', state => { state.request_log[0].url = 'https://example.invalid/players?page=1'; }],
    ['잘못된 HTTP 상태 자료형', state => { state.request_log[0].status = '200'; }],
    ['알 수 없는 요청 종류', state => { state.request_log[0].kind = 'unknown'; }],
    ['요청 로그의 잘못된 페이지', state => { state.request_log[0].page = 0; }],
    ['음수 재시도 번호', state => { state.request_log[0].attempt = -1; }],
    ['요청 로그의 잘못된 관찰 시각', state => { state.request_log[0].observed_at = 'not-a-date'; }],
    ['저장 페이지 번호의 빈 구간', state => { delete state.pages['1']; }],
    ['저장 페이지의 잘못된 카드 수', state => { state.pages['1'].count = 999; }],
    ['저장 페이지와 다른 URL 페이지', state => { state.pages['1'].url = 'https://efhub.com/api/public/players?page=99&limit=2'; }],
    ['저장 페이지의 잘못된 관찰 시각', state => { state.pages['1'].observed_at = 'not-a-date'; }],
    ['저장 페이지 해시의 잘못된 형식', state => { state.pages['1'].sha256 = 'not-a-sha256'; }],
    ['다음 페이지 건너뛰기', state => { state.next_page = 4; }],
    ['다음 페이지 되감기', state => { state.next_page = 2; }],
    ['알 수 없는 실행 상태', state => { state.status = 'invalid-status'; }],
    ['일부 페이지만 저장된 complete 상태', state => { state.status = 'complete'; }],
    ['음수 출처 총계', state => { state.expected_total = -1; }],
    ['0인 협상 페이지 크기', state => { state.negotiated_limit = 0; }],
    ['출처 총계와 다른 페이지 총수', state => { state.expected_total_pages = 99; }],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, async (subtest) => {
      const f = await fixture(subtest);
      await previousSummary(f);
      const initial = network(({ url }) => Number(url.searchParams.get('page')) === 1
        ? jsonResponse(page(1, [card('1'), card('2')], 5))
        : jsonResponse(page(2, [card('3'), card('4')], 5)));
      const baseline = await runAudit({ ...baseOptions, ...f, requestBudget: 2, fetchImpl: initial.fetchImpl });
      assert.equal(baseline.summary.status, 'paused');
      assert.equal(baseline.summary.pages.visited_count, 2);
      const statePath = join(f.artifactDir, 'state.json');
      const state = JSON.parse(await readFile(statePath, 'utf8'));
      mutate(state);
      await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
      const paths = [
        statePath,
        join(f.artifactDir, 'pages', '1.json'),
        join(f.artifactDir, 'pages', '2.json'),
        f.summaryPath,
        join(f.artifactDir, 'latest-summary.json'),
      ];
      const before = new Map(await Promise.all(paths.map(async path => [path, await readFile(path, 'utf8')])));
      const resumed = network(() => { throw new Error('Invalid metadata must fail before network'); });

      await assert.rejects(
        runAudit({ ...baseOptions, ...f, requestBudget: 2, resume: true, fetchImpl: resumed.fetchImpl }),
        error => error.code === 'invalid_checkpoint',
      );
      assert.equal(resumed.calls.length, 0);
      for (const [path, body] of before) assert.equal(await readFile(path, 'utf8'), body, `${name}: ${path}`);
    });
  }
});

test('첫200응답을 기록한 직후 baseline 등록 전에 중단됐어도 원본을 보존하며 재개한다', async (t) => {
  const f = await fixture(t);
  const firstPayload = page(1, [card('1'), card('2')], 3);
  const initial = network(() => jsonResponse(firstPayload));
  await runAudit({ ...baseOptions, ...f, requestBudget: 1, fetchImpl: initial.fetchImpl });
  const statePath = join(f.artifactDir, 'state.json');
  const rawPath = join(f.artifactDir, 'pages', '1.json');
  const rawBefore = await readFile(rawPath, 'utf8');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  state.status = 'running';
  state.expected_total = null;
  state.expected_total_pages = null;
  state.negotiated_limit = null;
  state.total_stable = true;
  state.pages = {};
  state.next_page = 1;
  state.errors = [];
  assert.equal(state.request_count, 1);
  assert.equal(state.request_log.length, 1);
  assert.equal(state.request_log[0].status, 200);
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  const resumed = network(({ url }) => Number(url.searchParams.get('page') ?? 1) === 1
    ? jsonResponse(firstPayload)
    : jsonResponse(page(2, [card('3')], 3)));

  const { summary } = await runAudit({ ...baseOptions, ...f, requestBudget: 5, resume: true, fetchImpl: resumed.fetchImpl });
  assert.equal(summary.complete, true);
  assert.equal(summary.pages.visited_count, 2);
  assert.equal(summary.cards.unique_ids_count, 3);
  assert.equal(await readFile(rawPath, 'utf8'), rawBefore);
});

test('기록한 요청 수보다 작은 새 예산은 정상 paused이며 예산을 늘린 후 이어서 재개한다', async (t) => {
  const f = await fixture(t);
  const initial = network(({ url }) => Number(url.searchParams.get('page')) === 1
    ? jsonResponse(page(1, [card('1'), card('2')], 5))
    : jsonResponse(page(2, [card('3'), card('4')], 5)));
  const first = await runAudit({ ...baseOptions, ...f, requestBudget: 2, fetchImpl: initial.fetchImpl });
  assert.equal(first.summary.status, 'paused');
  assert.equal(first.summary.requests.count, 2);
  const noNetwork = network(() => { throw new Error('A lowered exhausted budget must pause before network'); });
  const lower = await runAudit({ ...baseOptions, ...f, requestBudget: 1, resume: true, fetchImpl: noNetwork.fetchImpl });
  assert.equal(lower.summary.status, 'paused');
  assert.equal(lower.summary.requests.count, 2);
  assert.equal(lower.summary.requests.budget, 1);
  assert.equal(noNetwork.calls.length, 0);
  const resumed = network(({ url }) => {
    assert.equal(url.searchParams.get('page'), '3');
    return jsonResponse(page(3, [card('5')], 5));
  });

  const { summary } = await runAudit({ ...baseOptions, ...f, requestBudget: 4, resume: true, fetchImpl: resumed.fetchImpl });
  assert.equal(summary.complete, true);
  assert.equal(summary.cards.unique_ids_count, 5);
  assert.equal(summary.requests.count, 3);
  assert.equal(resumed.calls.length, 1);
});

test('빈200 JSON 응답으로 중단한 정상 체크포인트는 재요청 없이 원본을 보존한다', async (t) => {
  const f = await fixture(t);
  await previousSummary(f);
  const n = network(({ url }) => Number(url.searchParams.get('page')) === 1
    ? jsonResponse(page(1, [card('1'), card('2')], 3))
    : new Response('', { headers: { 'content-type': 'application/json' } }));
  const first = await runAudit({ ...baseOptions, ...f, fetchImpl: n.fetchImpl });
  assert.equal(first.summary.status, 'blocked');
  assert.equal(first.summary.complete, false);
  assert.equal(first.summary.requests.log.at(-1).response_bytes, 0);
  const before = await artifactSnapshot(f);
  const resumed = network(() => { throw new Error('A blocked empty JSON response must not be retried'); });

  const result = await runAudit({ ...baseOptions, ...f, resume: true, fetchImpl: resumed.fetchImpl });
  assert.equal(result.summary.status, 'blocked');
  assert.equal(result.summary.complete, false);
  assert.equal(resumed.calls.length, 0);
  await assertSnapshotPreserved(before);
});

test('빈200 이미지 응답의 bytes0·validfalse 기록은 재개 시 손상으로 오인하지 않는다', async (t) => {
  const f = await fixture(t);
  await previousSummary(f);
  const n = network(({ url }) => url.hostname === 'efhub.com'
    ? jsonResponse(page(1, [card('1')], 1))
    : new Response(new Uint8Array(0), { headers: { 'content-type': 'image/png' } }));
  const first = await runAudit({ ...baseOptions, ...f, imageSampleSize: 1, fetchImpl: n.fetchImpl });
  assert.equal(first.summary.status, 'blocked');
  assert.equal(first.summary.image_validation.results[0].bytes, 0);
  assert.equal(first.summary.image_validation.results[0].valid, false);
  const before = await artifactSnapshot(f);
  const resumed = network(() => { throw new Error('A blocked empty image response must not be retried'); });

  const result = await runAudit({ ...baseOptions, ...f, imageSampleSize: 1, resume: true, fetchImpl: resumed.fetchImpl });
  assert.equal(result.summary.status, 'blocked');
  assert.equal(result.summary.complete, false);
  assert.equal(resumed.calls.length, 0);
  await assertSnapshotPreserved(before);
});

for (const [label, primitive] of [['null', null], ['false', false], ['0', 0], ['text 문자열', 'text']]) {
  test(`체크포인트가 ${label} 리터럴이면 누락 파일로 취급하지 않고 원본을 보존하며 거부한다`, async (t) => {
    const f = await fixture(t);
    await previousSummary(f);
    const initial = network(() => jsonResponse(page(1, [card('1'), card('2')], 3)));
    const first = await runAudit({ ...baseOptions, ...f, requestBudget: 1, fetchImpl: initial.fetchImpl });
    assert.equal(first.summary.status, 'paused');
    await writeFile(join(f.artifactDir, 'state.json'), `${JSON.stringify(primitive)}\n`);
    const before = await artifactSnapshot(f);
    const resumed = network(() => { throw new Error('Primitive checkpoint must fail before network'); });

    await assert.rejects(
      runAudit({ ...baseOptions, ...f, resume: true, fetchImpl: resumed.fetchImpl }),
      error => error.code === 'invalid_checkpoint',
    );
    assert.equal(resumed.calls.length, 0);
    await assertSnapshotPreserved(before);
  });
}
