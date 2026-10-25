import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { exportPages, PAGES_FILES } from '../scripts/export-pages.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'efsimulator-pages-export-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (path, contents) => { fs.mkdirSync(dirname(join(root, path)), { recursive: true }); fs.writeFileSync(join(root, path), contents); };
  const get = path => fs.readFileSync(join(root, path));
  const seed = { version: 1, observed_at: '2026-10-25T12:00:00+09:00', coverage: { scope: '내보내기 검사 표본', complete: false, notes: [], source_totals: {} }, sources: [], observations: [], assets: [], persons: [], cards: [], managers: [], products: [] };
  for (const path of PAGES_FILES) put(`dist/${path}`, path === 'data/catalog.json' ? `${JSON.stringify(seed)}\n` : Buffer.from(`built:${path}\r\n한글\0`, 'utf8'));
  return { root, put, get };
}

function externalDirectory(t) {
  const directory = fs.mkdtempSync(join(tmpdir(), 'efsimulator-pages-external-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('고정 7개 공개 파일의 bytes를 내보내고 읽기 전용 검사로 대조한다', t => {
  const f = fixture(t);
  const result = exportPages({ root: f.root });
  assert.equal(result.updated, 7);
  assert.equal(result.unchanged, 0);
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['404.html', '_headers', '_redirects', 'app.js', 'data', 'dist', 'index.html', 'styles.css']);
  for (const path of PAGES_FILES) assert.deepEqual(f.get(path), f.get(`dist/${path}`));
  assert.deepEqual(exportPages({ root: f.root, check: true }), { checked: true, files: 7, updated: 0, unchanged: 7 });
});

test('동일한 생성물은 재작성하지 않는다', t => {
  const f = fixture(t);
  exportPages({ root: f.root });
  const previous = new Map(PAGES_FILES.map(path => [path, fs.statSync(join(f.root, path), { bigint: true })]));
  const result = exportPages({ root: f.root });
  assert.equal(result.updated, 0);
  for (const path of PAGES_FILES) {
    const current = fs.statSync(join(f.root, path), { bigint: true });
    assert.equal(current.ino, previous.get(path).ino);
    assert.equal(current.mtimeNs, previous.get(path).mtimeNs);
  }
});

test('마지막 원본이 누락되어도 기존 생성물과 디렉터리를 변경하지 않는다', t => {
  const f = fixture(t);
  for (const path of PAGES_FILES) f.put(path, `old:${path}`);
  fs.unlinkSync(join(f.root, 'dist/data/catalog.json'));
  assert.throws(() => exportPages({ root: f.root }), /원본이 없습니다/);
  for (const path of PAGES_FILES) assert.equal(f.get(path).toString(), `old:${path}`);
  assert.ok(!fs.readdirSync(f.root).some(path => path.startsWith('.pages-export-')));
});

test('잘못된 JSON과 카탈로그는 어떤 대상도 쓰기 전에 거부한다', t => {
  const f = fixture(t);
  f.put('index.html', 'previous homepage');
  f.put('dist/data/catalog.json', '{broken');
  assert.throws(() => exportPages({ root: f.root }), /catalog JSON을 읽을 수 없습니다/);
  assert.equal(f.get('index.html').toString(), 'previous homepage');
  assert.equal(fs.existsSync(join(f.root, 'app.js')), false);
  f.put('dist/data/catalog.json', JSON.stringify({ version: 1 }));
  assert.throws(() => exportPages({ root: f.root }), /카탈로그 검증 실패/);
  assert.equal(fs.existsSync(join(f.root, 'app.js')), false);
});

test('검사는 누락·불일치 생성물을 실패시키되 자동 수정하거나 디렉터리를 만들지 않는다', t => {
  const f = fixture(t);
  assert.throws(() => exportPages({ root: f.root, check: true }), /빌드 결과와 다르거나 누락/);
  assert.equal(fs.existsSync(join(f.root, 'data')), false);
  exportPages({ root: f.root });
  f.put('app.js', 'manual change');
  const before = fs.statSync(join(f.root, 'app.js'), { bigint: true });
  assert.throws(() => exportPages({ root: f.root, check: true }), /app\.js/);
  assert.equal(f.get('app.js').toString(), 'manual change');
  assert.equal(fs.statSync(join(f.root, 'app.js'), { bigint: true }).mtimeNs, before.mtimeNs);
});

test('SQLite·환경 파일·임의 dist 파일을 복사하지 않는다', t => {
  const f = fixture(t);
  f.put('dist/catalog.sqlite', 'private database');
  f.put('dist/.env', 'private configuration');
  f.put('dist/artifacts/private.txt', 'private evidence');
  f.put('data/research/preserved.json', 'retained source evidence');
  exportPages({ root: f.root });
  for (const path of ['catalog.sqlite', '.env', 'artifacts/private.txt']) assert.equal(fs.existsSync(join(f.root, path)), false);
  assert.equal(f.get('data/research/preserved.json').toString(), 'retained source evidence');
});

test('source 파일이 저장소 밖으로 향하는 심볼릭 링크이면 대상 쓰기 전에 중단한다', t => {
  const f = fixture(t);
  const outside = join(externalDirectory(t), 'outside.html');
  fs.writeFileSync(outside, 'outside original');
  fs.unlinkSync(join(f.root, 'dist/index.html'));
  fs.symlinkSync(outside, join(f.root, 'dist/index.html'));
  assert.throws(() => exportPages({ root: f.root }), /심볼릭 링크 경로/);
  assert.equal(fs.existsSync(join(f.root, 'app.js')), false);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'outside original');
});

test('source 상위 디렉터리의 심볼릭 링크도 거부한다', t => {
  const f = fixture(t);
  fs.renameSync(join(f.root, 'dist/data'), join(f.root, 'source-data'));
  fs.symlinkSync(join(f.root, 'source-data'), join(f.root, 'dist/data'), 'dir');
  assert.throws(() => exportPages({ root: f.root }), /심볼릭 링크 경로/);
  assert.equal(fs.existsSync(join(f.root, 'index.html')), false);
});

test('대상 파일의 심볼릭 링크를 덮어쓰거나 따라가지 않는다', t => {
  const f = fixture(t);
  const outside = join(externalDirectory(t), 'outside.html');
  fs.writeFileSync(outside, 'outside original');
  fs.symlinkSync(outside, join(f.root, 'index.html'));
  assert.throws(() => exportPages({ root: f.root }), /심볼릭 링크 경로/);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'outside original');
  assert.equal(fs.lstatSync(join(f.root, 'index.html')).isSymbolicLink(), true);
});

test('대상 data의 심볼릭 링크와 dangling 링크를 모두 거부한다', t => {
  const f = fixture(t);
  const outside = externalDirectory(t);
  fs.symlinkSync(outside, join(f.root, 'data'), 'dir');
  assert.throws(() => exportPages({ root: f.root }), /심볼릭 링크 경로/);
  assert.equal(fs.existsSync(join(outside, 'catalog.json')), false);
  fs.unlinkSync(join(f.root, 'data'));
  fs.symlinkSync(join(f.root, 'missing-target.html'), join(f.root, 'index.html'));
  assert.throws(() => exportPages({ root: f.root }), /심볼릭 링크 경로/);
});

test('정규 파일이 아닌 원본과 대상 디렉터리를 거부한다', t => {
  const f = fixture(t);
  fs.mkdirSync(join(f.root, 'index.html'));
  assert.throws(() => exportPages({ root: f.root }), /정규 파일만 허용/);
  fs.rmdirSync(join(f.root, 'index.html'));
  fs.unlinkSync(join(f.root, 'dist/styles.css'));
  fs.mkdirSync(join(f.root, 'dist/styles.css'));
  assert.throws(() => exportPages({ root: f.root }), /정규 파일만 허용/);
  assert.equal(fs.existsSync(join(f.root, 'index.html')), false);
});

test('중간 설치 실패 시 이미 바꾼 파일과 백업을 모두 복구한다', t => {
  const f = fixture(t);
  for (const path of PAGES_FILES) f.put(path, `old:${path}`);
  const original = fs.renameSync;
  let injected = false;
  t.mock.method(fs, 'renameSync', function (from, to) {
    if (!injected && to === join(f.root, 'styles.css') && from.endsWith('/new/styles.css')) {
      injected = true;
      throw new Error('simulated export installation failure');
    }
    return original(from, to);
  });
  assert.throws(() => exportPages({ root: f.root }), /simulated export installation failure/);
  assert.equal(injected, true);
  for (const path of PAGES_FILES) assert.equal(f.get(path).toString(), `old:${path}`);
  assert.ok(!fs.readdirSync(f.root).some(path => path.startsWith('.pages-export-')));
});

test('이전 생성물이 없는 상태의 실패도 새 파일과 새 data 디렉터리를 되돌린다', t => {
  const f = fixture(t);
  const original = fs.renameSync;
  t.mock.method(fs, 'renameSync', function (from, to) {
    if (to === join(f.root, 'data/catalog.json') && from.endsWith('/new/data/catalog.json')) throw new Error('simulated final installation failure');
    return original(from, to);
  });
  assert.throws(() => exportPages({ root: f.root }), /simulated final installation failure/);
  assert.deepEqual(fs.readdirSync(f.root), ['dist']);
});

test('복구 자체가 실패하면 원래 bytes의 백업을 삭제하지 않는다', t => {
  const f = fixture(t);
  for (const path of PAGES_FILES) f.put(path, `old:${path}`);
  const original = fs.renameSync;
  t.mock.method(fs, 'renameSync', function (from, to) {
    if (to === join(f.root, 'styles.css') && from.endsWith('/new/styles.css')) throw new Error('simulated installation failure');
    if (to === join(f.root, 'index.html') && from.endsWith('/backup/index.html')) throw new Error('simulated restoration failure');
    return original(from, to);
  });
  assert.throws(() => exportPages({ root: f.root }), error => error instanceof AggregateError && /원본 백업을 보존했습니다/.test(error.message));
  const stage = fs.readdirSync(f.root).find(path => path.startsWith('.pages-export-'));
  assert.ok(stage);
  assert.equal(fs.readFileSync(join(f.root, stage, 'backup/index.html'), 'utf8'), 'old:index.html');
  assert.equal(f.get('app.js').toString(), 'old:app.js');
  assert.equal(f.get('styles.css').toString(), 'old:styles.css');
});
