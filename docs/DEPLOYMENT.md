# 빌드·배포·무료 운영 계획

이 문서는 [로드맵](ROADMAP.md)의 **R3/T012 검토용 미리보기 → 사용자 검토 → T013 운영 승인**, **R5/T016 자체 API 운영**, **R6/T018 3D**의 배포 기준이다. T020에서 **전체 누적 EFHub DB/API와 사이트용 현행 스냅샷을 분리하는 계획**을 반영했다. 기존 표본·이전 미리보기 성공을 새 두 계층 DB나 운영 배포 완료로 계승하지 않는다. 최신 상태·이전/현재/다음 작업은 [WORKPLAN](WORKPLAN.md)을 따른다.

**이번 T020은 문서 점검·인수인계다.** T009의 비활성 API 선정 검증과 다른 Work의 raw 파일 존재는 배포 승인을 대신하지 않는다. 앱·활성 DB·설정·공개 생성물을 변경하거나 배포·서비스 활성화·Git push를 하지 않는다. 기존 코드의 로컬 비회귀 빌드와 읽기 전용 생성물 비교는 수행한다. Git push만으로 기존 Pages 미리보기가 자동 생성될 수 있으므로 계획 작성 중에는 원격 반영도 하지 않는다. 이전 배포 근거와 실패/수정 기록은 [원본 보존 문서](reference/DEPLOYMENT_BEFORE_PROBABILITY_SCOPE.md)에 남긴다.

## 배포할 데이터의 두 계층

- **전체 누적 DB/API:** 정상적으로 확보 가능한 EFHub 전체 players/packs 원문과 정규화 자료를 별도 저장 경계에서 관리한다. 신규 원본 ID는 추가하고 기존 엔티티는 삭제하지 않는다. 변경 내용은 revision/이력으로 보존하며 실패·목록 누락으로 정상 자료를 지우지 않는다. 자체 API의 공개 범위는 데이터·이미지 권리와 접근 정책을 확인한 뒤 정하고, 원본 raw 전체를 정적 사이트에 자동 복제하지 않는다.
- **사이트용 DB/배포 스냅샷:** 누적 계층의 검증된 revision에서 최신 정상 한국 공식 확률표의 유효 판매 팩과 해당 카드만 추출한다. 공식 목록 존재·종료 시각·관측 신선도·회차/구성 검증이 모두 필요하다. 판매 변동에 따라 활성 스냅샷은 추가·수정·제외되지만 전체 누적 엔티티/이력은 보존한다. 종료·누락·확률표 읽기 실패를 구분하며 신규 스냅샷 실패 시 마지막 정상 산출물과 그 관측 시각을 유지한다.

두 계층은 저장 폴더·DB·API 서비스 중 어떤 형태로 분리할지 구현 단계에서 결정한다. 지금 새 API 서버나 저장소를 만들지 않는다. 전체 raw가 있더라도 팩 구성 연결·이미지 다운로드/허용 저장·현재 판매 반영이 완료된 것은 아니다. 사이트에 공개할 자료는 별도 검증·발행 manifest와 정확한 누적 revision 참조를 가져야 한다.

## 확인한 구성과 변경 제안

| 항목 | 현재 확인 수준 | 구현 후 목표 |
| --- | --- | --- |
| Node/npm | package·lock·.nvmrc·CI와 로컬 버전은 Node `24.19.0`·npm `11.9.0` | 버전 고정 유지. 실제 Pages 빌드 로그에서도 확인 |
| 앱·빌드 | Node 내장 기능·정적 HTML/CSS/JS. `npm run build`는 seed 검증→SQLite staging→`dist`를 생성 | 새 대상 표본을 검증하는 같은 명령과 산출물 경계 유지. 3D 도구 추가 시 manifest·lock·빌드·테스트를 함께 갱신 |
| Pages 설정 | 인수인계의 `exit 0`·출력 `/`는 과거 안내값. 현재 대시보드 build/output/root를 인증해 읽은 근거 없음 | 실제 설정을 먼저 기록하고 `dist` 직접 배포로 전환 |
| 임시 호환 | `pages:export`가 `dist`의 고정 7파일을 루트의 추적 생성물로 내보냄. CI는 `pages:check`로 bytes만 검사 | 직접 `dist` 배포 검증 후 루트 사본·export 도구/테스트·CI·FILE_SYNC를 함께 정리 |
| 브랜치 | 로컬 `work`, 운영 의도는 `main`. 로컬 origin/main 기록은 앱 없는 초기 README 커밋. PR draft·운영 미병합 기록 | T012에서 검토용 SHA/URL 확인. 사용자 검토·운영 승인 후 T013에서 main 반영 |
| 환경·비밀값 | 정적 앱용 secret·D1/R2 binding·Functions/Workers 선언 없음. Pages의 실제 환경변수 값은 미확인 | 전환 후보 `NODE_VERSION=24.19.0`, `SKIP_DEPENDENCY_INSTALL=1`을 실제 환경별 설정과 대조. 동적 서비스의 비밀값은 T016에서 서버에만 설정 |
| DB·API | SQLite는 로컬 빌드 검증/이력용. `serve.mjs`는 정적 미리보기. 상시 자체 API·새 2계층 DB 없음 | 전체 누적 DB/API와 현행 사이트 스냅샷의 저장·권한·버전/발행 경계를 나누고 R5/T016에서 갱신·지속 저장/복구를 운영 검증 |
| 3D 자산 | 현재 3D 모델·압축·청크 빌드·성능 검증 없음 | R6/T018에서 자산 권리·최적화·모바일 실측을 통과한 정적 자산만 배포 |

Pages 전환 후보는 **빌드 루트: 저장소 루트, 출력: `dist`**이며 실제 구현된 명령을 사용한다.

```sh
npx --yes npm@11.9.0 ci --ignore-scripts --no-audit --no-fund && npx --yes npm@11.9.0 run build
```

`data:prepare`는 기존 표본의 저장 근거와 누적 입력을 재현·병합하며 인터넷 수집이나 새 2계층 자동 갱신 시작이 아니다. 기존 명령은 T021 원본 검증 뒤 T010/T011에서 전체 누적 입력과 사이트용 현행 추출 계약에 맞게 검증한 후 재사용한다. 이전 표본의 재생성을 새 대상 DB 완료로 간주하지 않는다. `artifacts/catalog.sqlite`·연구 raw는 공개 산출물에 포함하지 않는다. 새 의존성이 install script를 요구한다면 해당 구현 작업에서 현재 `--ignore-scripts` 정책을 검토한다.

## R3/T012 — 검토용 미리보기

1. **사전 확인:** T011의 검증된 DB 표본과 명시적 부분 범위를 입력으로 삼는다. Pages의 실제 build command/output/root, production branch, preview 동작, 환경별 변수 이름을 비밀값 없이 기록한다. 과거 안내값을 현재 확인값으로 복사하지 않는다.
2. **로컬 검증:** 아래 명령과 관련 기능 검증을 실행하고 SHA·데이터 범위·결과를 기록한다. 새 범위에 맞춘 검사와 기존 보존/실패 보호 회귀를 포함한다.

   ```sh
   npm ci --ignore-scripts --no-audit --no-fund
   npm run project:check -- --base <변경 전 커밋>
   npm test
   npm run data:prepare
   npm run build
   npm run preview -- --port 4173
   ```

   `data:prepare` 전후 차이는 검토한다. 미리보기 실행 후 선택적 `npm run test:browser`를 사용한다. 기존 루트 호환 배포를 사용하는 동안에는 `npm run pages:export` 후 `npm run pages:check`까지 통과해야 한다. CI가 export로 차이를 자동 수정하게 만들지 않는다.
3. **검토용 배포:** 구현 단계에서 허용된 브랜치의 기존 Git 연동 preview를 사용한다. 같은 SHA의 CI·실제 배포 커밋·runtime/output·공개 파일·필수 데이터·이미지·직접 주소/새로고침·모바일을 검증한다. 없는 JSON/자산은404여야 하며 상세 주소를 홈으로 redirect하지 않아야 한다.
4. **사용자 검토:** URL, SHA, 화면/필요한 모션 캡처, 확보한 명단·카드와 미확인 필드, 설정 변경 전/후, 성능·비용 예상과 남은 제한을 제시한다. 사용자의 수정 의견을 반영하고 같은 절차로 검토판을 갱신한다.

이전 Pages 미리보기에서는 `/index.html` 재작성으로 상세 주소가308/홈 이동하는 문제가 있었다. 실제 앱 경로를 `/ 200`으로 재작성하고 원격 상세200·Location없음·원래 URL 유지·새로고침·없는 자산404를 다시 검사한다. 로컬 서버 성공을 원격 라우팅 검증으로 대체하지 않는다.

### `dist` 전환과 7파일 호환의 정리 순서

현재 main의 앱 준비와 Pages의 브랜치별 빌드 설정 격리는 확인이 필요하다. 프로젝트 전역을 먼저 npm build/dist로 바꾸면 manifest가 없는 이전 main 재빌드가 실패할 수 있다.

기본 순서는 **기존 호환 경로의 검토판 → 사용자 검토 → T013의 운영 승인 → 앱 커밋을 main에 준비/반영 → 실제 dist 배포 전환·원격 검증 → 임시 사본 정리**다. 실제 Pages에서 운영과 격리된 preview build/output 설정이 확인되면 그 preview에서 dist 전환을 먼저 검증할 수 있다. 확인 전에 root 사본을 삭제하지 않는다.

현재 export 대상은 `index.html`, `app.js`, `styles.css`, `404.html`, `_headers`, `_redirects`, `data/catalog.json`뿐이다. **모델·텍스처·추가 JS 청크는 자동 포함되지 않는다.** 호환 경로로 새 자산을 제공해야 한다면 export 명세·회귀 검사·FILE_SYNC에 자산과 생성 원본을 함께 추가한다. dist 직접 배포에서는 실제 산출물 목록을 검사해 필요한 자산만 공개하고 문서·원본 DB·연구 자료를 제외한다.

## R3/T013 — 운영 승인과 반영

사용자가 구체적인 미리보기와 범위를 검토한 뒤 **운영 반영을 명시적으로 승인한 경우에만** main 병합과 운영 설정 전환을 실행한다. 미리보기 생성·CI 성공·설정 제안은 운영 승인이 아니다.

- 승인한 코드·데이터·자산의 SHA와 적용 설정을 고정하고 이전 정상 배포/스냅샷을 보존한다.
- 운영 배포의 commit·Node/npm·build output과 실제 페이지/JSON·이미지·직접 주소·부분 범위/가상 자료 표시를 검증한다. 파일 내용 일치와 배포 SHA 확인을 구분한다.
- 실패하면 이전 정상 배포와 데이터로 복구하고 결과·원인·다음 작업을 WORKPLAN에 기록한다. 신규/수정/종료의 실제 운영 갱신은 R5의 별도 완료 조건이다.

## R5/T016 — 정적 사이트와 자체 API 운영

Pages는 화면·정적 자산과 사이트용 현행 스냅샷을 전달한다. 전체 누적 자체 API는 허용된 범위의 카드/팩·revision·발행 상태를 제공하고, 사이트 빌드/동기화는 그 API 또는 검증된 export를 받아 현행 대상만 추출한다. 수집/갱신 writer는 허용된 출처의 관측→검증→누적 추가/개정 보존→사이트 추출→발행·복구를 맡는다. 사용자 요청마다 외부 사이트를 수집하거나 빌드용 SQLite를 그대로 공개하지 않는다. 누적 계층의 무삭제와 활성 API/검색/캐시 제외를 [데이터 수명주기](DATA_LIFECYCLE.md)에 따라 분리한다.

스케줄러·서비스 계정·API 서버·새 폴더 구조·주기·보관 비용은 후속 구현에서 확정한다. 신규 카드/팩과 수정 revision을 실제 반영한 증거, 멱등 재실행, 백업/롤백, 사이트의 판매 종료 제외와 누적 보존을 각각 검증하기 전에는 자동 갱신 운영 완료라고 기록하지 않는다.

동적 호스팅은 Cloudflare Workers/Pages Functions·D1 등 무료 웹/API 구성을 우선 실측하고, 적합하지 않으면 보유 OCI A1을 차선으로 평가한다. Workers의 CPU/메모리·D1의 **실제 읽은/쓴 행 수**·API 요청/캐시·백업/복구를 측정한다. 정적 Pages의 무료 트래픽을 동적 요청 무제한으로 해석하지 않는다. 서비스 활성화·계정/권한/비용 변경은 이번 계획에 포함하지 않는다.

## 공식 무료 한도와 R6/T018 자산 기준

아래는 이번 계획에서 부모가 공식 문서로 확인한 기준이다. 기존 계정 사용량과 초과 과금 조건은 서비스 선택 시 다시 확인한다.

| 서비스 | 공식 무료 기준 | 계획에 반영할 조건 |
| --- | --- | --- |
| [Pages](https://developers.cloudflare.com/pages/platform/limits/) | 월500빌드·동시1·빌드20분·20,000파일·파일당25MiB, 정적 요청/대역폭 무료 | 빌드·preview/재시도 예산과 파일수/최대파일을 측정. 변경 없는 수집을 매번 배포하지 않음 |
| [Functions](https://developers.cloudflare.com/pages/functions/pricing/) / [Workers](https://developers.cloudflare.com/workers/platform/limits/) | Workers Free 하루100,000요청·요청당CPU10ms·메모리128MB | 정적과 별도. 계정 내 공유량과 실제 CPU/메모리를 확인하며 무거운 시뮬레이션/3D 렌더를 API 처리로 전제하지 않음 |
| [D1 한도](https://developers.cloudflare.com/d1/platform/limits/)·[요금](https://developers.cloudflare.com/d1/platform/pricing/) | Free DB당500MB·계정5GB, 일 읽기500만행·쓰기10만행 | 쿼리/인덱스·갱신·보존 정책의 실제 행 사용량과 DB 용량 검증 |
| [R2 Standard](https://developers.cloudflare.com/r2/pricing/) | 월10GB-month·Class A100만·Class B1,000만, egress 무료 | 초과 시 비용 가능. r2.dev는 개발용이라는 부모 확인을 따르며, 운영 자산 제공 문서·경로·캐시/CORS를 활성화 전에 별도로 확인 |
| [OCI Always Free A1](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) | 월1,500OCPU시간·9,000GB시간, 2OCPU·12GB RAM 규모 | ARM64·실제 저장/전송·운영/백업·idle 회수·가용 용량 부족 가능성 확인. 보유 사실과 현재 접속/운영 가능을 구분 |

3D는 브라우저에서 렌더하고 Pages에는 압축한 모델·텍스처·코드를 제공하는 구성을 우선한다. 사용 권리·mesh/texture 압축·scene/LOD 분할·필요 시점 지연 로딩·2D 대체 표시를 검증한다. 현재 빌드는 자산을 복사할 뿐 자동 모델 압축·번들 최적화는 구현하지 않았다.

대표 데스크톱·모바일에서 최초 다운로드·상호작용 지연·프레임/메모리·파일수·최대파일·빌드 시간과 월 요청/저장 비용을 측정한다. 압축/분할 후에도 Pages 한도나 운영 특성에 맞지 않을 때 R2와 OCI를 비교한다. **3D 추가만으로 OCI 이전이나 R2 활성화를 확정하지 않는다.** 별도 서비스·추가 비용의 필요성이 생기면 검토할 구체적인 구성과 예상액을 제시한다.
