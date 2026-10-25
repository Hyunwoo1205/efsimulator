#!/usr/bin/env node
import fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog } from './catalog.mjs';

// Transitional compatibility with the existing Pages exit-0/root-output build.
// web/* and the validated catalog seed remain the editable sources.
export const PAGES_FILES = Object.freeze([
  'index.html', 'app.js', 'styles.css', '404.html', '_headers', '_redirects', 'data/catalog.json',
]);

function statOrMissing(path) {
  try { return fs.lstatSync(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function inspectPath(root, relative, { missing = false } = {}) {
  let path = root;
  const parts = relative.split('/');
  for (const [index, part] of parts.entries()) {
    path = join(path, part);
    const stat = statOrMissing(path);
    if (!stat) {
      if (missing) return null;
      throw new Error(`Pages 내보내기 원본이 없습니다: ${relative}`);
    }
    if (stat.isSymbolicLink()) throw new Error(`Pages 내보내기는 심볼릭 링크 경로를 허용하지 않습니다: ${path}`);
    if (index < parts.length - 1) {
      if (!stat.isDirectory()) throw new Error(`Pages 내보내기 경로의 상위 항목이 디렉터리가 아닙니다: ${path}`);
    } else if (!stat.isFile()) throw new Error(`Pages 내보내기는 정규 파일만 허용합니다: ${path}`);
  }
  return path;
}

function readFile(root, relative, options) {
  const path = inspectPath(root, relative, options);
  if (path === null) return null;
  // O_NOFOLLOW also protects the final component between inspection and open.
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error(`Pages 내보내기는 정규 파일만 허용합니다: ${path}`);
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

function ensureParent(root, relative, created) {
  let path = root;
  for (const part of relative.split('/').slice(0, -1)) {
    path = join(path, part);
    const stat = statOrMissing(path);
    if (!stat) { fs.mkdirSync(path); created.push(path); }
    else if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Pages 내보내기 대상의 상위 경로가 안전한 디렉터리가 아닙니다: ${path}`);
  }
}

function sameBytes(left, right) {
  return left === null ? right === null : right !== null && left.equals(right);
}

/**
 * Export only the fixed public files from dist. No build or network operation is
 * performed here. check=true never creates directories or changes a file.
 */
export function exportPages({ root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), check = false } = {}) {
  root = resolve(root);
  const rootStat = statOrMissing(root);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Pages 내보내기 root는 심볼릭 링크가 아닌 실제 디렉터리여야 합니다.');

  // Finish every source read and validation before making any destination write.
  const sources = new Map(PAGES_FILES.map(path => [path, readFile(root, `dist/${path}`)]));
  let catalog;
  try { catalog = JSON.parse(sources.get('data/catalog.json').toString('utf8')); }
  catch (error) { throw new Error(`Pages 내보내기 catalog JSON을 읽을 수 없습니다: ${error.message}`); }
  validateCatalog(catalog);
  const previous = new Map(PAGES_FILES.map(path => [path, readFile(root, path, { missing: true })]));
  const changed = PAGES_FILES.filter(path => !sameBytes(sources.get(path), previous.get(path)));
  if (check) {
    if (changed.length) throw new Error(`Pages 내보내기 검사 실패: 빌드 결과와 다르거나 누락된 파일: ${changed.join(', ')}`);
    return { checked: true, files: PAGES_FILES.length, updated: 0, unchanged: PAGES_FILES.length };
  }
  if (!changed.length) return { checked: false, files: PAGES_FILES.length, updated: 0, unchanged: PAGES_FILES.length };

  const stage = fs.mkdtempSync(join(root, '.pages-export-'));
  const installed = [];
  const backups = [];
  const created = [];
  let preserveStage = false;
  try {
    for (const path of changed) {
      const staged = join(stage, 'new', path);
      fs.mkdirSync(dirname(staged), { recursive: true });
      fs.writeFileSync(staged, sources.get(path));
    }
    // A concurrent edit must not be overwritten by an export based on old bytes.
    for (const path of changed) {
      if (!sameBytes(previous.get(path), readFile(root, path, { missing: true }))) throw new Error(`Pages 내보내기 중 대상 파일이 변경되었습니다: ${path}`);
    }
    for (const path of changed) {
      ensureParent(root, path, created);
      // Recheck parents and the target immediately before moving any old file.
      if (!sameBytes(previous.get(path), readFile(root, path, { missing: true }))) throw new Error(`Pages 내보내기 중 대상 파일이 변경되었습니다: ${path}`);
      const target = join(root, path);
      if (previous.get(path) !== null) {
        const backup = join(stage, 'backup', path);
        fs.mkdirSync(dirname(backup), { recursive: true });
        fs.renameSync(target, backup);
        backups.push(path);
      }
      fs.renameSync(join(stage, 'new', path), target);
      installed.push(path);
    }
    return { checked: false, files: PAGES_FILES.length, updated: changed.length, unchanged: PAGES_FILES.length - changed.length };
  } catch (error) {
    const rollbackErrors = [];
    for (const path of installed.toReversed()) {
      try {
        inspectPath(root, path);
        fs.unlinkSync(join(root, path));
      } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    for (const path of backups.toReversed()) {
      try {
        ensureParent(root, path, created);
        inspectPath(root, path, { missing: true });
        fs.renameSync(join(stage, 'backup', path), join(root, path));
      } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    for (const path of created.toReversed()) {
      try { fs.rmdirSync(path); }
      catch (rollbackError) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(rollbackError.code)) rollbackErrors.push(rollbackError); }
    }
    if (rollbackErrors.length) {
      preserveStage = true;
      throw new AggregateError([error, ...rollbackErrors], `Pages 내보내기와 복구에 실패했습니다. 원본 백업을 보존했습니다: ${stage}`);
    }
    throw error;
  } finally {
    // If restoration itself fails, never destroy the remaining original backups.
    if (!preserveStage) fs.rmSync(stage, { recursive: true, force: true });
  }
}

function main() {
  let root;
  let check = false;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--check') check = true;
    else if (args[index] === '--root' && args[index + 1]) root = args[++index];
    else throw new Error('사용법: node scripts/export-pages.mjs [--check] [--root 저장소]');
  }
  const result = exportPages({ root, check });
  process.stdout.write(check ? `Pages 공개 생성물 검사 통과: ${result.files}개 파일.\n` : `Pages 공개 생성물 내보내기 완료: ${result.updated}개 갱신, ${result.unchanged}개 동일.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
