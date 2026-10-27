# 수집 원본과 자체 API 데이터 계약

2026-10-27 사용자 지시(T024)가 이전의 ‘모든 raw 항목을 가공해 API에 제공’ 및 ‘얇은 아카이브’ 제안을 대체한다. 배포 대상은 기존 결정대로 별도 API Sites 프로젝트다. 이 문서는 구현 계약이며 실제 hosted 배포·검증 근거는 T025/WORKPLAN을 따른다. T030 최신 결정은 이 API 개발을 완료 기준으로 두고 이후 오류를 유지보수하는 것이다.

| 논리 파일 | 범위와 역할 |
| --- | --- |
| `raw/players_raw.json` | 기존 선수 배열의 형식을 유지하는 누적 원본. 신규 ID만 추가 |
| `raw/packs_raw.json` | 기존 `name, slug, date, playerCount` 형식의 누적 원본. `playerCount`는 특수 선수 수 |
| `logs/players_raw_updates.jsonl` | 선수 원본 baseline/추가 기록, 대상 파일·ID·전후 수·해시·수집 근거 |
| `logs/packs_raw_updates.jsonl` | 팩 원본 baseline/추가 기록. 선수 원본 기록과 분리 |
| `processed/players.json` | 공식 확률표와 EFHub의 동일 상품이 검증되어 채택된 팩의 선수만 누적 |
| `processed/packs.json` | 채택된 상품 회차를 누적하며 카드 ID·이름, 공식 전체 인원·종료 UTC 추가 |
| `live.json` | 현재 유효한 팩 정보 전체와 각 팩의 가공 선수 정보 전체를 중첩 |
| `archive.json` | 종료/공식 게재 중단된 팩의 전체 중첩 기록. 선수 상세를 생략하지 않음 |
| `logs/api_updates.jsonl` | 가공 선수·가공 팩·live·archive의 변경 기록. `targetFile` 필수 |

이 경로는 데이터 세대 안의 논리 경로다. 비공개 작업 묶음의 `CURRENT.json`이 `versions/<version>/`를 가리킨다. 데이터는 Git 코드·정적 공개 파일과 분리한다. JSON은 데이터 가공/교환 형식이며, 운영 HTTP API는 검증·발행한 D1 데이터만 읽는다. 방문자 조회에서 raw JSON이나 EFHub에 접근하지 않는다.

## 선수와 팩

가공 선수의 필드는 정확히 `id`, `name`, `slug`, `position`, `overallRating`, `playingStyle`, `playingStyleDefensive`, `imageUrl`이다. 일본어/중국어 이름·국적·팀·종류·팩 역참조는 넣지 않는다. 없는 선택 필드는 null이며 원본 ID는 문자열을 유지한다. OVR의 레벨/부스터 조건은 이 계약에서 새로 추정하지 않는다.

팩은 원본 이름·slug·date 외에 `saleId`, `officialTitle`, `playerCount`, `sourceReportedPlayerCount`, `totalPlayerCount`, `standardPlayerCount`, `endsAt`, `members:[{id,name}]`, `countCorrection`, `provenance`를 포함한다. `date`는 EFHub의 원본 날짜이며 판매 시작일로 해석하지 않는다. `saleId`는 검증한 상품 회차의 내부 식별자다. 같은 제목의 재판매는 자동으로 같은 회차로 합치지 않는다.

`playerCount`는 검증한 특수 인원, `sourceReportedPlayerCount`는 원본 표시값이다. 2026-10-26 Italian League Attackers는 원본 8과 사용자 확인 11을 모두 보존한다. 원본 파일을 11로 고치거나 카드 세 장을 버리지 않는다. 공식 전체 N과 검증한 전체 특수 S가 같은 회차에서 확인되어야 `standardPlayerCount=N−S`를 계산한다. 특수 명단 부족·중복·음수이면 새 상품 발행을 보류한다. 일반 선수의 실명/ID가 확보되지 않았다면 가짜 선수 레코드를 만들지 않는다. 중첩 `players`는 확인된 특수 카드 전체이며 N명 전원의 실명 명단이라는 뜻이 아니다.

`live.json`의 항목은 팩의 모든 필드와 `players:[{위 8개 선수 필드}]`를 포함한다. `archive.json`도 동일한 내용을 보존하고 `archivedAt`, `archiveReason`을 더한다. 공유 카드는 여러 팩 안에 등장할 수 있다.

```json
{
  "saleId": "검증한-팩-slug::회차",
  "slug": "검증한-팩-slug",
  "members": [{"id": "문자열 카드 ID", "name": "선수 이름"}],
  "players": [{"id": "문자열 카드 ID", "name": "선수 이름", "slug": "선수-slug", "position": "CF", "overallRating": 85, "playingStyle": null, "playingStyleDefensive": null, "imageUrl": "https://example.invalid/card.png"}]
}
```

이 예시는 중첩 관계만 설명하며 실제 상품 데이터가 아니다. 실제 파일에서는 위 표의 팩 필드를 모두 포함한다.

## 매시간 한 번의 처리

1. 공식 KR 확률표와 EFHub `/new-players`의 HTML을 각각 확인한다. HTML 속 JSON 문자열은 데이터로 파싱하고 스크립트를 실행하지 않는다. 원본 API endpoint를 호출하지 않는다. 필요한 신규 카드/팩의 상세 HTML만 추가로 읽는다.
2. 두 출처에서 같은 상품·회차가 확인되어야 신규 수입 후보가 된다. `data/research/catalog-sale-mappings.json`의 명시적 매핑·종료·전체 인원·카드 ID 근거로 확인한다. 제목/번역/페이지 순번만으로 연결하지 않는다. 매핑을 확인할 수 없는 신규 상품은 대기 기록과 알림으로 남긴다.
3. 기존 raw ID/slug를 확인하고 없는 항목만 기존 형식으로 추가한다. 원본 신규 값이 불완전하거나 기존 ID의 값과 충돌하면 덮어쓰지 않고 대기한다. 선수/팩 raw 로그에 각각 대상 파일·추가 ID·전후 수·해시·출처를 기록한다.
4. raw에 저장할 수 있는 후보만 가공 선수/팩에 반영한다. 기존 raw의 역사 전체를 API DB로 복사하지 않는다. 신규로 공식 게재된 상품이 이미 raw에 있다면 재수집 없이 해당 항목을 사용한다.
5. 확인된 UTC 종료 시점이 지난 live 상품을 전체 선수 정보와 함께 즉시 archive로 옮긴다. 출처 장애 중에도 이미 확인한 종료 시각은 적용한다. 공식 정상 전체 목록에서 제거된 상품은 `official_removed`로 구분한다. 빈 응답·부분 HTML·403·시간 초과·오래된 관측을 상품 삭제로 해석하지 않는다.
6. 검증된 가공 상품 중 공식 현재 목록에 있는 신규/재활성 상품을 live에 반영한다. 변경이 생긴 가공 파일·live·archive마다 `api_updates.jsonl`에 대상 파일과 변경 ID, 전후 수, 전이와 근거를 기록한다. run-cycle을 실제 수행한 검증은 `checks.jsonl`에 남기되, 시간별 경량 사전검사에서 의미 있는 HTML/데이터·종료 변화가 없으면 run-cycle·checks/receipt·SQL·압축·저장·응답 없이 조기 종료하는 최신 예약 규칙을 우선한다.
7. 모든 참조·수·파일 해시를 검증한 불변 세대를 만들고 `CURRENT.json`만 원자적으로 바꾼다. 이전 세대는 보존한다. D1도 새 버전 레코드를 모두 적재·검증한 뒤 단일 활성 포인터를 전환한다. 미완료 수입을 API에 노출하지 않는다.

한 사이트만 먼저 갱신되었거나 매핑/특수 명단이 불명확하면 신규 항목을 발행하지 않는다. 기존 정상 데이터와 종료 처리는 계속 유지한다. 403/429/접근 challenge가 나오면 해당 실행의 EFHub 수집을 중단하고 우회·즉시 재시도하지 않는다. 영속 nextRequestAt 이전에는 해당 origin 요청을 생략하며, 실제 재요청이 허용될 때만 정상 접근을 시도한다.

## 일치 조건과 조회

- live와 archive의 `saleId`는 서로 겹치지 않으며 합집합이 가공 팩 전체와 같다.
- live와 archive 안의 선수 ID 합집합을 중복 제거하면 가공 선수 전체와 같다. 단순 배열 길이 합계는 공유 카드 때문에 다를 수 있다.
- 모든 `members.id`는 가공 선수에 존재하고 ID·이름이 일치한다. 중첩 선수는 8개 필드를 빠짐없이 포함한다.
- 두 중첩 파일의 팩 필드는 가공 팩과 같다. archive의 전이 메타만 추가한다.
- API `/cards`(`/players` 별칭), `/packs`는 가공 누적 자료, `/live`, `/archive`는 중첩 자료다. 원본/이전 47,408장 staging으로 fallback하지 않는다.
- 매시간 실행 사이에 종료 시각이 도래해도 API GET은 서버 UTC로 live에서 제외하고 archive 뷰에서 반환한다. GET에서 DB를 쓰지 않으며 실제 파일 이동과 로그는 다음 갱신에서 확정한다.

## T024 초기 실행의 한계 — 당시 관측

아래4팩44카드·미확정3·미배포 설명은 T024 초기 실행 당시다. T028의7팩70카드 연결과 T025의 실제 private D1 적재/조회/복구가 이후 전달됐으며 현재 API 개발 완료 기준을 다시 미완료로 바꾸지 않는다.

2026-10-27 KST 공식 HTML에서 7개 상품을 정상 파싱했다. EFHub의 읽기 가능한 페이지 내용은 확인했지만 수집기에서 전체 HTML 요청은 403이었다. 따라서 신규 원본 HTML 수집 성공을 주장하지 않는다. 기존 문자열 ID 관계와 사용자 제공 11명 보정으로 4팩·44카드의 가공 표본을 만들며, 나머지 3개 공식 상품의 정확한 관계는 대기한다. 비어 있는 archive는 판매 중단 사례를 실제 수집했다는 뜻이 아니다. 종료·재활성·중복·장애·원자성은 테스트로 검증한다.

실제 API Site 등록/배포와 원격 D1 적재는 별도 후속이다. 매시간 예약 작업과 hosted 서비스 cron은 구분한다. 스케줄이 있어도 차단된 원출처의 수입 완료나 API 운영 가동을 의미하지 않는다.

2026-10-27 02:28 KST T026 점검에서는 EFHub 정상 HTML200을 수신했다. 중첩 섹션 헤더 및 요약 카드(상세 원본 필드 없음)를 처리하도록 파서를 보완했고 기존 4팩44카드 전체 ID를 재검증했다. raw 추가/판매 종료는 없고 processed/packs.json·live.json의 관측 근거 및 대상 파일별 로그만 갱신했다. 미확정3상품과 hosted 미배포 상태는 유지한다. 이전 403 관측은 당시 이력으로 보존한다.


## T027 — 결정적 갱신과 변경 통제

반복 결과의 기준은 **동일한 기존 raw/가공 세대, 동일 HTML과 관측 시각, 동일 검토 매핑, 동일 규칙 버전, 동일 기준 UTC**다. 이 조건이면 raw 추가분·가공 선수/팩·live/archive·변경 로그·발행 SQL과 콘텐츠 버전이 일치한다. 기존 raw 항목과 순서는 유지하고 신규 꼬리만 문자열 코드포인트 순서로 고정한다. 가공 배열·명단·후보는 안정된 문자열 순서로 처리한다. 객체 키 순서나 후보 순서 때문에 먼저 온 값이 채택되지 않으며 충돌 후보는 모두 대기한다. 운영 시각이 달라 종료가 도래하면 live/archive가 바뀌는 것이 정상이다. 실제 확인 횟수는 checks 기록으로 남기되 동일 데이터의 버전·업데이트 로그를 추가하지 않는다.

### 공통 형식 검사

`services/catalog-api/lib/catalog-contract.mjs`가 수집·수동 반영·발행의 공통 검증 원본이다. 신규 raw 선수는 원래 전체 필수 필드를 갖추고 허용되지 않은 필드가 없어야 한다. 신규 팩은 name/slug/date/playerCount 네 필드만 허용한다. 역사 원본의 기존 누락·의심 항목은 수정하지 않으며 신규 불완전 입력을 허용하는 근거로 삼지 않는다. 가공 선수 8필드, 가공 팩의 전체 고정 필드, members 두 필드, live/archive 중첩 구조, 각 raw/API 로그의 대상 파일·타입·증감·ID·전이 검사를 모두 적용한다. raw 로그의 최종 수/해시와 이전 로그 연결이 실제 파일과 일치해야 한다.

### 증거와 검토 매핑

수집기는 정상 HTML 또는 오류를 정확한 URL·관측 UTC·바이트 수·SHA256과 함께 receipt에 보존한다. 작업 공간 반영은 receipt를 네트워크 요청 없이 재실행해 후보와 공식 목록을 다시 계산한다. caller가 준 matchVerified/membershipComplete/userConfirmed만으로 발행하지 않으며 caller 결과가 재실행과 다르면 거부한다. 원본 기준 해시·시간·규칙이 다르거나 HTML이 바뀌었으면 이전 receipt를 재사용하지 않는다. receipt는 원출처 전자서명이 아니라 받은 입력의 무결성·재현성 근거다.

`policy/approved-mappings.json`의 검토 기록은 정확한 상품 회차·전체 특수 ID·종료·공식 총원·보정·근거를 포함하는 매핑의 해시를 고정한다. T027 최초 채택은 T024/T026 네 매핑과 사용자 확인 8/11 보정을 등록했다. 이후 T028의 별도 사용자 지시·완전 카드 링크 재검증으로 세 상품을 추가하여 현재는 일곱 매핑이다. 정기 실행은 미확정 상품을 임의 승인하지 않는다. 검토 ID·근거는 감사 기록이며 사용자 인증 서명을 위조해 기록하지 않는다. 미등록 상품은 수집기가 pending으로 남기고 AI가 이름 유사도나 임의 보정으로 등록하지 않는다.

### 규칙 버전과 안전한 채택

`policy/rules.lock.json`은 공통 형식·가공·파서·수집·receipt·파일 발행·API 코드와 검토 레지스트리의 정확한 SHA256을 고정한다. `data:rules-check`와 매 실행에서 검사하고 자동 재생성하지 않는다. 작업 공간의 RULES.json은 규칙 ID와 검토 레지스트리를 고정하며 CURRENT의 manifest/hash에도 같은 바인딩이 포함된다. 한 파일의 해시만 고쳐서는 반영되지 않는다.

기존 작업 공간은 `data:adopt-rules -- --root <작업공간> --expected-version <현재해시> --review-id <검토ID> --reason <이유> --now <UTC>`로 명시적으로 채택한다. raw/가공/로그 바이트를 유지한 새 바인딩 세대를 검증하고 CURRENT를 전환하며 rule-adoptions.jsonl에 이유·전후 규칙을 기록한다. 경합이나 중단 시 기존 세대를 보존하며 불일치 상태에서는 일반 쓰기를 차단한다. 같은 정책 재채택은 변화가 없다.

정기 점검은 코드·스키마·매핑·잠금·테스트를 변경하지 않는다. HTML 변경·미검토 신규 상품은 별도 검토 대상이며 새 사용자 지시 없이 self-heal/규칙 완화로 통과시키지 않는다. 전체 파일 쓰기 권한자의 고의 변경을 물리적으로 막는 권한 경계는 별도 운영 설정이다.

### 파일과 운영 진입점

`catalog-runtime/receipts/<sha>.json`은 비공개 증거이고 checks.jsonl에는 receipt 해시/규칙 ID를 남긴다. 원문 HTML을 공개 DB/API에 넣지 않는다. API 발행 폴더의 첫 manifest·SQL·activate.sql은 불변이며 다른 활성화 lease는 activations 하위에 별도 보관한다. 운영 진입점은 run-cycle이고 plan/reconcile/generatePublication 같은 하위 함수는 독립적인 원출처 인증 수단이 아니다. 원격 Sites/D1 배포 완료를 뜻하지 않는다.


## T028 — 과거 팩과 보존된 HTML 추출 근거

정상·완전한 new-players에 검토된 과거 팩의 섹션이 없으면, 같은 명시적 slug의 상세 HTML을 한 번 확인한다. 제목·출시일·원본 표시 인원·해당 팩의 카드 grid·정확한 전체 문자열 ID를 대조한다. 중복 섹션·차단·불완전 HTML은 상세 페이지 재시도로 우회하지 않는다. 기존 raw가 있을 때는 표시용 카드에서 원본 필드를 만들어내지 않는다.

별도 사용자 검토 작업의 `run-cycle --reviewed-cache FILE`은 보존된 검색 서비스의 **HTML 추출 응답**을 사용할 수 있다. 이 응답은 raw HTML 또는 신규 origin 200으로 바꾸어 표시하지 않는다. 원래 추출 응답·크롤 메타데이터·검색 참조와 링크 click 응답 전체를 그대로 저장하고, 팩의 완전한 줄/제목/날짜/표시 인원과 각 링크 참조→decimal ID URL을 재파싱한다. 세부 raw는 이미 보유한 카드에서만 가져오며 ID·이름·OVR·포지션·팩 날짜/인원을 모두 대조한다. 신규 raw는 이 경로로 만들지 않는다.

근거 전체의 해시는 검토 매핑 및 승인 레지스트리에 고정한다. schemaVersion 2 receipt는 그 추출 근거와 raw 기준·규칙·공식 HTML·기준 UTC를 결합해 같은 프로그램으로 다시 계산한다. 바뀐 링크·일부 누락·오래된 공식 관측·다른 원본·다른 승인·다른 규칙은 거부한다. 검색에서 읽은 시각과 원출처의 관측 시각을 구분하며, 원출처 신규 관측은 null이다. 검색/재검토에 성공해도 403 cooldown은 해제하지 않는다.

2026-10-28 KST T028에서 사용자 확인한 세 상품의 전체 특수 26명(4/11/11)을 검증하고, 기존 4팩44카드에 더해 **7팩70카드/live7/archive0**을 로컬 발행했다. 공식 전체 인원은 Quaresma 50명, 두 Selection 각각 11명이다. raw 47,408/1,699와 기존 데이터는 보존했다. 실제 Sites/D1 배포는 이 데이터 완성에 포함되지 않는다.
