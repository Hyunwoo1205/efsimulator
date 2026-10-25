# efsimulator

[한국어 공식 확률표](https://efootball-web.konami.net/probability_kr.php)에 현재 게재된 특수 선수 명단과 그 안의 특수 카드 DB를 만들고, 자동 갱신·자체 읽기 API를 검증한 뒤 개봉 시뮬레이터와3D로 확장합니다. 2026-10-25 재관측은7개 명단이며 이후 공식 목록 변경을 따릅니다.

Standard 실명 카드는 수집하지 않습니다. 같은 회차의 모든 특수 카드가 검증된 경우 공식 초기 총원과의 차이를 별도 **가상 Standard 슬롯**으로 다루는 모델입니다. 특수 누락·미확인 타입을 가상 슬롯으로 메우지 않으며 실제 선수ID를 만들지 않습니다. 웹상점/특별판/일괄 팩·표 밖의 비코인 명단·감독·역사 전체/다른버전 DB는 새 제품 대상에서 제외합니다.

현재 코드는 이전 범위의9상품83카드 표본으로 수집→검증→SQLite→한국어 정적 검색/상세를 검증한 구현입니다. 범위 변경과 T009의 비활성 선정 검증을 문서/조사에 반영했고 기존 DB·코드·다른버전 화면은 보존했습니다. 아직 새 대상 DB·가상 슬롯·자동 운영·시뮬레이터를 구현한 상태가 아닙니다. 카드 API 최종 선정은 필수 조건 미충족으로 보류 중입니다. 최신 [팩별 검증 결과](docs/sources/API_SELECTION_VALIDATION.md)에 실제 관측·필드 대조·차단 조건과 재개 자료를 기록했습니다.

## 계획과 관리

- [ROADMAP](docs/ROADMAP.md): 새 단계·입력/산출물·완료 조건과 이전 계획 대응표.
- [WORKPLAN](docs/WORKPLAN.md): 현재/이전/다음 작업·상세 순서·추가 조건·검증·파일별 최신화.
- [FILE_SYNC](docs/FILE_SYNC.json): 모든 관리 파일의 역할·우선순위·연관 파일·갱신 조건.
- [공식 기준표](docs/sources/CURRENT_SHOP_COVERAGE.md)·[API 선정](docs/API_SELECTION.md)·[DB 구조](docs/ARCHITECTURE.md)·[수집](docs/COLLECTION.md).
- [갱신·아카이브·자체 API](docs/DATA_LIFECYCLE.md)·[배포 전/후와 호스팅](docs/DEPLOYMENT.md)·[시뮬레이터/3D](docs/SIMULATOR_PLAN.md).

작업마다 문서 상태와 변경 영향 검토를 갱신합니다. 파일 추가·삭제·이름 변경은 같은 작업에서 목록과 참조에 반영합니다. 이전 검증/조건 원문은 [이전 WORKPLAN](docs/reference/WORKPLAN_BEFORE_PROBABILITY_SCOPE.md)에 보존합니다. 이전 완료를 새 범위 완료로 해석하지 않습니다.

## 원본 페이지의 오프라인 중간 병합

선수와 팩의 페이지별 원본 JSON을 나중에 제공받으면 `npm run data:merge-pages -- ...`로 각각 하나의 배열로 합칠 수 있도록 준비했습니다. 항목 내부 값은 보존하고 페이지/ID 중복·충돌·누락·합계를 별도 보고서로 검사합니다. [사용법과 입력 조건](docs/RAW_PAGE_MERGE.md)을 따릅니다.

현재 전체 원본 페이지는 없으며 실제 전체 선수/팩 배열을 생성한 상태가 아닙니다. 2119/50840은 사용자 관측 기대값으로만 취급합니다. 이 도구는 네트워크 수집·사이트 선방문·인증 활성화·실제 DB 구축을 하지 않습니다.

## 현재 코드의 실행·검사

기준 도구는 Node.js24.19.0·npm11.9.0입니다. 준비된 환경에서는 다음 명령으로 기존 표본 구현을 검사할 수 있습니다.

```bash
source /workspace/efsimulator-environment/activate.sh
cd /workspace/efsimulator
npm run project:check
npm test
npm run build
npm run pages:check
npm run preview -- --port 4173
```

새 환경의 의존성 설치는 `npm ci --ignore-scripts --no-audit --no-fund`를 사용합니다. `data:prepare`는 저장 표본 재현이며 실시간 수집/새 공식 대상 반영 명령이 아닙니다. `pages:export`는 기존 호환 경로의 고정7파일 생성 명령으로, 이번 계획에서는 공개 사본을 변경하지 않습니다. `project:check -- --base <기준SHA>`는 변경 파일의 최신화 검토도 확인합니다. UI 변경 시 기존 Playwright 브라우저 검사를 추가합니다.

Pages의 현재 대시보드 설정을 과거 `exit 0`/루트 안내값으로 확정하지 않습니다. 확인된 코드의 빌드/출력과 제안하는 `dist` 전환, 검토용 배포·사용자 검토·운영 승인은 배포 문서에서 구분합니다. 현재 PR은 초안·미병합입니다. 계획 정리 단계에서는 배포·서비스 활성화·자동배포를 유발할 푸시를 실행하지 않습니다.
