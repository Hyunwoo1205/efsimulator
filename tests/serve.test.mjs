import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createStaticServer } from '../scripts/serve.mjs';

async function fixture(t) {
  const parent = await mkdtemp(join(tmpdir(), 'efsimulator-serve-'));
  const dir = join(parent, 'dist');
  await mkdir(join(dir, 'data'), { recursive: true });
  await writeFile(join(dir, 'index.html'), '<!doctype html><h1>선수팩 검색</h1>');
  await writeFile(join(dir, 'data', 'catalog.json'), '{"cards":[]}');
  await writeFile(join(dir, 'app.js'), 'console.log("app");');
  await writeFile(join(dir, 'style.css'), 'body { color: black; }');
  await writeFile(join(parent, 'private.txt'), 'outside root');
  const server = createStaticServer({ dir });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(parent, { recursive: true, force: true });
  });
  const get = (path, method = 'GET') => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.address().port, path, method, headers: { Connection: 'close' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
  return { parent, dir, get };
}

test('홈페이지·정적 JS·CSS·JSON을 올바른 MIME으로 제공한다', async (t) => {
  const f = await fixture(t);
  const expected = [
    ['/', 'text/html'],
    ['/app.js', 'text/javascript'],
    ['/style.css', 'text/css'],
    ['/data/catalog.json', 'application/json'],
  ];
  for (const [path, type] of expected) {
    const response = await f.get(path);
    assert.equal(response.status, 200);
    assert.ok(response.headers['content-type'].startsWith(type));
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['cache-control'], 'no-cache');
  }
});

test('지원하는 상품·카드 주소만 SPA로 연결하고 감독 주소는 지원하지 않는다', async (t) => {
  const f = await fixture(t);
  for (const path of ['/products/product_1', '/cards/card_1', '/products', '/cards/card_1?from=pack']) {
    const response = await f.get(path);
    assert.equal(response.status, 200);
    assert.match(response.body, /선수팩 검색/);
  }
  assert.equal((await f.get('/unknown-page')).status, 404);
  assert.equal((await f.get('/managers')).status, 404);
  assert.equal((await f.get('/managers/manager_1')).status, 404);
});

test('없는 JSON·이미지·스크립트는 HTML 성공 응답으로 바뀌지 않는다', async (t) => {
  const f = await fixture(t);
  for (const path of ['/data/missing.json', '/images/missing.png', '/cards/missing.js', '/products/missing.json']) {
    const response = await f.get(path);
    assert.equal(response.status, 404);
    assert.ok(!response.headers['content-type'].startsWith('text/html'));
  }
});

test('HEAD는 GET의 상태·헤더를 유지하고 본문을 보내지 않는다', async (t) => {
  const f = await fixture(t);
  const response = await f.get('/data/catalog.json', 'HEAD');
  assert.equal(response.status, 200);
  assert.equal(response.body, '');
  assert.equal(response.headers['content-length'], '12');
  const missing = await f.get('/missing.json', 'HEAD');
  assert.equal(missing.status, 404);
  assert.equal(missing.body, '');
});

test('GET·HEAD 이외 방식은 405와 Allow 헤더를 반환한다', async (t) => {
  const f = await fixture(t);
  const response = await f.get('/data/catalog.json', 'POST');
  assert.equal(response.status, 405);
  assert.equal(response.headers.allow, 'GET, HEAD');
});

test('문자열·인코딩 경로 이탈을 URL 정규화 전에 거부한다', async (t) => {
  const f = await fixture(t);
  for (const path of ['/../private.txt', '/%2e%2e/private.txt', '/cards/%2e%2e/%2e%2e/private.txt', '/%2E%2E%2Fprivate.txt', '/cards/./card_1']) {
    const response = await f.get(path);
    assert.equal(response.status, 403, path);
    assert.ok(!response.body.includes('outside root'));
  }
  for (const path of ['/cards/%ZZ', '/%00private.txt', '/%5c..%5cprivate.txt', '//outside.example/private.txt']) {
    assert.equal((await f.get(path)).status, 400, path);
  }
});

test('빌드 폴더 밖으로 연결하는 심볼릭 링크를 거부한다', async (t) => {
  const f = await fixture(t);
  await symlink(join(f.parent, 'private.txt'), join(f.dir, 'leak.txt'));
  const response = await f.get('/leak.txt');
  assert.equal(response.status, 403);
  assert.ok(!response.body.includes('outside root'));
});

test('디렉터리를 나열하거나 임의 하위 경로를 SPA로 제공하지 않는다', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.get('/data')).status, 404);
  assert.equal((await f.get('/products/one/unexpected')).status, 404);
});
