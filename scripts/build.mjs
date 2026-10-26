import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishCatalog, validateCatalog } from './catalog.mjs';

export function buildSite({ root = resolve(dirname(fileURLToPath(import.meta.url)), '..') } = {}) {
  const seed = JSON.parse(readFileSync(join(root, 'data/catalog.seed.json'), 'utf8'));
  validateCatalog(seed);
  const web = join(root, 'web');
  if (!existsSync(join(web, 'index.html'))) throw new Error('web/index.html이 없습니다. 공개 파일을 생성하지 않았습니다.');
  const artifacts = join(root, 'artifacts');
  mkdirSync(artifacts, { recursive: true });
  const stage = mkdtempSync(join(artifacts, '.site-build-'));
  const stagedOut = join(stage, 'dist');
  const stagedDb = join(stage, 'catalog.sqlite');
  const dbPath = join(artifacts, 'catalog.sqlite');
  const dist = join(root, 'dist');
  const oldDist = join(stage, 'previous-dist');
  const oldDb = join(stage, 'previous.sqlite');
  let movedDist = false;
  let installedDist = false;
  let movedDb = false;
  try {
    cpSync(web, stagedOut, { recursive: true });
    if (existsSync(dbPath)) cpSync(dbPath, stagedDb);
    // The previous public snapshot is used for loss protection even if no DB remains.
    if (existsSync(join(dist, 'data/catalog.json'))) {
      mkdirSync(join(stagedOut, 'data'), { recursive: true });
      cpSync(join(dist, 'data/catalog.json'), join(stagedOut, 'data/catalog.json'));
    }
    const result = publishCatalog(seed, { outDir: stagedOut, dbPath: stagedDb });
    // A wildcard would turn missing /cards/example.json into successful HTML.
    // Keep the initial sample's rewrites limited to actual entity paths.
    // Pages canonicalizes /index.html to /. Rewrite to / directly so a deep
    // request keeps its original URL instead of exposing a canonical redirect.
    const routes = ['products', 'cards'].flatMap(kind => [`/${kind} / 200`, `/${kind}/ / 200`]);
    routes.push(...['products', 'cards'].flatMap(kind => seed[kind].flatMap(entity => {
      const path = `/${kind}/${encodeURIComponent(entity.id)}`;
      return [`${path} / 200`, `${path}/ / 200`];
    })));
    writeFileSync(join(stagedOut, '_redirects'), `${routes.join('\n')}\n`, 'utf8');
    // A top-level 404 disables Pages' automatic catch-all SPA behavior for missing data/assets.
    if (!existsSync(join(stagedOut, '404.html'))) writeFileSync(join(stagedOut, '404.html'), '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>자료를 찾을 수 없습니다 · efsimulator</title><main><h1>자료를 찾을 수 없습니다.</h1><p>주소를 확인하거나 <a href="/">선수팩 검색</a>으로 이동해 주세요.</p></main></html>\n', 'utf8');
    writeFileSync(join(stagedOut, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Cache-Control: no-cache\n/data/*\n  Cache-Control: no-store\n', 'utf8');
    if (existsSync(dist)) { renameSync(dist, oldDist); movedDist = true; }
    renameSync(stagedOut, dist);
    installedDist = true;
    if (existsSync(dbPath)) { renameSync(dbPath, oldDb); movedDb = true; }
    renameSync(stagedDb, dbPath);
    return { ...result, publicPath: join(dist, 'data/catalog.json'), dbPath };
  } catch (error) {
    if (installedDist) rmSync(dist, { recursive: true, force: true });
    if (movedDist) renameSync(oldDist, dist);
    if (movedDb) renameSync(oldDb, dbPath);
    throw error;
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = buildSite();
    process.stdout.write(`정적 사이트 빌드 완료: 상품 ${result.products}개, 카드 ${result.cards}개. 감독은 지원 범위 제외. 전체 수집 완료 여부는 coverage를 확인하세요.\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
