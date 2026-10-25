#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, matchesGlob, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFEST = 'docs/FILE_SYNC.json';
const WORKPLAN = 'docs/WORKPLAN.md';
const ROADMAP = 'docs/ROADMAP.md';
const taskId = /^T\d{3,}$/;
const stages = new Set(['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6']);
const statuses = new Set(['완료', '진행 중', '예정', '차단']);
const reviewResults = new Set(['수정', '검토 결과 변경 불필요', '미해결']);
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function safePath(value) {
  return nonempty(value) && !isAbsolute(value) && !value.includes('\\') &&
    !value.includes('\0') && value !== '.' && posix.normalize(value) === value &&
    value.split('/').every((part) => part !== '..' && part !== '.' && part !== '');
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function gitPaths(root, args) {
  return git(root, args).split('\0').filter(Boolean);
}

function stateOf(source, label, errors) {
  const blocks = [...source.matchAll(/<!--\s*project-state:\s*([\s\S]*?)-->/g)];
  if (blocks.length !== 1) {
    errors.push(`${label}: project-state 주석이 정확히 하나 필요합니다.`);
    return null;
  }
  try {
    const state = JSON.parse(blocks[0][1]);
    if (!isObject(state) || !stages.has(state.stage) || !taskId.test(state.current) ||
        ![state.previous, state.next].every((id) => id === '없음' || (typeof id === 'string' && taskId.test(id)))) {
      errors.push(`${label}: 단계와 이전·현재·다음 작업 ID가 올바르지 않습니다.`);
      return null;
    }
    return state;
  } catch {
    errors.push(`${label}: project-state JSON을 읽을 수 없습니다.`);
    return null;
  }
}

function checkHumanState(roadmap, workplan, state, errors) {
  if (!state) return;
  const location = /(?:^|\n)## 현재 위치\s*\n([\s\S]*?)(?=\n## |$)/.exec(roadmap);
  if (!location) {
    errors.push(`${ROADMAP}: '## 현재 위치' 표가 필요합니다.`);
  } else {
    for (const [label, key] of [['현재 단계', 'stage'], ['이전 작업', 'previous'], ['현재 작업', 'current'], ['다음 작업', 'next']]) {
      const rows = [...location[1].matchAll(new RegExp(`^\\s*\\|\\s*${label}\\s*\\|\\s*([^|]*?)\\s*\\|\\s*$`, 'gm'))];
      if (rows.length !== 1) {
        errors.push(`${ROADMAP}: 현재 위치 표의 '${label}' 행이 정확히 하나 필요합니다.`);
        continue;
      }
      const identifier = /^(R\d+|T\d{3,}|없음)(?=\s|$|[—–-])/.exec(rows[0][1].trim())?.[1];
      if (identifier !== state[key]) errors.push(`${ROADMAP}: 현재 위치 표의 '${label}'이 project-state와 다릅니다.`);
    }
  }

  const firstTask = /^## T\d{3,} [—–-] /m.exec(workplan);
  const summary = workplan.slice(0, firstTask?.index ?? workplan.length);
  for (const [label, key] of [['이전 작업', 'previous'], ['현재 작업', 'current'], ['다음 작업', 'next']]) {
    const items = [...summary.matchAll(new RegExp(`^- ${label}: (.+)$`, 'gm'))];
    if (items.length !== 1) {
      errors.push(`${WORKPLAN}: 작업 섹션 앞의 '${label}' 요약이 정확히 하나 필요합니다.`);
      continue;
    }
    const identifier = /^(T\d{3,}|없음)(?=\s|$|[—–-])/.exec(items[0][1].trim())?.[1];
    if (identifier !== state[key]) errors.push(`${WORKPLAN}: '${label}' 요약이 project-state와 다릅니다.`);
  }
}

function taskSections(source) {
  const headings = [...source.matchAll(/^## (.+)$/gm)];
  return headings.flatMap((heading, index) => {
    const match = /^(T\d{3,}) [—–-] (.+)$/.exec(heading[1]);
    if (!match) return [];
    const end = headings[index + 1]?.index ?? source.length;
    return [{ id: match[1], title: match[2], raw: source.slice(heading.index, end) }];
  });
}

function tasksOf(source, errors) {
  const tasks = new Map();
  for (const section of taskSections(source)) {
    const { id, raw } = section;
    if (tasks.has(id)) errors.push(`${WORKPLAN}: 작업 ID ${id}가 중복됩니다.`);
    const field = (name) => {
      const values = [...raw.matchAll(new RegExp(`^- ${name}: (.+)$`, 'gm'))];
      if (values.length !== 1) {
        errors.push(`${id}: '${name}' 항목이 정확히 하나 필요합니다.`);
        return null;
      }
      return values[0][1].trim();
    };
    const task = { ...section, stage: field('단계'), status: field('상태'), previous: field('이전'), next: field('다음'), reviews: new Map() };
    if (!stages.has(task.stage)) errors.push(`${id}: 단계가 R0~R6 중 하나여야 합니다.`);
    if (!statuses.has(task.status)) errors.push(`${id}: 올바르지 않은 작업 상태입니다.`);
    for (const [name, reference] of [['이전', task.previous], ['다음', task.next]]) {
      if (reference !== '없음' && (typeof reference !== 'string' || !taskId.test(reference))) {
        errors.push(`${id}: '${name}' 작업 ID가 올바르지 않습니다.`);
      }
      if (reference === id) errors.push(`${id}: 자기 자신을 '${name}' 작업으로 참조합니다.`);
    }
    const reviewSection = /(?:^|\n)### 파일 최신화 검토\s*\n([\s\S]*?)(?=\n### |$)/.exec(raw);
    if (!reviewSection) {
      errors.push(`${id}: '### 파일 최신화 검토' 표가 필요합니다.`);
    } else {
      const rows = reviewSection[1].split('\n').filter((line) => /^\s*\|/.test(line));
      let headerFound = false;
      for (const row of rows) {
        const cells = row.trim().split('|').slice(1, -1).map((cell) => cell.trim());
        if (cells.join('|') === '파일|결과|근거') { headerFound = true; continue; }
        if (cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell))) continue;
        if (cells.length !== 3) { errors.push(`${id}: 파일 검토 표는 파일·결과·근거 세 열이어야 합니다.`); continue; }
        const pathMatch = /^`([^`]+)`$/.exec(cells[0]);
        if (!pathMatch || !safePath(pathMatch[1])) { errors.push(`${id}: 파일 검토 경로가 올바르지 않습니다: ${cells[0]}`); continue; }
        const path = pathMatch[1];
        if (task.reviews.has(path)) errors.push(`${id}: 파일 검토 경로가 중복됩니다: ${path}`);
        if (!reviewResults.has(cells[1])) errors.push(`${id}: ${path}의 검토 결과가 올바르지 않습니다.`);
        if (!nonempty(cells[2])) errors.push(`${id}: ${path}의 검토 근거가 비어 있습니다.`);
        if (task.status === '완료' && cells[1] === '미해결') errors.push(`${id}: 미해결 파일이 있어 완료로 표시할 수 없습니다: ${path}`);
        task.reviews.set(path, { result: cells[1], reason: cells[2] });
      }
      if (!headerFound) errors.push(`${id}: 파일 검토 표의 머리글은 '파일 | 결과 | 근거'여야 합니다.`);
    }
    tasks.set(id, task);
  }
  if (tasks.size === 0) errors.push(`${WORKPLAN}: 작업 기록을 찾지 못했습니다.`);
  return tasks;
}

/** Read-only validation. Fixture tests can supply a temporary Git repository. */
export function checkProject({ root = process.cwd(), base } = {}) {
  root = resolve(root);
  const errors = [];
  let manifest;
  let workplan;
  let roadmap;
  try {
    manifest = JSON.parse(readFileSync(resolve(root, MANIFEST), 'utf8'));
    workplan = readFileSync(resolve(root, WORKPLAN), 'utf8');
    roadmap = readFileSync(resolve(root, ROADMAP), 'utf8');
  } catch (error) {
    return { errors: [`관리 파일을 읽을 수 없습니다: ${error.message}`], filesChecked: 0, tasksChecked: 0, changedFiles: [] };
  }
  if (!isObject(manifest) || manifest.version !== 1 || !Array.isArray(manifest.files)) {
    return { errors: [`${MANIFEST}: version: 1과 files 배열이 필요합니다.`], filesChecked: 0, tasksChecked: 0, changedFiles: [] };
  }

  const exclusions = [];
  if (!Array.isArray(manifest.exclusions)) errors.push(`${MANIFEST}: exclusions 배열이 필요합니다.`);
  else for (const exclusion of manifest.exclusions) {
    if (!isObject(exclusion) || !safePath(exclusion.pattern) || !nonempty(exclusion.reason)) {
      errors.push(`${MANIFEST}: 제외 규칙에 안전한 pattern과 reason이 필요합니다.`);
    } else exclusions.push(exclusion.pattern);
  }
  if (!Array.isArray(manifest.external_dependencies)) errors.push(`${MANIFEST}: external_dependencies 배열이 필요합니다.`);
  else for (const dependency of manifest.external_dependencies) {
    if (!isObject(dependency) || !['path', 'role', 'check'].every((key) => nonempty(dependency[key]))) {
      errors.push(`${MANIFEST}: 외부 의존 항목에는 path·role·check가 필요합니다.`);
    }
  }

  let tracked;
  let untracked;
  try {
    const top = git(root, ['rev-parse', '--show-toplevel']).trim();
    if (resolve(top) !== root) throw new Error('--root는 Git 저장소 루트여야 합니다.');
    tracked = gitPaths(root, ['ls-files', '--cached', '-z']);
    untracked = gitPaths(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  } catch (error) {
    return { errors: [...errors, `Git 파일 목록을 읽을 수 없습니다: ${error.message}`], filesChecked: 0, tasksChecked: 0, changedFiles: [] };
  }
  const excluded = (path) => exclusions.some((pattern) => matchesGlob(path, pattern));
  const present = (path) => {
    try { const stat = lstatSync(resolve(root, path)); return stat.isFile() || stat.isSymbolicLink(); }
    catch { return false; }
  };
  // A tracked file always remains managed, even when it matches an exclusion.
  const actualFiles = new Set([...tracked.filter(present), ...untracked.filter((path) => !excluded(path) && present(path))]);
  const entries = new Map();
  for (const entry of manifest.files) {
    if (!isObject(entry) || !safePath(entry.path)) { errors.push(`${MANIFEST}: 안전하지 않거나 비어 있는 파일 경로입니다.`); continue; }
    const path = entry.path;
    if (entries.has(path)) errors.push(`${MANIFEST}: 경로가 중복됩니다: ${path}`);
    entries.set(path, entry);
    if (!nonempty(entry.role)) errors.push(`${path}: role이 비어 있습니다.`);
    if (!['P0', 'P1', 'P2'].includes(entry.priority)) errors.push(`${path}: priority는 P0·P1·P2 중 하나여야 합니다.`);
    if (!Array.isArray(entry.update_when) || entry.update_when.length === 0 || !entry.update_when.every(nonempty)) errors.push(`${path}: update_when에 갱신 조건이 필요합니다.`);
    if (!Array.isArray(entry.related_paths)) errors.push(`${path}: related_paths 배열이 필요합니다.`);
    else if (new Set(entry.related_paths).size !== entry.related_paths.length) errors.push(`${path}: 연관 경로가 중복됩니다.`);
    if (typeof entry.reviewed_in !== 'string' || !taskId.test(entry.reviewed_in)) errors.push(`${path}: reviewed_in 작업 ID가 올바르지 않습니다.`);
    if (!actualFiles.has(path)) errors.push(`${MANIFEST}: 삭제되었거나 관리 대상이 아닌 경로가 남아 있습니다: ${path}`);
  }
  for (const path of actualFiles) if (!entries.has(path)) errors.push(`${MANIFEST}: 관리 목록에 파일이 없습니다: ${path}`);
  for (const [path, entry] of entries) {
    if (Array.isArray(entry.related_paths)) for (const related of entry.related_paths) {
      if (!safePath(related) || !entries.has(related) || !actualFiles.has(related)) errors.push(`${path}: 연관 파일 경로가 유효하지 않습니다: ${String(related)}`);
    }
  }

  const state = stateOf(workplan, WORKPLAN, errors);
  const roadmapState = stateOf(roadmap, ROADMAP, errors);
  const tasks = tasksOf(workplan, errors);
  if (state && roadmapState && ['stage', 'previous', 'current', 'next'].some((key) => state[key] !== roadmapState[key])) {
    errors.push('ROADMAP과 WORKPLAN의 현재 단계·작업 포인터가 다릅니다.');
  }
  checkHumanState(roadmap, workplan, state, errors);
  for (const [id, task] of tasks) {
    for (const reference of [task.previous, task.next]) {
      if (reference && reference !== '없음' && !tasks.has(reference)) errors.push(`${id}: 존재하지 않는 작업을 참조합니다: ${reference}`);
    }
    const seen = new Set([id]);
    let following = task.next;
    while (tasks.has(following)) {
      if (seen.has(following)) { errors.push(`${id}: 다음 작업 참조에 순환이 있습니다.`); break; }
      seen.add(following);
      following = tasks.get(following).next;
    }
  }
  if (state) {
    for (const key of ['previous', 'current', 'next']) {
      if (state[key] !== '없음' && !tasks.has(state[key])) errors.push(`현재 상태의 ${key} 작업이 없습니다: ${state[key]}`);
    }
    const current = tasks.get(state.current);
    if (current) {
      if (current.stage !== state.stage) errors.push('현재 단계와 현재 작업의 단계가 다릅니다.');
      if (!['진행 중', '예정', '차단'].includes(current.status)) errors.push('현재 작업은 진행 중·예정·차단 상태여야 합니다.');
      if (current.previous !== state.previous || current.next !== state.next) errors.push('현재 작업과 project-state의 이전·다음 작업이 다릅니다.');
    }
    if (tasks.has(state.previous) && tasks.get(state.previous).status !== '완료') errors.push('이전 작업은 완료 상태여야 합니다.');
    if (tasks.has(state.next) && tasks.get(state.next).status !== '예정') errors.push('다음 작업은 예정 상태여야 합니다.');
    if (new Set([state.previous, state.current, state.next].filter((id) => id !== '없음')).size !== [state.previous, state.current, state.next].filter((id) => id !== '없음').length) {
      errors.push('이전·현재·다음 작업은 서로 다른 작업이어야 합니다.');
    }
  }
  for (const [path, entry] of entries) {
    const task = tasks.get(entry.reviewed_in);
    if (!task) errors.push(`${path}: reviewed_in이 존재하지 않는 작업을 참조합니다: ${String(entry.reviewed_in)}`);
    else {
      if (task.status === '예정') errors.push(`${path}: 아직 예정인 작업을 최근 검토 작업으로 사용할 수 없습니다.`);
      if (!task.reviews.has(path)) errors.push(`${path}: ${entry.reviewed_in}에 해당 파일의 검토 기록이 없습니다.`);
    }
  }

  let changedFiles = [];
  if (base !== undefined) {
    try {
      const commit = git(root, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).trim();
      changedFiles = [...new Set([...gitPaths(root, ['diff', '--name-only', '-z', '--no-renames', commit, '--']), ...untracked.filter((path) => !excluded(path))])];
      let before = '';
      // A first implementation may add WORKPLAN; an absent file is expected.
      if (git(root, ['ls-tree', '--name-only', commit, '--', WORKPLAN]).trim()) before = git(root, ['show', `${commit}:${WORKPLAN}`]);
      const beforeTasks = new Map(taskSections(before).map((task) => [task.id, task.raw]));
      const updatedTasks = [...tasks.values()].filter((task) => beforeTasks.get(task.id) !== task.raw);
      for (const path of changedFiles) {
        const reviews = updatedTasks.filter((task) => task.reviews.has(path));
        if (reviews.length === 0) errors.push(`${path}: 기준 커밋 이후 갱신된 작업의 파일 검토 기록이 없습니다.`);
        const entry = entries.get(path);
        if (entry && !reviews.some((task) => task.id === entry.reviewed_in)) errors.push(`${path}: reviewed_in이 이번 변경의 검토 작업을 가리키지 않습니다.`);
      }
    } catch (error) {
      errors.push(`기준 커밋 변경 검사를 실행할 수 없습니다: ${error.message}`);
    }
  }
  return { errors, filesChecked: actualFiles.size, tasksChecked: tasks.size, changedFiles };
}

function main() {
  let root = process.cwd();
  let base;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if ((arg === '--root' || arg === '--base') && args[index + 1]) {
      if (arg === '--root') root = args[++index];
      else base = args[++index];
    } else {
      process.stderr.write('사용법: node scripts/project-check.mjs [--root 저장소] [--base 기준커밋]\n');
      process.exitCode = 2;
      return;
    }
  }
  const result = checkProject({ root, base });
  if (result.errors.length) {
    process.stderr.write(`프로젝트 관리 검사 실패 (${result.errors.length}건):\n${result.errors.map((error) => `- ${error}`).join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`프로젝트 관리 검사 통과: 파일 ${result.filesChecked}개, 작업 ${result.tasksChecked}개${base === undefined ? '' : `, 변경 경로 ${result.changedFiles.length}개`}.\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
