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
