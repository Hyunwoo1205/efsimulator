# efsimulator

현재 데이터 계약은 [수집·가공·live·archive](docs/CATALOG_DATA_CONTRACT.md)다. raw는 HTML 수집 원본으로 누적하고, 자체 API는 공식 KR와 EFHub에서 함께 확인한 상품의 가공 자료만 조회한다. 판매 종료 상품은 선수 상세 전체와 함께 보존한다. 아래 이전 ‘전체 누적 DB/API’ 설명은 T023까지의 이력이며 T024가 우선한다.

**API 전용 업로드 준비:** `api-server-setup` 브랜치의 [services/catalog-api](services/catalog-api/README.md)는 앱과 별도의 Sites 프로젝트로 배포할 독립 소스입니다. [준비 확인서](docs/API_SERVER_PREPARATION.md)를 참조하세요. 이후 등록·배포·원격 수입·실제 앱 연동은 별도 단계입니다.

**이관·현재 작업:** [MIGRATION_STATUS](docs/MIGRATION_STATUS.md)를 먼저 확인합니다. GitHub `work`를 개발 기준으로 사용하며 이후 배포는 **Sites**입니다. 기존 정적 앱의 빌드 준비는 통과했고 자체 API는 Sites Worker + D1/R2를 우선 검토합니다. 실제 배포·DB 운영은 후속 단계입니다.

EFHub에서 확보 가능한 모든 선수 카드와 선수팩을 가공·보존하는 **전체 누적 DB/API**를 만들고, 여기서 [공식 한국어 확률표](https://efootball-web.konami.net/probability_kr.php)에 현재 유효하게 게재된 선수팩과 그 카드를 골라 **사이트용 DB/배포 스냅샷**으로 제공합니다. 두 계층은 범위·갱신·삭제 정책이 다릅니다.

- **전체 누적층:** 확보한 모든 players/packs 원문과 원본 ID를 보존합니다. 신규 ID를 추가하고 기존 엔티티는 삭제하지 않습니다. 기존 정보 변경은 새 개정/관측으로 저장하여 이전 값을 보존합니다. 응답에서 사라진 항목을 삭제로 해석하지 않습니다. 원문에 있는 Standard 실명·과거 카드도 보존 대상이며, 별도의 감독 수집/상품 연결은 지원하지 않습니다.
- **사이트층:** 공식 표의 목록·종료 UTC·관측 신선도를 검증한 현재 판매 팩과 해당 카드만 누적층에서 추출합니다. 판매 변동에 따라 추가·수정·활성 제외하며, 누적층에서는 보존합니다. 일괄 지급 고정 팩은 개봉 시뮬레이터에서 제외합니다.
- **가상 Standard:** 사이트/향후 시뮬레이터에서 같은 회차의 모든 특수 카드가 검증된 경우에만 공식 초기 총원과의 차이를 가상 그룹으로 표현합니다. 실제 선수 ID를 위조하거나 특수 누락을 메우지 않습니다. 전체 원문 보존 범위와 별개입니다.

**현재는 계획과 기존 코드의 차이가 있습니다.** 기존 9상품 83카드의 단일 SQLite/정적 표본과 오프라인 페이지 병합 도구는 동작하지만, 전체 누적 API·현행 사이트 필터·자동 운영·가상 슬롯·시뮬레이터는 미구현입니다. EFHub는 사용자가 우선 지정한 원출처이며 정상 지속 접근·이용조건·구성/이미지 검증이 모두 통과했다는 뜻은 아닙니다.

대상 Work에서 만든 `players_raw.json` v1은 부모 환경에서 오프라인 검증됐습니다. 실제 16,801,176 bytes·47,397개 카드 객체/고유 문자열 ID·중복/충돌/중복 키 0이며 name/imageUrl/overallRating/playerType는 전 항목 존재·비어 있지 않습니다. 페이지/출처/수집 시각/total 메타가 없어 전체 수집·현재성·팩 관계·이미지 실제 로드는 미검증입니다. 이전 50,840과의 3,443 차이는 **사용자 설명상 중복 제거 결과**입니다. 원본 페이지/중복 제거 로그는 재검증하지 않았다는 한계만 유지하며 전체 재수집하지 않습니다.

`packs_raw.json`도 제작됐으며 상위 환경의 파일 내부 검사를 마쳤습니다. 197,874 bytes의 배열에 객체 1,699개가 있고, 고유 slug 1,699개 중 빈 값이 1개이므로 비어 있지 않은 고유 slug는 1,698개입니다. 빈 name 1개와 인덱스 99의 `dummy` 의심 항목은 원본을 보존하고 정규화·공개 단계에서 격리 검토합니다. 팩 버전은 Library의 `current_version_number = 0`이며 v1로 표기하지 않습니다.

팩 항목에는 `name`, `slug`, `date`, `playerCount`만 있고 카드 ID·선수 명단이 없어 두 raw만으로 팩과 카드를 연결할 수 없습니다. 다음 T010에서는 **기존 대상 Work의 팩 상세·관계 자료부터 확인**하고, 검증된 팩 회차와 카드 ID 관계를 확보해 T011의 정규화·누적 DB 설계로 이어갑니다. 두 raw를 다시 수집하거나 새 채팅을 만들지 않습니다. 파일 내부 검사와 원래 페이지 완전성·현재성·이미지 실제 로드는 구분합니다.

별도 Sites 초기 페이지·소스·번들은 계속 이관에서 제외합니다. [인수인계](docs/CHATGPT_WORK_HANDOFF.md)와 [최신화 점검](docs/FILE_SYNC_AUDIT.md)을 먼저 읽으세요. 이관의 기본 경로는 최신 GitHub `work`이며 bundle은 선택 백업입니다. T022에서는 원격 work 8ece934의 CI 2개 성공을 확인하고 로컬 이관·문서를 갱신했습니다. 이번 변경을 추가 원격 push하지 않습니다. main 병합·배포 설정 변경·새 수집·DB/API·자동화는 실행하지 않습니다.

## 계획과 관리

- [ROADMAP](docs/ROADMAP.md): 새 단계·입력/산출물·완료 조건과 이전 계획 대응표.
- [WORKPLAN](docs/WORKPLAN.md): 현재/이전/다음 작업·상세 순서·추가 조건·검증·파일별 최신화.
- [FILE_SYNC](docs/FILE_SYNC.json): 모든 관리 파일의 역할·우선순위·연관 파일·갱신 조건.
- [공식 기준표](docs/sources/CURRENT_SHOP_COVERAGE.md)·[API 선정](docs/API_SELECTION.md)·[DB 구조](docs/ARCHITECTURE.md)·[수집](docs/COLLECTION.md).
- [갱신·아카이브·자체 API](docs/DATA_LIFECYCLE.md)·[배포 전/후와 호스팅](docs/DEPLOYMENT.md)·[시뮬레이터/3D](docs/SIMULATOR_PLAN.md).

작업마다 문서 상태와 변경 영향 검토를 갱신합니다. 파일 추가·삭제·이름 변경은 같은 작업에서 목록과 참조에 반영합니다. 이전 검증/조건 원문은 [이전 WORKPLAN](docs/reference/WORKPLAN_BEFORE_PROBABILITY_SCOPE.md)에 보존합니다. 이전 완료를 새 범위 완료로 해석하지 않습니다.

## 원본 페이지의 오프라인 중간 병합

선수와 팩의 페이지별 원본 JSON을 나중에 제공받으면 `npm run data:merge-pages -- ...`로 각각 하나의 배열로 합칠 수 있도록 준비했습니다. 항목 내부 값은 보존하고 페이지/ID 중복·충돌·누락·합계를 별도 보고서로 검사합니다. [사용법과 입력 조건](docs/RAW_PAGE_MERGE.md)을 따릅니다.

T019 당시에는 전체 원본이 없었습니다. 이후 T021에서 Library의 선수·팩 배열을 모두 검사했습니다. 이미 합쳐진 배열을 페이지 입력 도구에 그대로 넣지 않습니다. 원래 페이지 완전성은 별도 미검증입니다. 2119/50840은 수집 당시 메타 근거를 받기 전까지 사용자 관측 기대값입니다. 이 도구는 네트워크 수집·사이트 선방문·인증 활성화·실제 DB 구축을 하지 않습니다.

## 현재 코드의 실행·검사

기준 도구는 Node.js 24.19.0·npm 11.9.0입니다. 다음 명령으로 기존 표본 구현을 검사할 수 있습니다. 기존 activate.sh는 새 환경에 없을 수 있습니다. 이번 Work의 실제 도구 버전 차이는 이관 확인서에 기록했습니다.

```bash
cd /actual/path/to/efsimulator
npm run project:check
npm test
npm run build
npm run pages:check
npm run preview -- --port 4173
```

새 환경의 의존성 설치는 `npm ci --ignore-scripts --no-audit --no-fund`를 사용합니다. `data:prepare`는 저장 표본 재현이며 실시간 수집/새 공식 대상 반영 명령이 아닙니다. `pages:export`는 기존 호환 경로의 고정 7파일 생성 명령으로, 이번 계획에서는 공개 사본을 변경하지 않습니다. `project:check -- --base <기준SHA>`는 변경 파일의 최신화 검토도 확인합니다. UI 변경 시 기존 Playwright 브라우저 검사를 추가합니다.

Sites 배포는 검증 소스의 Sites source 저장·버전 생성·배포 절차로 진행합니다. GitHub push만으로 Sites 자동 배포를 가정하지 않습니다. 초기 정적 dist와 후속 Worker/D1 API를 구분하며 기존 Pages 호환 7파일은 전환 검증 전에 제거하지 않습니다. 실제 경로·권한·계정 한도/비용·백업·검토/운영 단계는 [DEPLOYMENT](docs/DEPLOYMENT.md)를 따릅니다. PR #1은 Draft·미병합이고 이번에는 배포·main 병합·새 자동화를 수행하지 않았습니다.
