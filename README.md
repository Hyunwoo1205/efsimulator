# efsimulator

**API 개발 완료 기준을 유지하며 실제 eFsimulator 앱 서버·API 연동·조회 화면을 비공개 배포했다.** 오류 수정과 운영 관찰은 유지보수로 이어간다. 현재 작업·다음 단계는 [ROADMAP](docs/ROADMAP.md)과 [WORKPLAN](docs/WORKPLAN.md), 새 환경의 실행 기준은 [최신 인수인계](docs/CHATGPT_WORK_HANDOFF.md)를 따른다.

| 구성 | 현재 역할과 상태 |
| --- | --- |
| `services/catalog-api/` | 별도 owner-private Sites Worker + D1에 배포한 자체 API. 공식 상품으로 검증한 가공 자료만 조회하고 raw는 공개하지 않음 |
| `services/catalog-view/` | API 데이터·명단을 확인하는 별도 비공개 검토 viewer. 실제 eFsimulator 앱이 아님 |
| `web/*`, root 공개 사본 | 이전9상품83카드 아카이브 표본. 기존 Pages 호환 산출물을 유지하며 자동 교체/삭제하지 않음 |
| `services/efsimulator-app/` | 실제 제품 서버·API relay·선수/팩 목록/상세·별도 시뮬레이터 진입 페이지를 owner-private으로 배포/실조회 검증. 추첨 엔진/3D는 미구현 |
| 다음 T017 | 모드별 추첨 규칙·잔여 풀·익명 Standard·최소 엔진/2D 결과의 세부 설계/구현 예정 |

실제 앱 URL은 https://efsimulator.hyunw09.chatgpt.site 이며 owner-private 접근을 유지한다. 실제 서버 relay의 목록/상세·동일 publication·선수8필드·직접 페이지와 비밀값 비노출을 검증했다. hosted 브라우저 실데이터 상호작용 QA는 로그인 장벽으로 미수행이다. [실행 근거](data/research/sites-app-T032.json)를 참조한다.

API의 당시 검증 결과는 가공7팩70카드와 전체 중첩 live/archive, 원격 전체 해시·부분 적재 거부·데이터 버전 복귀/재복원·동일 버전 재실행이다. 상품 수는 고정 상수가 아니며 실제 종료 UTC와 최신 검증 자료를 적용한다. API ready는 실제 앱 또는 simulation_ready를 뜻하지 않는다. 공개 API 전환 없이 앱 서버가 private API에 접근하는 구조를 재사용할 수 있다.

[데이터 계약](docs/CATALOG_DATA_CONTRACT.md)은 누적 raw와 공식 게재 이력 대상 가공 API를 구분한다. 선수는 지정8필드, 팩은 검증된 회차와 특수 카드 관계·공식 전체 인원·UTC 종료를 제공하며 종료 팩도 선수 상세 전체와 함께 보존한다. 익명 Standard는 같은 회차의 전체 특수S와 공식 초기N을 검증한 `N−S` 그룹으로만 계획하며 실제 선수 ID를 만들지 않는다. 감독·일괄 지급형 팩은 개봉 시뮬레이터 대상에서 제외한다.

현재 소스 작업 브랜치는 **`api-server-setup`**이다. `work`는 이전 이관 이력, `main`은 보존된 초기 운영 브랜치다. 실제 앱은 별도 Site와 최종 `services/efsimulator-app/` 소스로 분리하며 현재 브랜치를 임의로 전환하지 않는다. GitHub 연결을 통한 반영 때문에 로컬 Git 메타데이터가 원격과 다를 수 있으므로 실제 원격 ref·파일 내용을 대조한다. status 표시만으로 미업로드를 단정하거나 reset/clean하지 않는다.

승인된 개발 작업은 영향 파일·연관 파일·FILE_SYNC·WORKPLAN 검토와 적절한 검사 후 같은 작업 브랜치의 정상 commit/push, 원격 ref·변경 파일 전체 내용·CI 상태 확인까지 마친다. 읽기 전용·무변경·매시간 데이터 작업은 커밋하지 않는다. raw·비밀값은 Git에 넣지 않고, main 병합·Site 공개 접근 전환은 자동 수행하지 않는다.

지속적인 EFHub 가용성·다음 예약 변경 실행·브라우저 상호작용 QA·계정 한도/비용을 이번 완료로 보장하지 않는다. 이 항목은 필요한 유지보수/후속 검증으로 남기며 실제 앱 설계를 API 재구축 단계로 되돌리는 전역 게이트로 쓰지 않는다. T021 원본 검사와 T022 이관의 당시 수치·범위는 [이관 이력](docs/MIGRATION_STATUS.md)과 인수인계 역사 본문에 보존한다.

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

새 환경의 의존성 설치는 `npm ci --ignore-scripts --no-audit --no-fund`를 사용합니다. `data:prepare`는 저장 표본 재현이며 실시간 수집/새 공식 대상 반영 명령이 아닙니다. `pages:export`는 기존 호환 경로의 고정 7파일 생성 명령으로, 이번 계획에서는 공개 사본을 변경하지 않습니다. `project:check -- --base <기준SHA>`는 변경 파일의 최신화 검토도 확인합니다. UI 변경 시 현재 Sites 스킬이 지원하는 브라우저 검증 경로를 사용하고 로그인/환경 제약은 실제 검증 범위와 구분합니다.

Sites 배포는 검증 소스의 Sites source 저장·버전 생성·배포 절차로 진행합니다. GitHub push만으로 Sites 자동 배포를 가정하지 않습니다. 기존 정적 dist와 배포된 Worker/D1 API를 구분하며 기존 Pages 호환 7파일은 전환 검증 전에 제거하지 않습니다. 실제 경로·권한·계정 한도/비용·백업·검토/운영 단계는 [DEPLOYMENT](docs/DEPLOYMENT.md)를 따릅니다. 과거 PR/Pages 이력과 T025 API 비공개 배포는 구분하며 이번 문서 점검에서 main 병합·공개 전환·새 자동화를 수행하지 않습니다.
