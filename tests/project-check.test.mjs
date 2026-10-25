import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { checkProject } from '../scripts/project-check.mjs';

const paths = ['README.md', 'docs/ROADMAP.md', 'docs/WORKPLAN.md', 'docs/FILE_SYNC.json'];
const state = { stage: 'R0', previous: 'T000', current: 'T001', next: 'T002' };
const stateBlock = `<!-- project-state: ${JSON.stringify(state)} -->`;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'efsimulator-project-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q');
  const put = (path, contents) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), contents); };
  const get = (path) => readFileSync(join(root, path), 'utf8');
  const manifest = {
    version: 1,
    exclusions: [{ pattern: 'dist/**', reason: '비추적 빌드 출력' }],
    external_dependencies: [{ path: '/workspace/efsimulator-environment', role: '외부 개발 도구', check: '버전 확인' }],
    files: paths.map((path) => ({ path, role: `${path}의 역할`, priority: 'P0', related_paths: [], update_when: ['관련 내용 변경'], reviewed_in: 'T001' })),
  };
  const writeManifest = () => put('docs/FILE_SYNC.json', `${JSON.stringify(manifest, null, 2)}\n`);
  const reviewTable = (rows = []) => `### 파일 최신화 검토\n\n| 파일 | 결과 | 근거 |\n| --- | --- | --- |\n${rows.map((path) => `| \`${path}\` | 수정 | 최초 등록 및 확인 |`).join('\n')}\n`;
  put('README.md', '# Fixture\n');
  put('docs/ROADMAP.md', `${stateBlock}\n\n# 로드맵\n\n## 현재 위치\n\n| 항목 | 내용 |\n| --- | --- |\n| 현재 단계 | R0 관리 기반 |\n| 이전 작업 | T000 — 확인: 완료 |\n| 현재 작업 | T001 — 구현: 진행 중 |\n| 다음 작업 | T002 — 출처 조사: 예정 |\n`);
  put('docs/WORKPLAN.md', `${stateBlock}\n\n# 작업 계획\n\n## 현재 작업과 갱신 방법\n\n- 이전 작업: T000 — 확인, 완료.\n- 현재 작업: T001 — 구현, 진행 중.\n- 다음 작업: T002 — 출처 조사, 예정.\n\n## T000 — 확인\n\n- 단계: R0\n- 상태: 완료\n- 이전: 없음\n- 다음: T001\n\n${reviewTable()}\n## T001 — 구현\n\n- 단계: R0\n- 상태: 진행 중\n- 이전: T000\n- 다음: T002\n\n${reviewTable(paths)}\n## T002 — 출처 조사\n\n- 단계: R1\n- 상태: 예정\n- 이전: T001\n- 다음: 없음\n\n${reviewTable()}`);
  writeManifest();
  const commit = () => { git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD').trim(); };
  return { root, manifest, put, get, writeManifest, git, commit };
}

const hasError = (result, pattern) => assert.ok(result.errors.some((error) => pattern.test(error)), result.errors.join('\n'));

test('새 저장소의 일관된 작업·파일 목록을 통과시킨다', (t) => {
  const f = fixture(t);
  const result = checkProject({ root: f.root });
  assert.deepEqual(result.errors, []);
  assert.equal(result.filesChecked, 4);
  assert.equal(result.tasksChecked, 3);
});

test('등록하지 않은 신규 파일을 검출한다', (t) => {
  const f = fixture(t);
  f.put('src/new.mjs', 'export const value = 1;\n');
  hasError(checkProject({ root: f.root }), /목록에 파일이 없습니다: src\/new\.mjs/);
});

test('삭제된 파일이 목록에 남으면 실패한다', (t) => {
  const f = fixture(t);
  f.commit();
  rmSync(join(f.root, 'README.md'));
  hasError(checkProject({ root: f.root }), /삭제되었거나 관리 대상이 아닌 경로.*README\.md/);
});

test('이름 변경의 이전 경로와 새 경로 누락을 함께 검출한다', (t) => {
  const f = fixture(t);
  f.commit();
  renameSync(join(f.root, 'README.md'), join(f.root, 'GUIDE.md'));
  const result = checkProject({ root: f.root });
  hasError(result, /삭제되었거나 관리 대상이 아닌 경로.*README\.md/);
  hasError(result, /목록에 파일이 없습니다: GUIDE\.md/);
});

test('중복 경로와 사라진 연관 경로를 검출한다', (t) => {
  const f = fixture(t);
  f.manifest.files.push({ ...f.manifest.files[0] });
  f.manifest.files[1].related_paths = ['missing.md'];
  f.writeManifest();
  const result = checkProject({ root: f.root });
  hasError(result, /경로가 중복/);
  hasError(result, /연관 파일 경로가 유효하지 않습니다: missing\.md/);
});

test('빈 역할·갱신 조건과 잘못된 우선순위를 검출한다', (t) => {
  const f = fixture(t);
  Object.assign(f.manifest.files[0], { role: ' ', priority: 'P9', update_when: [] });
  f.writeManifest();
  const result = checkProject({ root: f.root });
  hasError(result, /role이 비어/);
  hasError(result, /priority는/);
  hasError(result, /갱신 조건이 필요/);
});

test('저장소 밖 경로를 거부한다', (t) => {
  const f = fixture(t);
  f.manifest.files[0].path = '../outside.md';
  f.writeManifest();
  hasError(checkProject({ root: f.root }), /안전하지 않거나 비어 있는 파일 경로/);
});

test('존재하지 않는 최근 검토 작업을 검출한다', (t) => {
  const f = fixture(t);
  f.manifest.files[0].reviewed_in = 'T999';
  f.writeManifest();
  hasError(checkProject({ root: f.root }), /reviewed_in이 존재하지 않는 작업/);
});

test('작업에 파일별 검토 기록이 없으면 실패한다', (t) => {
  const f = fixture(t);
  f.put('docs/WORKPLAN.md', f.get('docs/WORKPLAN.md').replace('| `README.md` | 수정 | 최초 등록 및 확인 |\n', ''));
  hasError(checkProject({ root: f.root }), /T001에 해당 파일의 검토 기록이 없습니다/);
});

test('예정 작업을 이미 검토한 작업으로 사용할 수 없다', (t) => {
  const f = fixture(t);
  f.manifest.files[0].reviewed_in = 'T002';
  f.writeManifest();
  hasError(checkProject({ root: f.root }), /아직 예정인 작업을 최근 검토 작업으로 사용할 수 없습니다/);
});

test('로드맵과 상세 계획의 상태 불일치를 검출한다', (t) => {
  const f = fixture(t);
  f.put('docs/ROADMAP.md', f.get('docs/ROADMAP.md').replace('"stage":"R0"', '"stage":"R1"'));
  hasError(checkProject({ root: f.root }), /ROADMAP과 WORKPLAN의 현재 단계/);
});

test('JSON만 갱신하고 사람용 표의 현재 단계를 남겨두면 실패한다', (t) => {
  const f = fixture(t);
  f.put('docs/ROADMAP.md', f.get('docs/ROADMAP.md').replace('| 현재 단계 | R0 관리 기반 |', '| 현재 단계 | R1 출처 조사 |'));
  hasError(checkProject({ root: f.root }), /현재 위치 표의 '현재 단계'이 project-state와 다릅니다/);
});

for (const [label, original] of [['이전 작업', 'T000'], ['현재 작업', 'T001'], ['다음 작업', 'T002']]) {
  test(`사람용 로드맵 표의 '${label}' ID가 오래되면 실패한다`, (t) => {
    const f = fixture(t);
    f.put('docs/ROADMAP.md', f.get('docs/ROADMAP.md').replace(`| ${label} | ${original}`, `| ${label} | T999`));
    hasError(checkProject({ root: f.root }), new RegExp(`현재 위치 표의 '${label}'이 project-state와 다릅니다`));
  });

  test(`작업 계획 맨 앞의 '${label}' 요약 ID가 오래되면 실패한다`, (t) => {
    const f = fixture(t);
    f.put('docs/WORKPLAN.md', f.get('docs/WORKPLAN.md').replace(`- ${label}: ${original}`, `- ${label}: T999`));
    hasError(checkProject({ root: f.root }), new RegExp(`'${label}' 요약이 project-state와 다릅니다`));
  });
}

test('사람용 현재 위치 표가 없으면 실패한다', (t) => {
  const f = fixture(t);
  f.put('docs/ROADMAP.md', `${stateBlock}\n\n# 로드맵\n`);
  hasError(checkProject({ root: f.root }), /'## 현재 위치' 표가 필요합니다/);
});

test('현재 위치 표의 작업 행이 없으면 실패한다', (t) => {
  const f = fixture(t);
  f.put('docs/ROADMAP.md', f.get('docs/ROADMAP.md').replace('| 다음 작업 | T002 — 출처 조사: 예정 |\n', ''));
  hasError(checkProject({ root: f.root }), /현재 위치 표의 '다음 작업' 행이 정확히 하나 필요합니다/);
});

test('작업 계획의 사람용 요약이 없거나 중복되면 실패한다', (t) => {
  const f = fixture(t);
  f.put('docs/WORKPLAN.md', f.get('docs/WORKPLAN.md').replace('- 이전 작업: T000 — 확인, 완료.\n', '').replace('- 다음 작업: T002 — 출처 조사, 예정.', '- 다음 작업: T002 — 출처 조사, 예정.\n- 다음 작업: T002 — 중복.'));
  const result = checkProject({ root: f.root });
  hasError(result, /작업 섹션 앞의 '이전 작업' 요약이 정확히 하나 필요합니다/);
  hasError(result, /작업 섹션 앞의 '다음 작업' 요약이 정확히 하나 필요합니다/);
});

test('이전·현재·다음 포인터의 중복을 검출한다', (t) => {
  const f = fixture(t);
  for (const path of ['docs/ROADMAP.md', 'docs/WORKPLAN.md']) {
    f.put(path, f.get(path).replace('"next":"T002"', '"next":"T001"'));
  }
  hasError(checkProject({ root: f.root }), /이전·현재·다음 작업은 서로 다른 작업/);
});

test('완료 작업에 미해결 검토가 남으면 실패한다', (t) => {
  const f = fixture(t);
  f.put('docs/WORKPLAN.md', f.get('docs/WORKPLAN.md').replace('- 상태: 진행 중', '- 상태: 완료').replace('| `README.md` | 수정 |', '| `README.md` | 미해결 |'));
  hasError(checkProject({ root: f.root }), /미해결 파일이 있어 완료/);
});

test('존재하지 않는 다음 작업과 순환 참조를 검출한다', (t) => {
  const f = fixture(t);
  f.put('docs/WORKPLAN.md', f.get('docs/WORKPLAN.md').replace('- 다음: 없음', '- 다음: T001'));
  hasError(checkProject({ root: f.root }), /다음 작업 참조에 순환/);
  f.put('docs/WORKPLAN.md', f.get('docs/WORKPLAN.md').replace('- 다음: T001', '- 다음: T999'));
  hasError(checkProject({ root: f.root }), /존재하지 않는 작업을 참조합니다: T999/);
});

test('비추적 생성물은 제외하되 같은 패턴의 추적 파일은 숨기지 않는다', (t) => {
  const f = fixture(t);
  f.put('dist/index.html', '<h1>generated</h1>');
  assert.deepEqual(checkProject({ root: f.root }).errors, []);
  f.git('add', 'dist/index.html');
  hasError(checkProject({ root: f.root }), /목록에 파일이 없습니다: dist\/index\.html/);
});

test('최초 변경 묶음은 모든 파일의 신규 검토 기록으로 통과한다', (t) => {
  const f = fixture(t);
  f.git('add', 'README.md');
  f.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'initial');
  f.put('README.md', '# Updated fixture\n');
  const result = checkProject({ root: f.root, base: 'HEAD' });
  assert.deepEqual(result.errors, []);
  assert.equal(result.changedFiles.length, 4);
});

test('과거 검토 기록만 남긴 새 변경은 기준 커밋 검사에서 실패한다', (t) => {
  const f = fixture(t);
  const base = f.commit();
  f.put('README.md', '# Unreviewed change\n');
  hasError(checkProject({ root: f.root, base }), /README\.md: 기준 커밋 이후 갱신된 작업의 파일 검토 기록이 없습니다/);
});

test('이번 변경의 검토 근거를 갱신하면 기준 커밋 검사를 통과한다', (t) => {
  const f = fixture(t);
  const base = f.commit();
  f.put('README.md', '# Reviewed change\n');
  f.put('docs/WORKPLAN.md', f.get('docs/WORKPLAN.md').replace('| `README.md` | 수정 | 최초 등록 및 확인 |', '| `README.md` | 수정 | 검색 기능 안내 변경을 검토 |'));
  assert.deepEqual(checkProject({ root: f.root, base }).errors, []);
});

test('이름 변경은 이전·새 경로를 모두 이번 작업에서 검토해야 한다', (t) => {
  const f = fixture(t);
  const base = f.commit();
  renameSync(join(f.root, 'README.md'), join(f.root, 'GUIDE.md'));
  f.manifest.files[0].path = 'GUIDE.md';
  f.writeManifest();
  f.put('docs/WORKPLAN.md', f.get('docs/WORKPLAN.md').replace('| `README.md` | 수정 | 최초 등록 및 확인 |', '| `GUIDE.md` | 수정 | README.md에서 이름 변경 |'));
  const result = checkProject({ root: f.root, base });
  hasError(result, /README\.md: 기준 커밋 이후 갱신된 작업의 파일 검토 기록이 없습니다/);
  f.put('docs/WORKPLAN.md', f.get('docs/WORKPLAN.md').replace('| `GUIDE.md` | 수정 | README.md에서 이름 변경 |', '| `GUIDE.md` | 수정 | README.md에서 이름 변경 |\n| `README.md` | 수정 | GUIDE.md로 이름 변경되어 삭제 |'));
  assert.deepEqual(checkProject({ root: f.root, base }).errors, []);
});

test('올바르지 않은 기준 커밋은 조용히 변경 검사를 생략하지 않는다', (t) => {
  const f = fixture(t);
  f.commit();
  hasError(checkProject({ root: f.root, base: 'does-not-exist' }), /기준 커밋 변경 검사를 실행할 수 없습니다/);
});
