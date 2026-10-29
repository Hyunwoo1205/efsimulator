# efsimulator Catalog View

최신 가공 선수팩·선수 API에 연결하는 별도 비공개 검토 앱이다. 기존 정적 앱과 API Site의 소스를 변경하지 않는다.

브라우저는 동일 origin의 `/api/v1/*`만 호출하며, 서버 중계가 `CATALOG_API_ORIGIN`의 정확한 HTTPS origin으로 조회 요청을 보낸다. `CATALOG_API_SERVICE_TOKEN`은 서버 런타임 환경변수에만 저장하고 `OAI-Sites-Authorization`으로 해당 API에만 전송한다. 관리자 API, 쓰기, 임의 URL, 리디렉션, 방문자의 쿠키·인증 헤더는 중계하지 않는다.

필요 환경변수는 `.env.example`에 이름만 기록한다. Sites 비공개 접근 제어를 유지한다. `d1`과 `r2`는 사용하지 않으며 실제 Site 등록 시 반환된 `project_id`를 `.openai/hosting.json`에 저장한다.

공식 Sites Vinext 빌드 통합과 고정 의존 잠금 파일을 유지한다. 검사 명령은 `node --test tests/*.test.mjs`, 빌드는 현재 Sites 스킬의 설치·빌드 helper를 사용한다. 배포 산출물에 원본 데이터나 인증값을 포함하지 않는다.

T041부터 팩/선수의 정렬·미리보기는 API의 카드별 `playerType`을 사용한다. Epic(5) → Show Time(8) → Trend(3) → Highlight(6) 순으로 분류한다. T043부터 같은 등급의 전체 선수 목록/검색은 출시일 최신순 → OVR 내림차순, 같은 팩 내부는 OVR 내림차순이다. 선수 출시일은 판매 중/종료 전체 연결팩 중 정확한 카드 ID의 최초 유효 팩 날짜이며 나중 재수록으로 바꾸지 않는다. 미확인 날짜/OVR은 뒤에 두고 최종 동률은 문자열 ID로 고정한다. 팩은 등급 안 날짜 최신순이다. 미리보기는 가장 높은 확인 등급에서 OVR 상위 최대3명이며 낮은 등급으로 보충하지 않는다. 고정70명 타입표와 생성기는 역사적 검토 자료로 남기고 런타임에서는 사용하지 않는다. API가 갱신되면 새 카드의 타입도 함께 소비한다.
