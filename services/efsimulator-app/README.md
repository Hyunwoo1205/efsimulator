# eFsimulator 실제 앱

선수팩과 선수 탐색, 별도 시뮬레이터 진입 페이지를 제공하는 실제 제품 서버다. 검토용 catalog-view와 Site·소스를 분리한다.

## 페이지

- `/packs`: 판매 중·종료된 팩 탐색과 검색
- `/packs/[saleId]`: 회차별 전체 구성과 선수 상세 연결
- `/players`: 선수 카드 탐색
- `/players/[id]`: 카드 상세와 포함된 팩
- `/simulator`: 현재 팩 선택과 구성 확인. 추첨 엔진은 T017 후속 작업이며 아직 제공하지 않는다.

## 서버 연결

브라우저는 같은 origin의 `/api/v1/*`를 호출한다. 서버는 Sites 런타임의 `CATALOG_API_ORIGIN`, secret `CATALOG_API_SERVICE_TOKEN`으로 기존 private API만 호출한다. 사용자 헤더·쿠키, 임의 URL, 관리자 경로·쓰기·리디렉션은 중계하지 않는다. 인증값은 소스·브라우저·로그에 넣지 않는다.

서버/Worker와 검증된 중계는 catalog-view에서 재사용하며 실제 앱 UI·경로는 별도로 구성한다. 선수8필드 API와 누적 원본·규칙 잠금은 유지한다. 목록 조회는 동일 publication만 함께 표시하며 변경 중에는 재조회 안내를 제공한다.

## 대표 카드

`lib/pack-preview.mjs`와 표시 전용 등급 metadata는 Epic/Show Time 대표 카드를 최대3장 선택하며 Highlight를 채우지 않는다. 미확인 등급은 기존 순서로 표시한다. 이 metadata는 추첨 규칙/확률 근거가 아니며 신규 등급을 자동 수집하지 않는다. metadata의 새 검증은 monorepo의 기존 catalog-view 개발 도구로 수행한 결과를 별도 개발 검토로 전달한다.

## 검사와 배포

`npm test`, `node node_modules/typescript/bin/tsc --noEmit`, Sites 공식 `build-site.mjs`를 사용한다. `.openai/hosting.json`의 실제 project_id를 재사용하고 새 Site를 중복 생성하지 않는다. 현재는 owner-private 검토 배포이며 공개 audience 변경은 별도 범위다. 실제 배포 근거와 다음 작업은 저장소 WORKPLAN·DEPLOYMENT·FILE_SYNC를 따른다.

## 조회 상호작용 (T033)

내부 페이지 이동은 표준 링크를 사용한다. 현재 Vinext 배포 빌드의 RSC 링크 사전읽기/탐색 오류를 피해 메뉴·팩·선수 상세를 직접 URL로 연다. 팩 목록은 검색·판매 상태 탭·선수 명단 펼치기/접기·상세 연결을 제공한다. 선수 목록의 이름/카드 번호 검색과 포지션 필터를 함께 사용할 수 있다.

동적 경로의 saleId와 카드 ID는 `lib/route-id.mjs`로 한 번만 안전하게 디코딩한다. 이미 디코딩된 ID도 그대로 지원하며 잘못된 인코딩·중첩 인코딩·경로 구분자를 거부한다. 팩 회차나 선수 ID를 이름으로 추정하지 않는다. 해당 회귀 검증은 `tests/route-id.test.mjs`에 있다.

브라우저 검증은 배포용 Worker/클라이언트 빌드와 별도로 보존한 실제 API 응답 snapshot으로 수행하며 QA snapshot·보조 Worker·인증값은 소스/배포에 포함하지 않는다. 실제 hosted API 재조회와 로그인한 hosted 브라우저 검증의 범위는 작업 근거에서 구분한다.
