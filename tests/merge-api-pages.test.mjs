import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cli = fileURLToPath(new URL('../scripts/merge-api-pages.mjs', import.meta.url));
const previousOutput = '{"last_good":"기존 파일을 그대로 보존"}\n';

function page(kind, number, items, total, limit = 2, extra = {}) {
  return JSON.stringify({ [kind]: items, total, page: number, limit, ...extra });
}

async function fixture(t, files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'efsimulator-merge-pages-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const inputDir = join(root, 'input');
  await mkdir(inputDir);
  const inputs = new Map();
  for (const [name, body] of Object.entries(files)) {
    const path = join(inputDir, name);
    await writeFile(path, body);
    inputs.set(path, Buffer.from(body));
  }
  return { root, inputDir, output: join(root, 'merged.json'), report: join(root, 'report.json'), inputs };
}

function run(f, { kind = 'players', extra = [], nodeArgs = [], output = f.output, report = f.report } = {}) {
  const result = spawnSync(process.execPath, [...nodeArgs, cli, '--kind', kind, '--input-dir', f.inputDir,
    '--output', output, '--report', report, ...extra], {
    cwd: f.root, encoding: 'utf8', timeout: 10_000, maxBuffer: 1_000_000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return result;
}

async function assertInputsPreserved(f) {
  for (const [path, bytes] of f.inputs) assert.deepEqual(await readFile(path), bytes, path);
}

async function failure(t, files, options = {}, code) {
  const f = await fixture(t, files);
  await writeFile(f.output, previousOutput);
  const result = run(f, options);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(await readFile(f.output, 'utf8'), previousOutput);
  await assertInputsPreserved(f);
  const report = JSON.parse(await readFile(f.report, 'utf8'));
  assert.equal(report.complete, false);
  assert.ok(report.errors.length > 0);
  if (code) assert.ok(report.errors.some(error => error.code === code), JSON.stringify(report.errors));
  return { f, report };
}

test('파일명 대신 페이지 메타데이터 순서로 병합하고 모든 항목의 원문 필드를 보존한다', async (t) => {
  const records = [
    '{"id":"00042","name":"선수 \\"A\\"","overall":null,"types":[5,8],"total":777,"unknown":{"nested":[null,{"large":9007199254740993123456789,"roundedFloat":1.0000000000000001,"negativeZero":-0,"exponent":6.022e+23,"small":1e-007}]}}',
    '{"id":"900719925474099312340","name":"두 번째","unknown":[[],{},true,false,"\\uD55C"]}',
    '{"id":900719925474099312345,"name":"숫자 ID A","unknown":null}',
    '{"id":900719925474099312346,"name":"숫자 ID B","unknown":{"total":999,"page":999}}',
  ];
  const rawPage = (number, items) => `{"players":[${items.join(',')}],"total":4,"page":${number},"limit":2,"totalPages":2}`;
  const f = await fixture(t, {
    'a-second-page.json': rawPage(2, records.slice(2)),
    'z-first-page.json': rawPage(1, records.slice(0, 2)),
  });
  const result = run(f, { extra: ['--expected-total', '4', '--expected-pages', '2'] });
  assert.equal(result.status, 0, result.stderr);
  const output = await readFile(f.output, 'utf8');
  const parsed = JSON.parse(output);
  assert.equal(parsed.length, 4);
  assert.equal(parsed[0].id, '00042');
  assert.equal(parsed[1].id, '900719925474099312340');
  assert.deepEqual(parsed[0].types, [5, 8]);
  assert.equal(parsed[0].overall, null);
  assert.ok(Object.is(parsed[0].unknown.nested[1].negativeZero, -0));
  let previousIndex = -1;
  for (const raw of records) {
    const index = output.indexOf(raw);
    assert.ok(index > previousIndex, `원문 항목과 순서 보존: ${raw}`);
    previousIndex = index;
  }
  const report = JSON.parse(await readFile(f.report, 'utf8'));
  assert.equal(report.schema_version, 1);
  assert.equal(report.kind, 'players');
  assert.equal(report.id_field, 'id');
  assert.equal(report.complete, true);
  assert.equal(report.summary.rows, 4);
  assert.equal(report.summary.unique_ids, 4);
  assert.equal(report.summary.reported_total, 4);
  assert.equal(report.summary.reported_total_pages, 2);
  assert.deepEqual(report.pages.map(item => item.page), [1, 2]);
  assert.deepEqual(report.pages.map(item => item.rows), [2, 2]);
  assert.deepEqual(report.errors, []);
  await assertInputsPreserved(f);
});

test('packs는 totalPages 없이 hasMore 또는 total·page·limit만으로 전체 페이지를 대조한다', async (t) => {
  for (const withHasMore of [true, false]) await t.test(withHasMore ? 'hasMore 있음' : '두 선택 메타데이터 없음', async (st) => {
    const f = await fixture(st, {
      'later.json': page('packs', 2, [{ slug: 'c', id: '003', name: '세 번째' }], 3, 2, withHasMore ? { hasMore: false } : {}),
      'earlier.json': page('packs', 1, [{ slug: 'a', id: '001' }, { slug: 'b', id: '002' }], 3, 2, withHasMore ? { hasMore: true } : {}),
    });
    const result = run(f, { kind: 'packs' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(await readFile(f.output, 'utf8')).map(item => item.slug), ['a', 'b', 'c']);
    const report = JSON.parse(await readFile(f.report, 'utf8'));
    assert.equal(report.complete, true);
    assert.equal(report.id_field, 'slug');
    assert.equal(report.summary.rows, 3);
    assert.deepEqual(report.pages.map(item => item.rows), [2, 1]);
    await assertInputsPreserved(f);
  });
});

test('명시한 ID 필드를 쓰고 성공 결과·보고서는 재실행해도 동일하다', async (t) => {
  const f = await fixture(t, { 'one.json': page('packs', 1, [{ id: '0009', slug: 'bundle', unknown: { v: null } }], 1) });
  const options = { kind: 'packs', extra: ['--id-field', 'id'] };
  assert.equal(run(f, options).status, 0);
  const output = await readFile(f.output);
  const report = await readFile(f.report);
  assert.equal(JSON.parse(report).id_field, 'id');
  assert.equal(run(f, options).status, 0);
  assert.deepEqual(await readFile(f.output), output);
  assert.deepEqual(await readFile(f.report), report);
  await assertInputsPreserved(f);
});

test('중복 페이지·동일 또는 상충 ID·숫자와 문자열 ID 충돌을 거부한다', async (t) => {
  const cases = [
    ['페이지 중복', { 'a.json': page('players', 1, [{ id: 'a' }], 1), 'b.json': page('players', 1, [{ id: 'b' }], 1) }, {}, 'duplicate_page'],
    ['동일 항목 ID 중복', { 'a.json': page('players', 1, [{ id: 'a', name: '동일' }, { id: 'a', name: '동일' }], 2) }, {}, 'duplicate_id'],
    ['상충 항목 ID 중복', { 'a.json': page('players', 1, [{ id: 'a', name: '이전' }, { id: 'a', name: '변경' }], 2) }, {}, 'duplicate_id'],
    ['숫자 문자열 ID 충돌', { 'a.json': '{"players":[{"id":42},{"id":"42"}],"total":2,"page":1,"limit":2}' }, {}, 'duplicate_id'],
    ['상품의 보조 ID 중복', { 'a.json': page('packs', 1, [{ slug: 'a', id: '9' }, { slug: 'b', id: '9' }], 2) }, { kind: 'packs' }, 'duplicate_secondary_id'],
    ['ID 필드 변경 시 보조 slug 중복', { 'a.json': page('packs', 1, [{ id: '1', slug: 'same' }, { id: '2', slug: 'same' }], 2) }, { kind: 'packs', extra: ['--id-field', 'id'] }, 'duplicate_secondary_id'],
  ];
  for (const [name, files, options, code] of cases) await t.test(name, st => failure(st, files, options, code));
});

test('누락·메타데이터 불일치·마지막 페이지 개수·사용자 예상치가 맞지 않으면 출력하지 않는다', async (t) => {
  const first = page('players', 1, [{ id: 'a' }, { id: 'b' }], 3);
  const cases = [
    ['페이지 누락', { 'a.json': page('players', 1, [{ id: 'a' }, { id: 'b' }], 5), 'c.json': page('players', 3, [{ id: 'e' }], 5) }],
    ['전체 수 변경', { 'a.json': first, 'b.json': page('players', 2, [{ id: 'c' }], 4) }],
    ['limit 변경', { 'a.json': first, 'b.json': page('players', 2, [{ id: 'c' }], 3, 3) }],
    ['totalPages 변경', { 'a.json': page('players', 1, [{ id: 'a' }, { id: 'b' }], 3, 2, { totalPages: 2 }), 'b.json': page('players', 2, [{ id: 'c' }], 3, 2, { totalPages: 3 }) }],
    ['첫 페이지의 잘못된 hasMore', { 'a.json': page('players', 1, [{ id: 'a' }, { id: 'b' }], 3, 2, { hasMore: false }), 'b.json': page('players', 2, [{ id: 'c' }], 3, 2, { hasMore: false }) }],
    ['마지막 페이지의 잘못된 hasMore', { 'a.json': first, 'b.json': page('players', 2, [{ id: 'c' }], 3, 2, { hasMore: true }) }],
    ['마지막 페이지 초과', { 'a.json': first, 'b.json': page('players', 2, [{ id: 'c' }, { id: 'd' }], 3) }],
    ['마지막 페이지 부족', { 'a.json': first, 'b.json': page('players', 2, [], 3) }],
    ['사용자 예상 총수 불일치', { 'a.json': page('players', 1, [{ id: 'a' }], 1) }, ['--expected-total', '2']],
    ['사용자 예상 페이지 수 불일치', { 'a.json': page('players', 1, [{ id: 'a' }], 1) }, ['--expected-pages', '2']],
    ['메타데이터 없는 N파일+예상 N은 전체성 근거 아님', { 'a.json': '{"players":[{"id":"a"}]}', 'b.json': '{"players":[{"id":"b"}]}' }, ['--expected-total', '2', '--expected-pages', '2']],
  ];
  for (const [name, files, extra = []] of cases) await t.test(name, st => failure(st, files, { extra }));
});

test('정수로 반올림되는 소수·지수형 메타데이터도 원시 토큰으로 거부한다', async (t) => {
  const fields = ['total', 'page', 'limit', 'totalPages'];
  const cases = [...fields.map(field => [field, '1.0000000000000001']), ['total', '1e0']];
  for (const [field, raw] of cases) await t.test(`${field}: ${raw}`, async (st) => {
    const metadata = fields.map(name => `"${name}":${name === field ? raw : '1'}`).join(',');
    await failure(st, { 'one.json': `{"players":[{"id":"a"}],${metadata}}` });
  });
});

test('빈 자료·0총수·잘못된 JSON/root/ID를 완료로 판정하지 않는다', async (t) => {
  const cases = [
    ['입력 파일 없음', {}, 'empty_input'],
    ['빈 페이지와 총수 0', { 'a.json': page('players', 1, [], 0, 2, { totalPages: 0 }) }, 'empty_source'],
    ['표시 총수는 있지만 빈 자료', { 'a.json': page('players', 1, [], 1) }],
    ['총수 0인데 행 존재', { 'a.json': page('players', 1, [{ id: 'a' }], 0) }],
    ['잘린 JSON', { 'a.json': '{"players":[{"id":"a"}],' }, 'invalid_json'],
    ['root 배열', { 'a.json': '[{"id":"a"}]' }, 'invalid_root'],
    ['다른 배열 키', { 'a.json': '{"data":[{"id":"a"}],"total":1,"page":1,"limit":2}' }],
    ['ID 누락', { 'a.json': page('players', 1, [{ name: '무식별' }], 1) }, 'missing_id'],
    ['빈 ID', { 'a.json': page('players', 1, [{ id: '' }], 1) }, 'invalid_id'],
    ['객체 ID', { 'a.json': page('players', 1, [{ id: { value: 'a' } }], 1) }, 'invalid_id'],
    ['지수형 ID', { 'a.json': '{"players":[{"id":1e3}],"total":1,"page":1,"limit":2}' }, 'invalid_id'],
  ];
  for (const [name, files, code] of cases) await t.test(name, st => failure(st, files, {}, code));
});

test('항목 내부의 미지 필드와 달리 루트 미지원 필드·연구용 포장은 발행하지 않는다', async (t) => {
  const cases = [
    ['미지원 루트 키', page('players', 1, [{ id: 'a' }], 1, 2, { unknown: null })],
    ['연구 메타데이터 혼입', page('players', 1, [{ id: 'a' }], 1, 2, { source: 'synthetic', observed_at: '2026-10-25' })],
    ['다른 종류의 배열 혼입', page('players', 1, [{ id: 'a' }], 1, 2, { packs: [{ slug: 'other' }] })],
    ['연구용 root 포장', JSON.stringify({ source: 'synthetic', payload: JSON.parse(page('players', 1, [{ id: 'a' }], 1)) })],
  ];
  for (const [name, body] of cases) await t.test(name, st => failure(st, { 'one.json': body }, {}, 'unknown_root_fields'));
});

test('검증 실패 시 새 배열 파일을 만들지 않고 실패 보고서만 남긴다', async (t) => {
  const f = await fixture(t, { 'partial.json': page('players', 1, [{ id: 'a' }, { id: 'b' }], 3) });
  const result = run(f);
  assert.equal(result.status, 1, result.stderr);
  await assert.rejects(readFile(f.output), { code: 'ENOENT' });
  assert.equal(JSON.parse(await readFile(f.report, 'utf8')).complete, false);
  await assertInputsPreserved(f);
});

test('설정 오류는 exit2이며 기존 출력과 원본을 보존한다', async (t) => {
  for (const extra of [
    ['--kind', 'unknown'], ['--expected-total', '-1'], ['--expected-pages', '1.5'], ['--id-field', ''], ['--unknown-option', 'x'],
  ]) await t.test(extra.join(' '), async (st) => {
    const f = await fixture(st, { 'one.json': page('players', 1, [{ id: 'a' }], 1) });
    await writeFile(f.output, previousOutput);
    const result = run(f, { extra });
    assert.equal(result.status, 2, result.stderr);
    assert.equal(await readFile(f.output, 'utf8'), previousOutput);
    await assertInputsPreserved(f);
  });
});

test('출력·보고서·입력의 경로 또는 실제 파일 별칭 충돌은 모두 쓰기 전에 거부한다', async (t) => {
  for (const mode of ['output=input', 'report=input', 'output=report', 'hardlink-output=input', 'symlink-report=input']) {
    await t.test(mode, async (st) => {
      const f = await fixture(st, { 'one.json': page('players', 1, [{ id: 'a' }], 1) });
      const input = join(f.inputDir, 'one.json');
      let output = f.output;
      let report = f.report;
      if (mode === 'output=input') output = input;
      if (mode === 'report=input') report = input;
      if (mode === 'output=report') output = report;
      if (mode === 'hardlink-output=input') await link(input, output);
      if (mode === 'symlink-report=input') await symlink(input, report);
      if (mode === 'output=report') await writeFile(output, previousOutput);
      const outputBefore = await readFile(output).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
      const reportBefore = await readFile(report).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
      const result = run(f, { output, report });
      assert.equal(result.status, 2, result.stderr);
      await assertInputsPreserved(f);
      if (outputBefore) assert.deepEqual(await readFile(output), outputBefore);
      else await assert.rejects(readFile(output), { code: 'ENOENT' });
      if (reportBefore) assert.deepEqual(await readFile(report), reportBefore);
    });
  }
});

test('새 출력·보고서가 입력 디렉터리 내부를 가리키면 정규 경로로 판별해 거부한다', async (t) => {
  for (const role of ['output', 'report']) for (const viaSymlink of [false, true]) {
    await t.test(`${role}: ${viaSymlink ? '별칭 부모의 실제 경로' : '직접 하위 경로'}`, async (st) => {
      const f = await fixture(st, { 'one.json': page('players', 1, [{ id: 'a' }], 1) });
      const nested = join(f.inputDir, 'nested');
      await mkdir(nested);
      const alias = join(f.root, 'input-alias');
      if (viaSymlink) await symlink(nested, alias, 'dir');
      const target = join(viaSymlink ? alias : nested, `${role}.json`);
      await writeFile(f.output, previousOutput);
      const result = run(f, { [role]: target });
      assert.equal(result.status, 2, result.stderr);
      await assertInputsPreserved(f);
      assert.equal(await readFile(f.output, 'utf8'), previousOutput);
      await assert.rejects(readFile(target), { code: 'ENOENT' });
      assert.deepEqual(await readdir(nested), [], '다음 실행의 입력에 출력·보고서가 섞이지 않는다');
      assert.deepEqual((await readdir(f.inputDir)).sort(), ['nested', 'one.json']);
    });
  }
});

test('보고서 최종 발행이 실패하면 기존 배열을 복원하고 새 배열은 남기지 않는다', async (t) => {
  for (const hasPrevious of [true, false]) await t.test(hasPrevious ? '기존 출력·보고서 복원' : '새 출력·성공 보고서 없음', async (st) => {
    const f = await fixture(st, { 'one.json': page('players', 1, [{ id: 'a', unknown: null }], 1) });
    const previousReport = '{"complete":false,"last_good":"이전 보고서"}\n';
    if (hasPrevious) {
      await writeFile(f.output, previousOutput);
      await writeFile(f.report, previousReport);
    }
    const preload = join(f.root, 'report-commit-failure.mjs');
    // Child-process fault injection: real staging/output renames still run;
    // only publishing the report receives an I/O error through Node's preload.
    await writeFile(preload, `import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const rename = fs.rename;
fs.rename = async (from, to) => {
  if (to === ${JSON.stringify(f.report)}) throw Object.assign(new Error('synthetic report commit failure'), { code: 'EIO' });
  return rename(from, to);
};
syncBuiltinESMExports();
`);
    const result = run(f, { nodeArgs: ['--import', preload] });
    assert.equal(result.status, 2, result.stderr);
    await assertInputsPreserved(f);
    if (hasPrevious) {
      assert.equal(await readFile(f.output, 'utf8'), previousOutput);
      assert.equal(await readFile(f.report, 'utf8'), previousReport);
    } else {
      await assert.rejects(readFile(f.output), { code: 'ENOENT' });
      await assert.rejects(readFile(f.report), { code: 'ENOENT' });
    }
    assert.deepEqual((await readdir(f.root)).sort(), [
      'input', 'report-commit-failure.mjs', ...(hasPrevious ? ['merged.json', 'report.json'] : []),
    ].sort(), '실패한 임시 배열·보고서·백업이 남지 않는다');
  });
});
