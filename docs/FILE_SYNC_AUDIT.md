# T036 자동 갱신 영향 검토

기준 api-server-setup 80204f5의340관리파일을 현재 로컬과 전량 대조해 차이0을 확인했다. 자동 갱신 운영 지침/대상 설정·세 사이트 검증 도구·엄격한 고정 요약 영수증/CI·두 화면 자동 갱신을 추가했다. 원본/가공 계약과 규칙 해시·매핑은 변경하지 않았다. 신규 경로는 역할/우선순위/연관/갱신 조건과 reviewed_in=T036으로 등록하며 구체적 수정·변경불필요 이유는 WORKPLAN T036에 기록한다. GitHub 소스 기준은 유지하고 로컬의 과거 Git 메타데이터 차이를 미반영으로 오인하거나 reset/clean하지 않는다.

---

> T034 최종검토:공통카드제품6파일과문서/근거8파일을현재원격기준과분리해이번14변경으로확인했다.관리337파일/35작업과로컬735c625기준114경로검사·diff공백검사가통과했다.114는과거기반차이포함이며이번변경수는14다.Site49추적파일과저장소서비스49파일byte일치와실제private배포/글꼴/데이터재조회를확인했다.자세한근거는WORKPLAN T034·card-artwork-T034.json을따르며최종GitHub/CI는원격확인결과로보고한다.

> T034 시작 기준: GitHub api-server-setup ref를 직접 조회해280e44b56d539551a7c68e79167f7cc76c063760, tree1c16174daeccd4717de22d7341162eddbef4f82a를 확인했다. recursive tree의333blob과 FILE_SYNC의 실제 로컬333파일을 Git blob SHA-1로 대조해 차이0·원격 전용0·truncated=false였다. 새 공통 카드 작업의 영향 검토/신규 파일/검증 결과는 WORKPLAN T034와 FILE_SYNC를 따른다. 이 시작 감사는 이후 수정본의 원격 반영이나 CI 성공을 뜻하지 않는다.

> T030 현재 기준: 이 파일은 T020~T023 당시 이관/점검 이력이다. API 전달은 T025로 완료됐고 현재 작업은 실제 제품 설계를 준비하는 단계다. 최신 브랜치·실제 상태·완료 절차는 [현재 인수인계](CHATGPT_WORK_HANDOFF.md)·[ROADMAP](ROADMAP.md)·[WORKPLAN](WORKPLAN.md)을 우선하며 아래의 미배포/이전 work 지시를 현재 금지나 다음 작업으로 재적용하지 않는다.

> T022 최신 이관·Sites 검토 결과는 [MIGRATION_STATUS](MIGRATION_STATUS.md)와 [검증 JSON](../data/research/work-migration-verification.json)을 따른다. 아래는 T020/T021의 전수 점검·검사 이력이다. 이번 T022의 영향 파일 검토는 WORKPLAN에 별도 기록하며 과거 전수 판정을 재실행했다고 주장하지 않는다.

# T020 전수 점검과 T021 검증 반영 보고

2026-10-26 KST 작성. 기준 커밋 `d7f30688b5bcf610f9b35b2d7f680485949f6c19`. 이번 범위는 문서·계획·이관 준비다. 코드가 새 계획을 구현했다고 판정하지 않는다.

## 점검 범위와 판정

- 시작 Git 추적 76개=FILE_SYNC 76개(P0 42/P1 24/P2 10), 등록 누락/중복/삭제 경로 잔존/잘못된 연관 경로 0. 독립 읽기 감사의 관리 검사 76파일/20작업 통과.
- 최종 신규 3개: CHATGPT_WORK_HANDOFF, 이 보고서, work-handoff-inputs.json. 아래 모든 관리 경로를 T020에서 검토했다. 설치물/캐시/빌드 출력/artifacts는 관리 제외이며 GitHub에 있다는 뜻이 아니다.
- 문서 정책 충돌을 정리했다. 과거 출처 7개 상단의 ‘확률표만/Standard·전역 제외’는 역사성 안내로 바꾸고 원래 관측 본문·JSON은 보존했다. reference로 옮긴 4문서의 깨진 상대 링크 17개는 타깃 경로만 정정했다. T009 실패/미통과를 성공으로 바꾸지 않았다.
- 실제 전체 누적 DB/API·현행 projection·현재 판매/종료/신선도 필터는 미구현이다. 기존 9상품 83카드/감독 0·모든 availability unknown/기간 null/구성 partial. catalog의 전체 구성 complete와 새 특수 집합/data_ready/simulation_ready는 후속에서 분리해야 한다.
- 추적 공개 7파일과 기존 dist는 시작 시 바이트 일치. 이번에도 기존 코드/seed/공개 파일/잠금/워크플로·관측 JSON을 변경하지 않는다. 별도 Sites 초기 소스와 번들은 사용자 최신 지시로 이관 제외하며 실제 앱 index는 보존한다.

## T020 당시 GitHub 반영 상태와 이관 한계

직접 `git ls-remote`로 원격 main=`d8891f241e113632884445d60746d9e059a1583b`, work=`5d2cc0abe63f102084e226f9ee385487420aadb5` 확인. 시작 로컬 d7f3068은 work보다 3/main보다 17커밋 앞섰다. T020도 미푸시다. 원격 main은 README 하나뿐이고 원격 work만 연결해도 최신 계획/API 검증/병합 도구/이번 문서가 빠진다. 본 저장소 work bundle과 receipt를 준비하며 push/merge/deploy는 하지 않는다.

원래 76개 밖의 Sites 초기 4파일은 의도적 이관 제외다. Git 비추적 artifacts/저장소 밖 환경도구/Library 파일도 GitHub에 없다. IGNORED_ARTIFACTS 목록은 원문 백업 자체가 아니므로 필요한 고유 원문은 별도 지원 파일 전달이 필요하다. credential/env/쿠키를 옮기지 않는다.

## T020 당시 raw 입력과 도구 한계

대상 Work는 players raw 제작 완료 보고, packs 수집 준비 중이다. Library 메타로 players_raw.json/version 1/16,801,176 bytes/수정 2026-10-26T01:23:42.466991Z 및 ID를 전달받았다. 현 task에는 Library materialize/upload 도구가 없어 내용/SHA/행/ID/필수 필드/정밀도/페이지 근거는 미검증이다. File Service ID를 Sediment 도구에 넣지 않고 재수집하지 않았다. 이미지 요청 0. packs 준비를 완료로 승격하지 않고 기존 대상 채팅의 출력/체크포인트를 이어받는다. 팩 구성 관계는 별도다.

공식 마지막 관측은 2026-10-25 15:21 UTC이다. 그때 7개 중 Midfielders 종료는 10월 26일 10:59:59 KST로 이번 점검 시각에 이미 지났다. 이번 공식 재요청은 0이며 예전 7개를 현재 목록으로 쓰지 않는다.

## 선수 raw 검증 당시의 T021 중간 결과와 승인

부모 환경이 Library players_raw.json v1을 실제로 오프라인 검증한 결과를 전달했다. 16,801,176 bytes·SHA256 `16b5ac4919480bbbf8e5158946322fac1f406f0d66701c4d52c9274107dc94c4`·최상위 배열 47,397 객체/고유 decimal-string ID 47,397, 중복 ID/충돌/중복 키 0이다. name/imageUrl/overallRating/playerType는 모두 존재·nonnull·nonempty, OVR 정수 40~102/타입 정수 1~8(명칭/OVR 조건 미검증). nationality/nationalityCode 전 빈/nameZh 795 빈; playingStyle 7,927/playingStyleDefensive 42,561 미존재를 구분한다.

사용자 설명상 50,840→47,397의 3,443 차이는 중복 제거 결과다. 현재 파일 고유 ID 검증과 원래 중복 제거 로그 검증은 별개이며 후자는 실행하지 않았다. 페이지/커서/출처/수집 시각/total 메타가 없어 원래 페이지 완주/현재성·팩 관계·이미지 실로드는 미검증이다. 누락 의심을 주요 차단 요인으로 삼거나 전체 재수집하지 않는다. 대상 Work의 packs 수집 준비를 기존 출력/체크포인트에서 이어받는다.

최신 명시 승인은 기존 미푸시 커밋/최신 검증 문서를 원격 work에 정상 push하고 기존 CI/연결 preview 트리거를 확인하는 범위다. 원격 5d2cc0a를 재확인/fetch했고 현재 이력의 선조임을 확인했다. 강제 push/main 병합/배포 설정 변경/새 자동화는 금지한다. 이관은 GitHub work 우선이며 bundle은 선택 백업이다. T021 관리 검사 79파일/22작업/변경 13경로·상대 링크 149개/diff 검사 통과. 실제 원격 SHA/CI와 선택 bundle 최종 해시는 후속 receipt/최종 보고로 확인한다. 별도 Sites 초기 소스는 계속 이관 제외다.

## packs 완료 후 T021 검사 마감과 다음 계획

대상 Work의 packs_raw.json 제작 완료 보고와 상위 환경의 실제 파일 내부 검사 결과를 반영했다. Library 검색 버전 메타는 null, materialize의 current_version_number는 0이다. 실제 크기는 197,874 bytes이며 SHA-256은 `bfe4590cfa5acb18106a98206b9acad71616f2622cf0d44ae3257040a56b97d6`이다. 유효 JSON 배열의 객체는 1,699개이며 모든 항목에 name·slug·date·playerCount 네 필드만 있다. 중복 slug·충돌·중복 JSON 키는 0개지만 고유 slug 1,699개에는 빈 값 1개가 포함돼 비어 있지 않은 고유 slug는 1,698개다. 빈 name도 1개다.

날짜는 2022-04-01~2026-10-26이며 잘못된 날짜는 없다. playerCount는 정수 1~48이고 합계 12,946은 원본 선언값 합계일 뿐 실제 구성·고유 선수·공식 풀 크기가 아니다. date와 Library 생성 시각을 수집 시각으로 해석하지 않는다. 0부터 세는 인덱스 99의 dummy 항목(date 2026-07-23, playerCount 33)은 placeholder 의심으로 보존하며 빈 name·slug와 함께 정규화·공개 시 격리 검토한다.

팩에는 pack ID·card ID·선수 명단·중첩 배열·팩 이미지가 없어 두 raw만으로 조인하지 못한다. 이름 추측 연결은 하지 않았다. 페이지·커서·수집 시각·total 메타도 없으며 페이지 완전성은 별도 한계다. 원본 수정과 EFHub·이미지 요청은 없었고 선수 SHA가 기존 값과 같음을 다시 확인했다.

양쪽 파일 내부 검사와 한계 보고를 마쳐 T021을 완료하고 R2/T010 예정으로 이동한다. 기존 Work에 상세·관계 자료가 이미 있는지 먼저 확인한 뒤 검증된 팩 회차→카드 ID manifest를 확보하고 T011에서 실제 필드 기반 스키마·개정·무삭제·격리 계약을 확정한 후 staging 수입한다. 모든 과거 팩 관계 완성을 최초 설계의 새 필수 조건으로 삼지 않는다. 이번에는 문서 갱신·정상 work 푸시·CI만 수행하며 실제 새 수집·DB/API·배포·자동화를 시작하지 않는다.

## T020 검증 기록과 후속 확인

전체 Node 224/224, data:prepare(9상품 83카드), build, Pages 공개 7파일 비교, web/app.js 문법 검사를 통과했다. 코드/테스트/seed/공개 7파일/워크플로/잠금과 기존 관측 JSON은 기준 커밋과 동일하다. UI 변경이 없어 브라우저 재검증은 하지 않았다. 최종 관리 검사 79파일/22작업/변경 28경로, Markdown 상대 링크 149개와 diff 검사가 통과했다. bundle/최종 HEAD·해시는 커밋 후 생성하는 MIGRATION_RECEIPT.json을 따른다.

## 팩 raw 반영의 최종 로컬 검사

테스트 224개, 관리 파일 79개·작업 22개·변경 경로 13개, 표본 빌드, 공개 파일 7개 비교, 상대 링크 151개, diff 검사를 통과했다. 코드·테스트·활성 자료·기존 출처 관측은 기준 116fb19와 같다. 전달받은 팩 검사 메타의 버전·수량·해시 일관성을 확인했으며 이 실행 환경이 원본 파일을 다시 읽은 것은 아니다. 최종 정상 work 푸시의 원격 SHA·CI와 선택 bundle 해시는 receipt·최종 보고를 따른다.

## T020 전수 파일별 역할·우선순위·당시 결과

최종 관리 79개: P0 43, P1 26, P2 10. 우선순위는 검토 순서이며 영향 파일을 제외하지 않는다.

| 경로 | 우선순위 | 역할 | 판정·근거 |
| --- | --- | --- | --- |
| `.github/workflows/project-check.yml` | P0 | PR와 main/work 푸시의 관리 기록·회귀 테스트·실제 표본 재현과 정적 빌드 검사 | 검토 결과 변경 불필요: 실행/의존/CI/제외 규칙은 변경 요구 없음. 기존 검사로 확인하고 push/배포 설정 유지 |
| `.gitignore` | P0 | 비추적 의존성·빌드 출력·로컬 설정 제외 | 검토 결과 변경 불필요: 실행/의존/CI/제외 규칙은 변경 요구 없음. 기존 검사로 확인하고 push/배포 설정 유지 |
| `.nvmrc` | P0 | Node.js 런타임 고정 | 검토 결과 변경 불필요: 실행/의존/CI/제외 규칙은 변경 요구 없음. 기존 검사로 확인하고 push/배포 설정 유지 |
| `404.html` | P0 | Pages root 배포용 추적 생성물; scripts/build.mjs를 기준으로 build/export하며 직접 수정 금지 | 검토 결과 변경 불필요: 기존 표본/공개 호환 생성물 바이트 보존. 별도 Sites 초기 페이지와 무관하며 삭제/재생성 안 함 |
| `AGENTS.md` | P0 | 매 작업의 확인·변경 영향 검토·검증·상태 갱신 규칙 | 수정: 최신 두 계층/이번 문서 범위·Library 도구 한계·기존 대상 채팅과 Sites 제외 지침 반영 |
| `_headers` | P0 | Pages root 배포용 추적 생성물; scripts/build.mjs를 기준으로 build/export하며 직접 수정 금지 | 검토 결과 변경 불필요: 기존 표본/공개 호환 생성물 바이트 보존. 별도 Sites 초기 페이지와 무관하며 삭제/재생성 안 함 |
| `_redirects` | P0 | Pages root 배포용 추적 생성물; scripts/build.mjs를 기준으로 build/export하며 직접 수정 금지 | 검토 결과 변경 불필요: 기존 표본/공개 호환 생성물 바이트 보존. 별도 Sites 초기 페이지와 무관하며 삭제/재생성 안 함 |
| `app.js` | P0 | Pages root 배포용 추적 생성물; web/app.js를 기준으로 build/export하며 직접 수정 금지 | 검토 결과 변경 불필요: 기존 표본/공개 호환 생성물 바이트 보존. 별도 Sites 초기 페이지와 무관하며 삭제/재생성 안 함 |
| `data/catalog.json` | P0 | 이전 정적 표본 공개 JSON 생성 사본; 새 공식 대상/가상 슬롯 미반영 | 검토 결과 변경 불필요: 기존 표본/공개 호환 생성물 바이트 보존. 별도 Sites 초기 페이지와 무관하며 삭제/재생성 안 함 |
| `data/catalog.seed.json` | P0 | 이전 9상품 83카드 누적 표본 원본; 새 공식 대상/가상 슬롯 미반영·원본 보존 | 검토 결과 변경 불필요: 기존 표본/공개 호환 생성물 바이트 보존. 별도 Sites 초기 페이지와 무관하며 삭제/재생성 안 함 |
| `data/research/card-api-audit.json` | P0 | 실제 전체 카드 감사의 403·0쪽·미완료와 정상 UI 형식 진단 결과 | 검토 결과 변경 불필요: 역사적 원관측/실패·필드 근거 그대로 보존. 새 정책은 문서/별도 입력 메타에 기록 |
| `data/research/current-catalog-observations.json` | P0 | 정상 재수집한 9개 상품과 카드 payload·목록/상세 원문 근거 | 검토 결과 변경 불필요: 역사적 원관측/실패·필드 근거 그대로 보존. 새 정책은 문서/별도 입력 메타에 기록 |
| `data/research/followup-observations.json` | P0 | 후속 10회 요청·원문·상품/지역/플랫폼 범위·미확인 근거 | 검토 결과 변경 불필요: 역사적 원관측/실패·필드 근거 그대로 보존. 새 정책은 문서/별도 입력 메타에 기록 |
| `data/research/source-observations.json` | P0 | 실제 HTTP 관측·필드·원문 근거·미확인 범위의 조사 증거 | 검토 결과 변경 불필요: 역사적 원관측/실패·필드 근거 그대로 보존. 새 정책은 문서/별도 입력 메타에 기록 |
| `docs/ARCHITECTURE.md` | P0 | 공급자 중립 ID/원본 매핑·공식 회차/특수 완전성/가상 Standard·staging DB 설계; 미구현 계획 | 수정: 두 계층 경계/전체 누적 무삭제·개정·현행 발행·raw 검증/준비 상태와 후속 게이트 반영 |
| `docs/COLLECTION.md` | P0 | 공식 대상 API 선정 검증용 수집→정식 특수 수집→개별/이미지 저장 검증·실패 보호 계획 | 수정: 두 계층 경계/전체 누적 무삭제·개정·현행 발행·raw 검증/준비 상태와 후속 게이트 반영 |
| `docs/DEPLOYMENT.md` | P0 | 현재 확인 빌드/설정 대 미확인 값·검토/운영 게이트·Pages/자체 API/자산/OCI 비교 계획 | 수정: 두 계층 경계/전체 누적 무삭제·개정·현행 발행·raw 검증/준비 상태와 후속 게이트 반영 |
| `docs/FILE_SYNC.json` | P0 | 관리 파일 역할·연관 경로·우선순위·갱신 조건·검토 작업의 단일 목록 | 수정: 신규 3파일·관련 경로/역할·전수 T020 검토·외부 입력 메타 등록 |
| `docs/ROADMAP.md` | P0 | 공식 KR 확률표 대상의 새 R0~R6·완료 조건·이전 단계 대응·현재/이전/다음 | 수정: 누적 무삭제/개정과 공식 유효 사이트 범위·단계/순서/이전 진척 대응 갱신 |
| `docs/WORKPLAN.md` | P0 | 새 T008~T018 실행 계획·조건/입출력/검증·이전 작업 매핑·매 작업 파일 최신화 | 수정: C042~C047·T020/T021과 후속 계획·전수 파일 판정·현재/이전/다음 갱신 |
| `index.html` | P0 | Pages root 배포용 추적 생성물; web/index.html를 기준으로 build/export하며 직접 수정 금지 | 검토 결과 변경 불필요: 기존 표본/공개 호환 생성물 바이트 보존. 별도 Sites 초기 페이지와 무관하며 삭제/재생성 안 함 |
| `package-lock.json` | P0 | npm 의존성·루트 런타임 선언의 재현 가능한 잠금 파일 | 검토 결과 변경 불필요: 실행/의존/CI/제외 규칙은 변경 요구 없음. 기존 검사로 확인하고 push/배포 설정 유지 |
| `package.json` | P0 | 관리·도메인·데이터 표본·정적 사이트·미리보기·브라우저 명령과 도구 버전 선언 | 검토 결과 변경 불필요: 실행/의존/CI/제외 규칙은 변경 요구 없음. 기존 검사로 확인하고 push/배포 설정 유지 |
| `scripts/audit-cards.mjs` | P0 | 전체 카드 열거·필드/이미지 표본 감사와 재개 전 체크포인트 횟수·로그·페이지 정합성/403 무재시도 검증 | 검토 결과 변경 불필요: 기존 전체 카드 열거·필드/이미지 표본 감사와 재개 전 체크포인트 횟수·로그·페이지 정합성/403 무재시도 검증 계약 재사용/회귀 점검. 새 누적/API/projection 구현은 후속으로 분리 |
| `scripts/build.mjs` | P0 | DB와 정적 데이터·사이트를 staging에서 빌드하고 Pages 규칙 생성 | 검토 결과 변경 불필요: 기존 DB와 정적 데이터·사이트를 staging에서 빌드하고 Pages 규칙 생성 계약 재사용/회귀 점검. 새 누적/API/projection 구현은 후속으로 분리 |
| `scripts/catalog-history.mjs` | P0 | 추적 누적 카탈로그와 새 후보를 근거 시점별 병합해 기존 개체·관측·조건을 보존하고 자동 삭제 거부 | 검토 결과 변경 불필요: 기존 추적 누적 카탈로그와 새 후보를 근거 시점별 병합해 기존 개체·관측·조건을 보존하고 자동 삭제 거부 계약 재사용/회귀 점검. 새 누적/API/projection 구현은 후속으로 분리 |
| `scripts/catalog.mjs` | P0 | 활성 카드/상품 계약·감독 지원 제외·상품 전체성 금지·출처·SQLite 이력·실패 보호 검증 | 검토 결과 변경 불필요: 기존 활성 카드/상품 계약·감독 지원 제외·상품 전체성 금지·출처·SQLite 이력·실패 보호 검증 계약 재사용/회귀 점검. 새 누적/API/projection 구현은 후속으로 분리 |
| `scripts/collect-efhub.mjs` | P0 | 정상 상품 목록과 같은 제목·수량·직속 구성 경계를 재수집하고 실패 시 기존 자료 보존 | 검토 결과 변경 불필요: 기존 정상 상품 목록과 같은 제목·수량·직속 구성 경계를 재수집하고 실패 시 기존 자료 보존 계약 재사용/회귀 점검. 새 누적/API/projection 구현은 후속으로 분리 |
| `scripts/collected-products.mjs` | P0 | 명시 원본 ID·필드 근거로 수집 상품/카드를 병합하고 감독 범위 위반·구성 축소 거부 | 검토 결과 변경 불필요: 기존 명시 원본 ID·필드 근거로 수집 상품/카드를 병합하고 감독 범위 위반·구성 축소 거부 계약 재사용/회귀 점검. 새 누적/API/projection 구현은 후속으로 분리 |
| `scripts/export-pages.mjs` | P0 | 허용된 공개 7개 파일만 root로 내보내고 읽기 전용 bytes 검사·실패 복구 | 검토 결과 변경 불필요: 기존 허용된 공개 7개 파일만 root로 내보내고 읽기 전용 bytes 검사·실패 복구 계약 재사용/회귀 점검. 새 누적/API/projection 구현은 후속으로 분리 |
| `scripts/prepare-seed.mjs` | P0 | 초기 관측·현재 수집 창을 검증해 추적 누적 seed에 보강하고 충돌/실패/동시 변경 시 기존 bytes 보존 | 검토 결과 변경 불필요: 기존 초기 관측·현재 수집 창을 검증해 추적 누적 seed에 보강하고 충돌/실패/동시 변경 시 기존 bytes 보존 계약 재사용/회귀 점검. 새 누적/API/projection 구현은 후속으로 분리 |
| `scripts/project-check.mjs` | P0 | Git 파일·등록 목록·작업 검토·JSON 및 사람용 현재 상태의 정합성을 읽기 전용 검사 | 검토 결과 변경 불필요: 기존 Git 파일·등록 목록·작업 검토·JSON 및 사람용 현재 상태의 정합성을 읽기 전용 검사 계약 재사용/회귀 점검. 새 누적/API/projection 구현은 후속으로 분리 |
| `scripts/serve.mjs` | P0 | 지원하는 상품·카드 주소의 정적 미리보기와 제외된 감독/누락 자산의 404 처리 | 검토 결과 변경 불필요: 기존 지원하는 상품·카드 주소의 정적 미리보기와 제외된 감독/누락 자산의 404 처리 계약 재사용/회귀 점검. 새 누적/API/projection 구현은 후속으로 분리 |
| `styles.css` | P0 | Pages root 배포용 추적 생성물; web/styles.css를 기준으로 build/export하며 직접 수정 금지 | 검토 결과 변경 불필요: 기존 표본/공개 호환 생성물 바이트 보존. 별도 Sites 초기 페이지와 무관하며 삭제/재생성 안 함 |
| `README.md` | P1 | 공식확률표 선수팩 목표·현재 구현 경계·계획/검사 진입 문서 | 수정: 두 계층 진입·raw 제작 보고/미검증·GitHub 누락·기존 Work packs 준비/이관 제외 안내 |
| `docs/sources/CARD_API_AUDIT.md` | P1 | 기존 R1/T002·R5 검증의 R4/T005 실행 근거, 요청 차이·필드별 표본/전수 범위·재개 검증 설명 | 수정: 최신 누적층/사이트층 안내를 정정하고 과거 관측·수치·실패 본문은 보존 |
| `docs/sources/FOLLOWUP_RESEARCH.md` | P1 | 추가 공식·플랫폼 조사와 상품별 가격·무료 조건·미확인 적용 범위 | 수정: 최신 누적층/사이트층 안내를 정정하고 과거 관측·수치·실패 본문은 보존 |
| `docs/sources/INITIAL_RESEARCH.md` | P1 | R1 출처별 필드 확보·전체 구성·접근 제약과 다음 조사 | 수정: 최신 누적층/사이트층 안내를 정정하고 과거 관측·수치·실패 본문은 보존 |
| `scripts/browser-check.py` | P1 | 실제 자료량·상품↔카드·감독 일괄 제외·반응형·오류/재시도 브라우저 검사 | 검토 결과 변경 불필요: 기존 표본 UI/브라우저 검증 코드 유지. 이번 제품 화면 변경/새 데이터 연결 없음 |
| `tests/audit-cards.test.mjs` | P1 | 외부 요청 없는 전수 열거·체크포인트 손상/복구·예산·403 무재시도·이미지 표본 회귀 검사 | 검토 결과 변경 불필요: 기존 계약/보존·실패 회귀를 실행. 새 두 계층 구현은 없어 테스트 수정/완료 주장 불필요 |
| `tests/catalog-history.test.mjs` | P1 | 누적 ID·관측·근거 시점·복수 분류·구성 축소·입력 불변의 회귀 검사 | 검토 결과 변경 불필요: 기존 계약/보존·실패 회귀를 실행. 새 두 계층 구현은 없어 테스트 수정/완료 주장 불필요 |
| `tests/catalog.test.mjs` | P1 | ID·관계·전체성·개정 이력·중복·실패 보호·빌드 회귀 검사 | 검토 결과 변경 불필요: 기존 계약/보존·실패 회귀를 실행. 새 두 계층 구현은 없어 테스트 수정/완료 주장 불필요 |
| `tests/collect-efhub.test.mjs` | P1 | 수집·범위·접근 제한·실패 보호·배포 생성물 계약의 회귀 검사 | 검토 결과 변경 불필요: 기존 계약/보존·실패 회귀를 실행. 새 두 계층 구현은 없어 테스트 수정/완료 주장 불필요 |
| `tests/collected-products.test.mjs` | P1 | 수집·범위·접근 제한·실패 보호·배포 생성물 계약의 회귀 검사 | 검토 결과 변경 불필요: 기존 계약/보존·실패 회귀를 실행. 새 두 계층 구현은 없어 테스트 수정/완료 주장 불필요 |
| `tests/export-pages.test.mjs` | P1 | 수집·범위·접근 제한·실패 보호·배포 생성물 계약의 회귀 검사 | 검토 결과 변경 불필요: 기존 계약/보존·실패 회귀를 실행. 새 두 계층 구현은 없어 테스트 수정/완료 주장 불필요 |
| `tests/prepare-seed.test.mjs` | P1 | 실제 조사 재현·새 관측과 카드 ID·과거 근거 보존 검사 | 검토 결과 변경 불필요: 기존 계약/보존·실패 회귀를 실행. 새 두 계층 구현은 없어 테스트 수정/완료 주장 불필요 |
| `tests/project-check.test.mjs` | P1 | 누락·삭제·이름 변경·참조·변경 검토 누락의 회귀 검사 | 검토 결과 변경 불필요: 기존 계약/보존·실패 회귀를 실행. 새 두 계층 구현은 없어 테스트 수정/완료 주장 불필요 |
| `tests/serve.test.mjs` | P1 | 정적 서버 HTTP·라우팅·경로 안전성 회귀 검사 | 검토 결과 변경 불필요: 기존 계약/보존·실패 회귀를 실행. 새 두 계층 구현은 없어 테스트 수정/완료 주장 불필요 |
| `web/app.js` | P1 | 상품 중심 검색·카드 상세·관계 이동·감독 지원 제외·출처·미확인·오류 표시 | 검토 결과 변경 불필요: 기존 표본 UI/브라우저 검증 코드 유지. 이번 제품 화면 변경/새 데이터 연결 없음 |
| `web/index.html` | P1 | 한국어 정적 앱·주요 탐색·초기 로딩·JS 비활성 안내 | 검토 결과 변경 불필요: 기존 표본 UI/브라우저 검증 코드 유지. 이번 제품 화면 변경/새 데이터 연결 없음 |
| `web/styles.css` | P1 | 독자 디자인과 모바일·태블릿·데스크톱·접근성 스타일 | 검토 결과 변경 불필요: 기존 표본 UI/브라우저 검증 코드 유지. 이번 제품 화면 변경/새 데이터 연결 없음 |
| `data/research/manager-product-observations.json` | P2 | 비활성 감독·상품 관계와 일반 목록 조사 보존; 개별 관계의 활성 import 및 추가 수집 금지 | 검토 결과 변경 불필요: 역사적 원관측/실패·필드 근거 그대로 보존. 새 정책은 문서/별도 입력 메타에 기록 |
| `data/research/mourinho-product-observations.json` | P2 | 활성 import가 금지된 기사·게시물·상품 화면의 원본 관측과 문자열 ID 보존 | 검토 결과 변경 불필요: 역사적 원관측/실패·필드 근거 그대로 보존. 새 정책은 문서/별도 입력 메타에 기록 |
| `docs/reference/retired-manager-product.mjs.txt` | P2 | 최신 범위 변경으로 비활성화한 옛 수동 감독 정규화 코드 보존; 실행 금지 | 검토 결과 변경 불필요: 과거 설계/작업·비활성 감독 자료 원문으로 보존. 최신 실행 지침은 현 문서가 우선 |
| `docs/reference/retired-manager-product.test.mjs.txt` | P2 | 비활성 옛 수동 감독 사례의 테스트 코드 보존; 자동 테스트 대상 아님 | 검토 결과 변경 불필요: 과거 설계/작업·비활성 감독 자료 원문으로 보존. 최신 실행 지침은 현 문서가 우선 |
| `docs/sources/MANAGER_PRODUCT_RESEARCH.md` | P2 | 비활성 감독 API/관계 조사 기록; 활성 데이터나 추가 개별 조사의 근거로 사용하지 않음 | 수정: 최신 누적층/사이트층 안내를 정정하고 과거 관측·수치·실패 본문은 보존 |
| `docs/sources/MOURINHO_PRODUCT_RESEARCH.md` | P2 | 비활성 수동 상품·감독 관계 조사 원본과 한계 보존 | 수정: 최신 누적층/사이트층 안내를 정정하고 과거 관측·수치·실패 본문은 보존 |
| `data/research/roster-source-observations.json` | P0 | T005의 403 원인/근거 한계·상품별 소개 목록/타입·공식 초기 풀·후보 API 관측과 미확인 보존 | 검토 결과 변경 불필요: 역사적 원관측/실패·필드 근거 그대로 보존. 새 정책은 문서/별도 입력 메타에 기록 |
| `docs/sources/FULL_ROSTER_RESEARCH.md` | P1 | Standard 포함 초기 전체 선수 풀과 소개 목록을 구분한 후보 조사·403 결론·기존 단계별 실증 계획/완료 조건 | 수정: 최신 누적층/사이트층 안내를 정정하고 과거 관측·수치·실패 본문은 보존 |
| `data/research/data-supply-chain-observations.json` | P0 | 공급망/사이트 API·실측 PesLig 행 감사 이력과 후속 10DB/커뮤니티·인용 정정·현행 우선 근거; raw 전체 응답 미포함 | 검토 결과 변경 불필요: 역사적 원관측/실패·필드 근거 그대로 보존. 새 정책은 문서/별도 입력 메타에 기록 |
| `docs/sources/DATA_SUPPLY_CHAIN.md` | P1 | 사이트별 원본→정규화/저장→사이트 API→갱신 근거와 실제 확보 경로·제약·가상 Standard 보류 조건 | 수정: 최신 누적층/사이트층 안내를 정정하고 과거 관측·수치·실패 본문은 보존 |
| `data/research/current-shop-observations.json` | P0 | 이전 현행 상점/EFHub 60행·표적 3건·PS 부록의 원본 조사 이력; 새 기준은 별도 probability baseline | 검토 결과 변경 불필요: 역사적 원관측/실패·필드 근거 그대로 보존. 새 정책은 문서/별도 입력 메타에 기록 |
| `docs/sources/CURRENT_SHOP_COVERAGE.md` | P1 | 유일 대상 KR 확률표 최신 7개 기준과 미기재 필드·이전 EFHub/상점 범위 조사 이력 분리 | 수정: 최신 누적층/사이트층 안내를 정정하고 과거 관측·수치·실패 본문은 보존 |
| `docs/API_SELECTION.md` | P0 | 공식 대상 특수 카드 API 후보·필수 선정 조건·검증 경로·미확인과 용도별 우선순위 | 수정: 두 계층 경계/전체 누적 무삭제·개정·현행 발행·raw 검증/준비 상태와 후속 게이트 반영 |
| `docs/DATA_LIFECYCLE.md` | P0 | 공식 목록 diff·안전한 상태전이·얇은 아카이브·캐시·원자적 발행·자체 API/백업 운영 계획 | 수정: 두 계층 경계/전체 누적 무삭제·개정·현행 발행·raw 검증/준비 상태와 후속 게이트 반영 |
| `docs/SIMULATOR_PLAN.md` | P1 | 기반 운영 검증 뒤 추첨/가상 Standard·카드 연출·3D/모바일/접근성 단계별 계획 | 수정: 두 계층 경계/전체 누적 무삭제·개정·현행 발행·raw 검증/준비 상태와 후속 게이트 반영 |
| `data/research/probability-scope-baseline.json` | P0 | 2026-10-25 공식 KR 확률표 새 직접 관측·7개 실제 행/초기수/종료/확률·미기재값과 새 범위 근거 | 검토 결과 변경 불필요: 역사적 원관측/실패·필드 근거 그대로 보존. 새 정책은 문서/별도 입력 메타에 기록 |
| `docs/reference/WORKPLAN_BEFORE_PROBABILITY_SCOPE.md` | P2 | 범위 재정의 전 T000~T007·C001~C030·파일 검토/CI/공개 검증 원문 보존 | 수정: 과거 관측/설계 본문을 보존하고 reference 이동 뒤 깨진 상대 링크의 경로만 정정 |
| `docs/reference/ARCHITECTURE_BEFORE_PROBABILITY_SCOPE.md` | P2 | 이전 9상품 83카드 SQLite/정적 구조와 실패 보존의 구현 계약 원문 | 수정: 과거 관측/설계 본문을 보존하고 reference 이동 뒤 깨진 상대 링크의 경로만 정정 |
| `docs/reference/COLLECTION_BEFORE_PROBABILITY_SCOPE.md` | P2 | 이전 EFHub 표본 수집 명령/파서/누적 보존·접근 제약 원문 | 수정: 과거 관측/설계 본문을 보존하고 reference 이동 뒤 깨진 상대 링크의 경로만 정정 |
| `docs/reference/DEPLOYMENT_BEFORE_PROBABILITY_SCOPE.md` | P2 | 이전 Pages 호환 7파일·커밋/미리보기 검증·설정 이력 원문 | 수정: 과거 관측/설계 본문을 보존하고 reference 이동 뒤 깨진 상대 링크의 경로만 정정 |
| `data/research/api-selection-validation.json` | P0 | T009 최신 공식/현재 접근/보존 원문 전수 대조·팩별 게이트·권리/조건·미선정·S/A null의 실행 근거 | 검토 결과 변경 불필요: 역사적 원관측/실패·필드 근거 그대로 보존. 새 정책은 문서/별도 입력 메타에 기록 |
| `docs/sources/API_SELECTION_VALIDATION.md` | P1 | T009 팩별/공급자별 실제 통과·차단·이미지/OVR/권리/1010 범위·최소 재개 자료 보고 | 수정: 최신 누적층/사이트층 안내를 정정하고 과거 관측·수치·실패 본문은 보존 |
| `scripts/merge-api-pages.mjs` | P0 | 네트워크 없는 raw players/packs 페이지→원문 항목 배열 병합·메타/ID/누락 검증·실패 보존/원자적 발행 | 검토 결과 변경 불필요: 기존 네트워크 없는 raw players/packs 페이지→원문 항목 배열 병합·메타/ID/누락 검증·실패 보존/원자적 발행 계약 재사용/회귀 점검. 새 누적/API/projection 구현은 후속으로 분리 |
| `tests/merge-api-pages.test.mjs` | P1 | 합성 fixture CLI 검증:lossless 원문·페이지/ID/합계·partial 거부·입력/last-good·발행 실패 복구 | 검토 결과 변경 불필요: 기존 계약/보존·실패 회귀를 실행. 새 두 계층 구현은 없어 테스트 수정/완료 주장 불필요 |
| `docs/RAW_PAGE_MERGE.md` | P1 | 전체 players/packs 중간 자료 오프라인 병합 입력/CLI/보존/완전성·실제 원본 미확보 경계 | 수정: 두 계층 경계/전체 누적 무삭제·개정·현행 발행·raw 검증/준비 상태와 후속 게이트 반영 |
| `docs/CHATGPT_WORK_HANDOFF.md` | P1 | 한국어 자급적 Work 인수인계: 미푸시/원격 차이·두 계층·raw 검증·기존 대상 채팅 이어받기·Sites 초기 소스 이관 제외 | 수정: 이 파일과 GitHub/bundle만으로 기존 대상 Work를 이어갈 수 있게 범위/상태/명령/차단/첫 지시 정리 |
| `docs/FILE_SYNC_AUDIT.md` | P1 | T020 전체 관리 파일의 등록/내용 영향 판정·GitHub 미반영·구현 공백·검증/이관 한계 보고 | 수정: 기존 76/최종 79 경로 전수 판정과 의미상 갱신/구현 공백·원격 차이 기록 |
| `data/research/work-handoff-inputs.json` | P0 | T020 Git/Library 입력 메타·원문 검증 대기·대상 Work packs 수집 준비·Sites 의도적 이관 제외의 구조화 근거 | 수정: 원격 읽기/Library 전달 메타·실제 본문 미검증·packs 준비·Sites 이관 제외 구분 |
