#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
]);

function inside(root, path) {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}

function send(request, response, status, body, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(request.method === 'HEAD' ? undefined : body);
}

function requestPath(rawUrl) {
  const rawPath = (rawUrl ?? '/').split('?')[0];
  if (!rawPath.startsWith('/') || rawPath.startsWith('//')) return { error: 400 };
  let decoded;
  try { decoded = decodeURIComponent(rawPath); }
  catch { return { error: 400 }; }
  if (decoded.includes('\0') || decoded.includes('\\')) return { error: 400 };
  // Check the original request path before WHATWG URL normalization can remove '..'.
  if (decoded.split('/').some((part) => part === '..' || part === '.')) return { error: 403 };
  return { path: decoded };
}

const isAppRoute = (path) => path === '/' || (
  /^\/(?:products|cards)(?:\/[^/]+)?\/?$/.test(path) && extname(path) === ''
);

/** Static preview only; no external network requests or product API are started. */
export function createStaticServer({ dir = 'dist' } = {}) {
  const base = resolve(dir);
  return createServer((request, response) => {
    async function handle() {
      if (!['GET', 'HEAD'].includes(request.method)) {
        send(request, response, 405, '허용되지 않은 요청 방식입니다.\n', { Allow: 'GET, HEAD' });
        return;
      }
      const parsed = requestPath(request.url);
      if (parsed.error) {
        send(request, response, parsed.error, '올바르지 않은 경로입니다.\n');
        return;
      }
      const pathname = parsed.path;
      const root = await realpath(base);
      let candidate = resolve(root, `.${pathname}`);
      if (!inside(root, candidate)) {
        send(request, response, 403, '접근할 수 없는 경로입니다.\n');
        return;
      }
      if (pathname === '/') candidate = resolve(root, 'index.html');
      let canonical;
      try {
        canonical = await realpath(candidate);
        if (!(await stat(canonical)).isFile()) throw Object.assign(new Error('Not a file'), { code: 'ENOENT' });
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
        if (!isAppRoute(pathname)) {
          send(request, response, 404, '파일을 찾을 수 없습니다.\n');
          return;
        }
        canonical = await realpath(resolve(root, 'index.html'));
      }
      if (!inside(root, canonical)) {
        send(request, response, 403, '접근할 수 없는 경로입니다.\n');
        return;
      }
      const bytes = await readFile(canonical);
      response.writeHead(200, {
        'Content-Type': contentTypes.get(extname(canonical).toLowerCase()) ?? 'application/octet-stream',
        'Content-Length': bytes.length,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    }
    handle().catch(() => {
      if (!response.headersSent) send(request, response, 500, '미리보기 파일을 읽을 수 없습니다. 빌드 결과를 확인하세요.\n');
      else response.destroy();
    });
  });
}

function main() {
  const options = { dir: 'dist', port: 4173, host: '127.0.0.1' };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    const value = args[++index];
    if (!['--dir', '--port', '--host'].includes(name) || value === undefined) {
      process.stderr.write('사용법: node scripts/serve.mjs [--dir dist] [--port 4173] [--host 127.0.0.1]\n');
      process.exitCode = 2;
      return;
    }
    options[name.slice(2)] = name === '--port' ? Number(value) : value;
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535 || !options.host.trim()) {
    process.stderr.write('포트와 호스트가 올바르지 않습니다.\n');
    process.exitCode = 2;
    return;
  }
  const server = createStaticServer(options);
  server.on('error', (error) => {
    process.stderr.write(`미리보기 서버를 시작할 수 없습니다: ${error.message}\n`);
    process.exitCode = 1;
  });
  server.listen(options.port, options.host, () => {
    const address = server.address();
    const displayHost = options.host.includes(':') ? `[${options.host}]` : options.host;
    process.stdout.write(`미리보기: http://${displayHost}:${address.port} (${resolve(options.dir)})\n`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
