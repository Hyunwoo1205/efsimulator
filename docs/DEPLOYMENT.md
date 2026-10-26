# Sites 배포·DB API 운영 계획

> T023 최신 사용자 결정: API 전용 Site를 앱과 분리한다. GitHub api-server-setup의 services/catalog-api가 독립 소스 root이며 source export 후 새 Sites에 등록·전달한다. 이번 작업은 source/데이터 업로드 준비까지이며 실제 서비스 등록·배포·원격 DB 수입은 후속이다. [API 준비 확인서](API_SERVER_PREPARATION.md)를 따른다.

2026-10-26 T022: 사용자의 최신 결정에 따라 이후 배포는 **Sites**를 기본으로 한다. GitHub `Hyunwoo1205/efsimulator`의 `work`가 개발 기준이며 `main`은 운영 반영용이다. 이번에는 이관·호환성 확인과 문서를 갱신했고 서비스를 생성하거나 배포하지 않았다. [이관 확인서](MIGRATION_STATUS.md), [작업 계획](WORKPLAN.md), [전환 전 Pages 계획](https://github.com/Hyunwoo1205/efsimulator/blob/8ece93492608f4644e15f0952446e808b30c8f6c/docs/DEPLOYMENT.md)을 함께 참조한다.

## 1. 확인한 기능과 선택

| 항목 | 확인 결과 | 후속 실행 |
| --- | --- | --- |
| GitHub 소스 | `work` 기준 SHA 8ece934, 앱은 `web/*`, build는 `dist/` 출력 | GitHub를 기준으로 유지하고 Sites 소스 저장소와 SHA 대응 기록 |
| 정적 배포 | Sites는 `.openai/hosting.json`의 `static.directory=dist`를 지원 | T012에서 새 본 앱 Site를 등록하고 실제 반환 ID를 저장 |
| 정적 구조 검사 | 공식 `prepare-site-build.cjs`가 실제 산출물을 static으로 수락. 7파일 215,973 bytes 바이트 동일 | 프로젝트 ID 없는 로컬 구조 검사이며 실제 등록·배포 성공과 구분 |
| 서버/API | Sites 공식 Vinext starter는 Worker 서버 코드와 API 경로 지원 | T011에서 계약·이식 범위 확정, T016에서 실제 운영 검증 |
| DB/파일 | Sites는 D1 구조화 데이터와 R2 파일 binding을 제공·연결 | 실제 용량·쿼리·권한·비용·백업 확인 후 필요한 binding 선언 |
| 계정 연결 | 이번 대화에서 Sites 소유 목록 조회 성공 | 특정 Site 생성·쓰기 credential·배포·D1/R2 provisioning은 별도 미검증 |
| Node/npm | 저장소 24.19.0/11.9.0. 이번 실행 24.22.1/11.9.0 | 버전 기준은 변경하지 않음. 새 실행 환경의 차이와 CI 근거를 분리 |
| 기존 Pages | 실제 대시보드·현재 연결 상태·환경 설정은 이번 미조회 | 기존 설정을 자동 해제하거나 삭제하지 않음. 종료 전환은 별도 운영 작업 |

첫 검토판은 기존 정적 앱의 `dist`를 재사용한다. 최종 자체 API는 Sites의 Worker 서버 + D1을 우선 후보로 하고, 원문·이미지·불변 버전은 필요성과 권리를 확인해 R2를 사용한다. 앱과 API는 별도 Site에 두고 데이터 두 계층의 논리 경계를 유지한다. 서비스 간 인증·CORS·독립 배포·비용을 검증하고 GitHub 하위 API 소스만 export한다.

이는 기술적 가능성과 구현 방향이다. 실제 배포·데이터 수입·응답·운영 비용을 이미 검증한 결과가 아니다. Sites의 계정별 요금/쿼터는 현재 미확인이며 Cloudflare Free의 수치를 Sites 무료 보장으로 사용하지 않는다.

## 2. 소스와 공개 산출물

GitHub 저장소를 Sites가 자동 감시한다고 가정하지 않는다. 지원 흐름은 **검증된 소스 → Sites 제공 소스 저장소로 push → 같은 소스의 빌드 산출물 저장 → 저장 버전 배포**다. GitHub push와 Sites 배포는 별개다.

공식 `site-workflow.mjs`는 credential의 `remote_url`로 직접 push하며 영구 origin 설정을 교체하지 않는다. 따라서 기존 `work` 체크아웃과 GitHub origin을 유지할 수 있는 경로가 있다. 이미 Sites 원격 소스가 있다면 먼저 열고 선조 관계를 확인한다. 이력이 갈라졌거나 로컬 변경이 충돌하면 보존·조정 후 진행하며 강제 push하지 않는다. 실제 반환된 checkout 경로와 credential의 branch를 따르고 branch 이름이나 프로젝트 ID를 추측하지 않는다.

현재 저장소에는 `.openai/hosting.json`이 없다. 새 등록 시 반환된 진짜 `project_id`를 helper로 저장하고 FILE_SYNC에 등록한다. 등록 전 가짜 ID를 만들지 않는다. 로컬 진단 복사본의 ID 없는 manifest는 등록용 설정이 아니다. 기존 별도 Sites 초기 페이지와 소스는 이관에서 제외한 결정을 유지한다.

공개 정적 경계는 `dist/`다. raw 입력, `artifacts/catalog.sqlite`, 연구 자료, `.env`, 인증정보, 문서나 Git 이력을 공개 산출물에 넣지 않는다. 현재 루트의 7개 Pages 호환 파일은 생성물이며 계속 원본 `web/*`/seed에서 build/export한다. Sites 검증과 이전 Pages 전환 범위를 확인하기 전 호환 파일·도구·CI를 제거하지 않는다.

Sites source helper가 관리하는 소스 commit과 공개 archive는 구분한다. source helper가 반환한 `project_id`, `commit_sha`, `archive`를 그대로 사용하며 소스 push 뒤 archive 내용이 바뀌면 새로 검증·저장한다. GitHub SHA, Sites source SHA, 데이터 버전, 저장 version ID, 배포 ID, URL 대응을 배포 기록에 남긴다.

## 3. 정적 앱과 Worker API의 경계

정적 manifest는 `static.directory`로 공개 파일을 지정한다. **정적 빌드와 D1/R2 runtime binding·DB migration을 함께 사용할 수 없다.** 정적 JSON 제공에서 동적 DB API로 확장할 때 Worker 빌드로 전환하고 static 설정을 제거한다. 공식 starter와 `sites()` 빌드 통합을 유지하며 기존 앱 전체를 무조건 재작성하지 않는다.

Sites 서버는 Cloudflare Workers에서 실행된다. 스킬 문서 기준 isolate 메모리는 128MB이며 외부 연결은 HTTP 기반, raw TCP는 사용할 수 없다. 장시간 상주하는 일반 Node 서버나 로컬 디스크 DB를 그대로 올리는 방식으로 설계하지 않는다. 현재 `scripts/serve.mjs`는 `node:http` 정적 미리보기이며 운영 API가 아니다. 현재 `node:sqlite`는 오프라인 검증·staging에 재사용할 수 있지만 hosted 영속 저장은 D1 접근 코드로 구현한다.

D1 schema는 실제 raw·관계·개정 계약을 확정한 뒤 설계한다. 스키마 migration은 작은 schema-only 변경으로 유지하고, 대량 seed·backfill은 별도 인증 배치 수입으로 처리한다. 적용된 migration SQL·snapshot·journal은 불변이며 후속 변경은 새 migration으로 추가한다. 배포 실패에도 migration이 적용됐을 수 있으므로 상태를 확인한 뒤 복구한다. 한 prepare 호출에는 SQL 한 문장을 사용하고 여러 문장은 batch로 처리한다. 요청 처리 중 테이블 생성·변경을 하지 않는다.

전체 누적 API와 사이트 API는 범위·권한·버전을 분리한다. 기존 제안인 `/catalog-api/v1/`와 `/site-api/v1/`는 아직 미구현 경로다. 원문 공개 권리와 이미지 저장·재배포 조건을 확인한 필드만 노출한다. 공개 Site의 관리 쓰기는 별도 서버 인증·권한 확인을 요구한다. private Site의 서비스 접근은 지원되는 서버 credential로만 수행하며 브라우저 코드나 Git에 넣지 않는다. 로그인 여부와 관리자 권한은 별도로 검사한다.

## 4. T012 — Sites 비공개 검토 배포

입력은 T011에서 검증한 현행 한 팩 표본, 부분 범위 표시, 로컬 검사 결과다.

1. 실제 앱을 기준으로 새 Site를 한 번 등록하고 기본 private 상태·반환 ID를 보존한다. 이관 제외한 예전 초기 Site를 재사용하지 않는다. 등록·credential 작업은 배포 구현 단계에 수행한다.
2. 정적형 또는 Worker형 manifest, source 전달 경로, 데이터·공개 범위·직전 정상본을 확정한다. 실제 source helper가 반환한 checkout을 사용한다.
3. 저장소 관리 검사·관련 테스트·표본 재현·build와 필요한 브라우저 검사를 수행한다. 고정 도구 버전과 환경 차이를 기록한다. 기존 Pages 사본을 유지하는 동안 `pages:check`도 통과해야 한다.
4. 공식 Sites build helper는 저장소 `package.json`의 build script를 실행할 수 있다. source helper로 검증 소스를 commit/push하고 같은 상태에서 archive를 만든다. 이미 성공한 검사를 입력 변경 없이 반복하지 않는다.
5. owner-private audience를 확인한 뒤 지원되는 private 저장·배포 도구를 사용한다. Sites의 URL은 private이더라도 실제 hosted 배포 URL이며 별도 테스트 인프라로 단정하지 않는다.
6. 정확한 SHA·version·배포 ID·URL과 관측 시간을 기록한다. 깊은 상품/카드 주소, 새로고침, JSON/이미지, 없는 자산의 404, 모바일, 접근성, 실패 fallback을 확인한다.
7. 사용자에게 범위·미확인·동작·비용/용량 확인 결과를 보여주고 검토 내용을 반영한다.

기존 `_redirects`와 `_headers`는 파일로 보존됐을 뿐 Sites에서의 적용 의미는 이번에 검증하지 않았다. 실제 라우팅에서 상세 주소가 홈으로 redirect되지 않고 없는 JSON을 HTML 200으로 돌려주지 않아야 한다. 맞지 않으면 제한된 정적 경로 생성 또는 Worker 라우팅을 구현하고 같은 동작을 다시 검사한다. 전역 SPA fallback으로 없는 데이터·자산을 숨기지 않는다.

## 5. T013 — 검토 후 운영 반영

기존 프로젝트의 검토→운영 승인 구분을 유지한다. 구체적인 검토판·동작·데이터 범위·공개 대상·전환 설정을 확인한 뒤 해당 범위의 운영 반영을 수행한다. 이번 인수인계 요청은 실제 배포나 main 병합 단계까지 실행한 것이 아니다.

- 검토한 source SHA·데이터 버전·직전 정상본을 고정하고 GitHub main 반영과 Sites audience/운영 반영을 구분해 기록한다.
- Sites 공개 배포·사용자 접근 변경은 지원 도구로 수행하고 현재 audience를 임의 변경하지 않는다.
- 실패 시 소스/앱 버전 복구와 DB migration·데이터 포인터 복구를 별도로 검증한다. 앱 rollback이 D1 schema/data rollback을 자동 수행한다고 가정하지 않는다.
- 기존 Pages 연결의 해제·도메인 전환·루트 호환 생성물 제거는 실제 설정과 복구 경로를 확인한 뒤 별도 영향 검토를 거친다. Sites 사용 결정만으로 기존 서비스를 삭제하지 않는다.

## 6. T015/T016 — 자동 갱신·자체 API 운영

사이트 방문 GET은 이미 검증·저장된 버전만 읽는다. 갱신 writer는 정상 허용 출처 관측→검증→누적 신규/개정 보존→현행 projection→원자적 발행을 수행한다. 누락·오류·빈 응답으로 누적 엔티티나 마지막 정상본을 지우지 않는다. 실제 종료 시각을 지난 팩을 오래된 정상본만으로 판매 중이라 표시하지 않는다.

Sites 연계 자동화와 지원되는 외부 작업 실행 경로를 비교하되, source 접근과 Site 쓰기 권한을 각각 검증한다. 서비스 인증, single-writer, 중복 실행, 재시작, 오류/급감, 게시 실패, 독립 백업·복원, 비용을 검증한 뒤 스케줄을 설정한다. fresh unattended 실행에서 데이터를 쓰고 다시 읽어 확인해야 한다. 이번에는 자동화를 만들거나 활성화하지 않았다.

일상적인 DB 데이터 갱신은 앱 전체 배포와 분리한다. 정적 snapshot을 사용하는 동안은 의미 있는 변화가 있을 때 필요한 버전만 발행하고 변경 없음 실행은 건너뛴다. 과거 Pages의 월 빌드 수를 Sites의 한도로 복사하지 않는다. RTO/RPO·보존 기간은 DATA_LIFECYCLE의 제안값을 실제 복구 시험으로 확정한다.

Sites의 실제 DB·요청·저장·파일 한도, 비용, 백업과 안정 공급을 충족하지 못할 때 대안을 비교한다. 보유 OCI는 ARM64·접속·운영·비용·백업을 실측할 차선 후보이며 현재 사용 가능하다고 확정하지 않는다.

## 7. 3D 자산과 검증 근거

3D 렌더링은 브라우저에서 수행하고 서버는 검증된 데이터·정적 자산을 제공한다. 압축·LOD·지연 로딩·해제·2D fallback·저사양 모바일 성능과 파일 크기·요청·저장비를 측정한다. 현재 3D 모델·파이프라인은 미구현이다. R2나 별도 서버는 실제 크기·권리·요금이 확인됐을 때만 채택한다.

이번 기능 판단의 근거는 현재 제공된 Sites 스킬과 배포 helper 코드다.

- Sites SKILL.md: 정적/Worker 빌드, source helper, private 저장·배포, Workers 실행 제약.
- `references/storage.md`: D1/R2 binding, schema-only migration, 데이터 수입 분리.
- `references/identity-and-secrets.md`: private service access, 공개 쓰기 인증, secret 보관.
- `references/recurring-updates.md`: 독립 source/writer 권한·unattended 읽기 확인·데이터와 재배포 분리.
- `templates/vinext-starter/README.md`: 서버 entrypoint·D1·local/hosted 분리·공식 빌드 통합.
- `scripts/site-workflow.mjs`: 기존 Git 체크아웃 검증, direct URL push, 원격 이력 충돌 보호.
- `scripts/build-site.mjs`와 `skills/sites/scripts/prepare-site-build.cjs`: package build 재사용, static 디렉터리와 entrypoint 검사, static의 binding/migration 금지.

로컬 검사 위치와 해시·검증 범위는 [구조화 확인서](../data/research/work-migration-verification.json)에 보존한다. 실제 Sites 배포·API·DB·캐시·라우팅·계정별 비용 검증은 후속 작업이다.
