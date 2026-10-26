# 수집 원본과 자체 API 데이터 계약

2026-10-27 사용자 지시(T024)가 이전의 ‘모든 raw 항목을 가공해 API에 제공’ 및 ‘얇은 아카이브’ 제안을 대체한다. 배포 대상은 기존 결정대로 별도 API Sites 프로젝트다. 이 문서는 구현 계약이며 hosted 배포 완료 보고가 아니다.

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
6. 검증된 가공 상품 중 공식 현재 목록에 있는 신규/재활성 상품을 live에 반영한다. 변경이 생긴 가공 파일·live·archive마다 `api_updates.jsonl`에 대상 파일과 변경 ID, 전후 수, 전이와 근거를 기록한다. 변화 없는 확인은 별도 `checks.jsonl`에 남긴다.
7. 모든 참조·수·파일 해시를 검증한 불변 세대를 만들고 `CURRENT.json`만 원자적으로 바꾼다. 이전 세대는 보존한다. D1도 새 버전 레코드를 모두 적재·검증한 뒤 단일 활성 포인터를 전환한다. 미완료 수입을 API에 노출하지 않는다.

한 사이트만 먼저 갱신되었거나 매핑/특수 명단이 불명확하면 신규 항목을 발행하지 않는다. 기존 정상 데이터와 종료 처리는 계속 유지한다. 403/429/접근 challenge가 나오면 해당 실행의 EFHub 수집을 중단하고 우회·즉시 재시도하지 않는다. 다음 예약 실행에서도 정상 접근만 시도한다.

## 일치 조건과 조회

- live와 archive의 `saleId`는 서로 겹치지 않으며 합집합이 가공 팩 전체와 같다.
- live와 archive 안의 선수 ID 합집합을 중복 제거하면 가공 선수 전체와 같다. 단순 배열 길이 합계는 공유 카드 때문에 다를 수 있다.
- 모든 `members.id`는 가공 선수에 존재하고 ID·이름이 일치한다. 중첩 선수는 8개 필드를 빠짐없이 포함한다.
- 두 중첩 파일의 팩 필드는 가공 팩과 같다. archive의 전이 메타만 추가한다.
- API `/cards`(`/players` 별칭), `/packs`는 가공 누적 자료, `/live`, `/archive`는 중첩 자료다. 원본/이전 47,408장 staging으로 fallback하지 않는다.
- 매시간 실행 사이에 종료 시각이 도래해도 API GET은 서버 UTC로 live에서 제외하고 archive 뷰에서 반환한다. GET에서 DB를 쓰지 않으며 실제 파일 이동과 로그는 다음 갱신에서 확정한다.

## 현재 실행의 한계

2026-10-27 KST 공식 HTML에서 7개 상품을 정상 파싱했다. EFHub의 읽기 가능한 페이지 내용은 확인했지만 수집기에서 전체 HTML 요청은 403이었다. 따라서 신규 원본 HTML 수집 성공을 주장하지 않는다. 기존 문자열 ID 관계와 사용자 제공 11명 보정으로 4팩·44카드의 가공 표본을 만들며, 나머지 3개 공식 상품의 정확한 관계는 대기한다. 비어 있는 archive는 판매 중단 사례를 실제 수집했다는 뜻이 아니다. 종료·재활성·중복·장애·원자성은 테스트로 검증한다.

실제 API Site 등록/배포와 원격 D1 적재는 별도 후속이다. 매시간 예약 작업과 hosted 서비스 cron은 구분한다. 스케줄이 있어도 차단된 원출처의 수입 완료나 API 운영 가동을 의미하지 않는다.
