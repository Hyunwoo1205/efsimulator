> T017 구현 진행 중: 첨부9장/사용자지시의2D전체흐름과균등비복원엔진·IndexedDB/세션·리셋·결과/획득표시를연결한다. 구입확인창없이버튼→원자저장→짧은자체2D→단일중앙/10명반응형그리드→계속을제공하는계약이며검사/배포완료는아직기록하지않는다. 일반은명단에잔여수만표시하고결과에서만고정170588이미지를쓴다. 영상재생실패는3D후속참고로보존하며2D선행게이트가아니다. [근거](../../data/research/simulator-ui-reference-T017.json).

> T044 전달 당시 상태: 사용자 지정170588 원본PNG를고정파일로보존한익명일반카드와승인된팩데이터준비판정을구현한다. 엔진·세션·리셋은없고실행버튼은비활성이다. 제공YouTube -OPQF_c4WN4는실제프레임을관찰하지못해2D공개흐름미확정이다. 494회귀·앱TypeScript/공식Worker빌드와공개API원자적snapshot13팩data-ready를확인했고새배포/UIQA·GitHub/CI는아직미완료다. 실제후속결과는WORKPLAN을따른다.

> T042 가격: 1회100코인·10회900코인으로 고정하며 할인은 적용하지 않는다. 지원 여부와 잔여10명 조건은 기존 API 계약을 따른다. 앱은 API 가격을 소비하므로 데이터 발행·자동 갱신으로 반영되는지 검증한다.

> T043 최신 정렬: Epic(5) → Show Time(8) → Trend(3) → Highlight(6)의 API `playerType` 등급순은 유지한다. 같은 등급 안에서 팩 내부 선수는 OVR 내림차순, 전체 선수 목록/검색은 최신 출시일 → OVR 내림차순이다. 팩은 등급 안 날짜 최신순이다. 팩 대표 등급 선수의 OVR 상위 최대3명을 미리보기로 표시하고 낮은 등급을 보충하지 않는다. 실제 앱 public과 API/admin·검토 viewer owner-private, 서버 전용 인증은 유지한다. 실제 검증/배포 완료 여부는 WORKPLAN을 따른다.

> T040/T041 현황: 판매 중/종료 체험 선택과 API 추첨 옵션·타입 표시를 제공한다. T042 고정 가격은 단일100/10회900코인이며 API 값을 그대로 표시한다. 과거 null가격은 읽기 호환성을 유지한다. 실제 추첨 엔진·세션·2D/3D는 후속 T017/T018 범위다.


# eFsimulator 실제 앱

선수팩과 선수 탐색, 별도 시뮬레이터 진입 페이지를 제공하는 실제 제품 서버다. 검토용 catalog-view와 Site·소스를 분리한다.

## 페이지

- `/packs`: 판매 중·종료된 팩 탐색과 검색
- `/packs/[saleId]`: 회차별 전체 구성과 선수 상세 연결
- `/players`: 선수 카드 탐색
- `/players/[id]`: 카드 상세와 포함된 팩
- `/simulator`: T017에서팩선택·원자저장/복구·균등비복원단일/10회·리셋·2D결과/획득표시를구현중. 실제검사/배포범위는WORKPLAN을따른다.

## 서버 연결

브라우저는 같은 origin의 `/api/v1/*`를 호출한다. 서버는 Sites 런타임의 `CATALOG_API_ORIGIN`, secret `CATALOG_API_SERVICE_TOKEN`으로 기존 private API만 호출한다. 사용자 헤더·쿠키, 임의 URL, 관리자 경로·쓰기·리디렉션은 중계하지 않는다. 인증값은 소스·브라우저·로그에 넣지 않는다.

서버/Worker와 검증된 중계는 catalog-view에서 재사용하며 실제 앱 UI·경로는 별도로 구성한다. 가공 선수는 기존8필드에 정확한 원본 `playerType`을 추가한9필드 API를 소비한다. 과거8필드 발행본 읽기 호환성과 누적 원본·규칙 잠금은 유지한다. 목록 조회는 동일 publication만 함께 표시하며 변경 중에는 재조회 안내를 제공한다.

## 대표 카드

`lib/pack-preview.mjs`는 API의 카드별 `playerType`과 공통 정렬을 사용해 팩 대표 등급의 OVR 상위 최대3명을 선택한다. Epic/Show Time에 낮은 등급을 채우지 않는다. 신규 카드도 API가 전달한 타입을 사용하며 고정된 과거70명 표시 레지스트리를 운영 기준으로 쓰지 않는다. 미확인/새 코드는 미분류로 보존하고 이름·OVR로 추정하지 않는다. 등급/정렬은 추첨 규칙이나 확률을 바꾸지 않는다.

## 검사와 배포

`npm test`, `node node_modules/typescript/bin/tsc --noEmit`, Sites 공식 `build-site.mjs`를 사용한다. `.openai/hosting.json`의 실제 project_id를 재사용하고 새 Site를 중복 생성하지 않는다. T041 사용자는 실제 앱의 public 전환을 승인했다. 실제 전환/배포는 해당 native 반환 상태를 확인한 뒤 완료로 기록하며 API/admin·검토 viewer는 계속 owner-private다. 실제 배포 근거와 다음 작업은 저장소 WORKPLAN·DEPLOYMENT·FILE_SYNC를 따른다.

## 조회 상호작용 (T033)

내부 페이지 이동은 표준 링크를 사용한다. 현재 Vinext 배포 빌드의 RSC 링크 사전읽기/탐색 오류를 피해 메뉴·팩·선수 상세를 직접 URL로 연다. 팩 목록은 검색·판매 상태 탭·선수 명단 펼치기/접기·상세 연결을 제공한다. 선수 목록의 이름/카드 번호 검색과 포지션 필터를 함께 사용할 수 있다.

동적 경로의 saleId와 카드 ID는 `lib/route-id.mjs`로 한 번만 안전하게 디코딩한다. 이미 디코딩된 ID도 그대로 지원하며 잘못된 인코딩·중첩 인코딩·경로 구분자를 거부한다. 팩 회차나 선수 ID를 이름으로 추정하지 않는다. 해당 회귀 검증은 `tests/route-id.test.mjs`에 있다.

브라우저 검증은 배포용 Worker/클라이언트 빌드와 별도로 보존한 실제 API 응답 snapshot으로 수행하며 QA snapshot·보조 Worker·인증값은 소스/배포에 포함하지 않는다. 실제 hosted API 재조회와 로그인한 hosted 브라우저 검증의 범위는 작업 근거에서 구분한다.


## 공통 선수 카드 표시 (T034)

`app/components/catalog-ui.tsx`의 `Portrait`가 모든 선수 이미지를 담당한다. 카드 원본의 240×340 좌표계에 왼쪽 위 OVR·그 아래 포지션·하단 영문 이름을 함께 배치한다. 선수 이름은 API의 기존 영문 `name`을 쓰며, 긴 이름은 실제 글꼴 폭을 측정해 한 줄 안에서만 축소한다. 표시 OVR은 기존 API 값을 그대로 사용한다.

이미지의 `object-fit:contain`과 SVG의 `preserveAspectRatio:meet`를 맞춰 상세 화면의 여백에서도 위치가 유지된다. 각 `Portrait`의 격리된 paint/stacking context와 `overflow:hidden`, 상위 팩 영역 clipping을 유지해야 이미지·글자가 함께 회전·잘리고 다른 카드 뒤로 가려진다. 텍스트를 카드 밖이나 portal로 분리하지 않는다. 이미지가 없거나 실패해도 선수 식별 글자는 남고, 다른 imageUrl의 오류 상태를 재사용하지 않는다.

적용 범위: 팩 목록 미리보기·펼친 명단·팩 상세·선수 목록/상세·관련 팩·시뮬레이터 선택/명단. 원본 글꼴 출처는 `public/fonts/README.md`를 따른다. API 계약·선수 수치·팩 대표 선수 선택 규칙은 변경하지 않는다.


## 목록 정렬 (T043)

공통 `lib/catalog-order.mjs`가 Epic(5) → Show Time(8) → Trend(3) → Highlight(6) → 미분류 순서를 제공한다. 선수는 정확한 카드 ID의 API `playerType`으로만 등급을 구분한다. 같은 팩 안에서는 `sortPlayers`가 등급 → `overallRating` 내림차순, 전체 선수 목록/검색에서는 `sortGlobalPlayers`가 등급 → 출시일 최신순 → OVR 내림차순을 적용한다. 출시일은 판매 중/종료된 전체 연결팩 중 정확한 카드 ID가 처음 확인된 유효 원본 팩 날짜다. 같은 카드의 나중 재수록으로 출시일을 앞당기지 않으며 미확인/잘못된 날짜는 해당 등급의 날짜 확인 카드 뒤에 둔다. 미확인 OVR은 뒤에 두고 최종 동률은 문자열 ID로 고정한다. 팩은 검증된 대표 등급 안에서 유효한 원본 팩 날짜 최신순이며 미확인 날짜는 뒤에 둔다. 팩 제목을 개별 선수 타입으로 전파하지 않는다.

검색·포지션 필터는 전체 선수의 정렬된 순서를 유지한다. 팩 미리보기·팩 내부 명단·시뮬레이터 명단은 해당 팩의 등급/OVR 순서를 유지하고, 선수 상세의 관련 팩·시뮬레이터 팩 선택은 팩 정렬을 따른다. API 데이터가 갱신되면 타입과 정렬도 새 publication을 기준으로 함께 갱신한다. 기존 카드 표시·원본 배열과 추첨 확률은 보존한다. T043은 T041의 전체 선수 OVR 우선만 수정하며, T035의 Epic/Show Time 통합 그룹은 다시 적용하지 않는다.


## T044 일반 카드와 팩 데이터 준비

`app/components/standard-card.tsx`는 Player입력을받지않는익명일반표시전용이다. `public/images/simulator/standard-card-170588-cdf8117dae82.png`를로컬에서만읽으며이름·OVR·포지션오버레이가없다. 원본회색실루엣·프레임·별은그대로보존하고이미지오류시STANDARD대체표시를쓴다. T044때선택팩A>0미리보기를추가했으며현재T017명단은일반잔여수만표시하고고정카드는일반결과에만사용한다. 원격170588카드가바뀌어도자동교체하지않으며정확한출처·확보한PNG/해시·HTML403관측은같은폴더README를따른다.170588을팩의실명선수나일반슬롯ID로추가하지않는다.

`lib/simulator/prepare.mjs`는같은원자적CatalogProvider snapshot의saleId·N/S/A·members/전량선수9필드관계·중복/누락·유효양의타입·현행API옵션100/900을검증한다. 미분류양의타입도특수S에포함하고일반은N−S집계만유지한다. 반환ready/status/reasonCodes는데이터구성준비이며원출처신선도·엔진·저장·추첨가능보증이아니다. 로딩/조회오류·구성/옵션불일치면ready:false로표시하고입력·API·세션을수정하지않는다.

준비판정경계회귀는`tests/simulator-prepare.test.mjs`,고정자산SHA/PNG크기검사는`tests/standard-artwork.test.mjs`다. 전체494회귀·앱타입/공식빌드는통과했다. 기존공개API익명5GET의동일publication/163선수/13팩snapshot에서13팩data-ready를확인했고170588이선수API에추가되지않았음을확인했다. 새코드배포·실제UIQA·원격/CI는아직완료로기록하지않는다. 영상공개흐름미확정과APK미업로드를유지한다.

## T017 모듈과 저장·연출 경계

- `lib/simulator/prepare.mjs`: 같은원자적API snapshot의회차/N/S/A·전량9필드/명단·지원수량/100900검사.
- `engine.mjs`, `random.mjs`: 일반을실명객체없는정수로관리하고매장잔여n에서균등추첨·제거한다. Web Crypto/rejection sampling을사용하며Math.random대체가없다.
- `session.mjs`: 팩별schema/poolFingerprint·revision/commandId·현재/과거회차·batch/누적비용·미확인결과와수동/소진리셋전이.
- `storage.mjs`: `createSimulatorStore`의load/ensure/execute/close. 최신값읽기·검증·전이·put을같은IndexedDB readwrite transaction에서처리하고완료이벤트뒤반환한다. 다중탭revision·중복command·중단/실패·오래된자료/풀변경을보존하며무통보메모리대체나기록삭제를하지않는다.
- `app/components/simulator-page.tsx`, `simulator-results.tsx`: 같은저장batch의팩/결과/계속/명단과짧은자체2D·건너뛰기·동작줄이기를연결한다. 난수·비용·잔여풀을모션이나skip에서다시계산하지않는다.

판매중/종료체험을분리하고같은기기/브라우저의팩별진행을복원한다. 잔여1~9명일때10회는잠그고단일100으로소진한다. 수동/소진리셋은풀만복원하며이전결과·누적사용량을보존한다. 현재회차의정확특수ID만명단에서어둡게하고일반은잔여수로보인다. 단일은중앙1장,10회는정확히10장반응형그리드이며일반결과마다고정카드를표시한다. 구입확인창·계약권재화·3D는추가하지않는다.

이절은구현계약이다. 모듈별검사와전체회귀·타입/공식빌드·실제저장복구/UI/배포·GitHub/CI성공은실제근거가확인된뒤WORKPLAN과근거기록에추가한다. 원본첨부이미지는저장소/배포에복사하지않는다. 별도API/raw/processed·규칙잠금·가격계약은변경하지않는다.
