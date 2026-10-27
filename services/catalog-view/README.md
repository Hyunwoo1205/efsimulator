# efsimulator Catalog View

최신 가공 선수팩·선수 API에 연결하는 별도 비공개 검토 앱이다. 기존 정적 앱과 API Site의 소스를 변경하지 않는다.

브라우저는 동일 origin의 `/api/v1/*`만 호출하며, 서버 중계가 `CATALOG_API_ORIGIN`의 정확한 HTTPS origin으로 조회 요청을 보낸다. `CATALOG_API_SERVICE_TOKEN`은 서버 런타임 환경변수에만 저장하고 `OAI-Sites-Authorization`으로 해당 API에만 전송한다. 관리자 API, 쓰기, 임의 URL, 리디렉션, 방문자의 쿠키·인증 헤더는 중계하지 않는다.

필요 환경변수는 `.env.example`에 이름만 기록한다. Sites 비공개 접근 제어를 유지한다. `d1`과 `r2`는 사용하지 않으며 실제 Site 등록 시 반환된 `project_id`를 `.openai/hosting.json`에 저장한다.

공식 Sites Vinext 빌드 통합과 고정 의존 잠금 파일을 유지한다. 검사 명령은 `node --test tests/*.test.mjs`, 빌드는 현재 Sites 스킬의 설치·빌드 helper를 사용한다. 배포 산출물에 원본 데이터나 인증값을 포함하지 않는다.

팩 미리보기는 `lib/pack-preview.mjs`에서 선택한다. Epic·Show Time 상품은 공개 표시 메타데이터에 기록한 정확한 카드 ID의 원본 등급(각각 5·8)을 우선하고, 해당 등급이 한 장뿐이면 한 장만 표시한다. 등급을 확인하지 못한 상품은 기존처럼 처음 세 장을 표시한다. 이름·OVR로 등급을 추정하지 않으며 API 데이터와 명단 순서는 변경하지 않는다.

`lib/preview-player-types.json`은 승인된 가공 선수의 ID·원본 playerType과 검증 입력의 해시·발행 버전만 담는다. 갱신은 개발용 monorepo에서 `node services/catalog-view/scripts/prepare-preview-types.mjs --root ABSOLUTE_CATALOG_RUNTIME`으로 수행한다. 스크립트는 기존 API의 고정 `loadWorkspace`를 재사용해 CURRENT·세대 파일·규칙 바인딩 검사를 통과한 입력만 읽는다. EFHub 등급표 근거는 `data/research/source-observations.json`의 `efhub_types_js` 관측이다. 생성기는 API 형제 폴더와 조사 문서를 사용하는 개발 도구이며 독립 배포 앱의 실행 의존성이 아니다. 운영 화면이 자동으로 메타데이터를 재생성하지는 않는다.
