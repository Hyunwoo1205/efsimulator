# API 전용 Sites 업로드 준비 — T023
> T030 최신 결정: T025의 검증된 private API 전달 범위로 API 개발은 완료한다. 아래 공개 운영 검토 대기 문구는 당시 이력이며 API 공개 전환은 private 서버 relay를 사용할 다음 실제 앱 설계의 필수 조건이 아니다. catalog-view는 별도 데이터 검토 도구다. 오류/운영 관찰은 유지보수로 분리하고 다음 제품 요구·UX·API 연동·추첨 규칙 설계는 T031을 따른다. 이번 문서 정리로 Site/데이터/자동화를 변경하지 않는다.


> T025 최신 실행(2026-10-28 KST): 사용자가 배포 순서 실행을 지시했다. `services/catalog-api/`의 새 owner-private Site와 D1에 검증된 **가공 publication**을 적재·검증하고 별도 `services/catalog-view/` 조회 앱과 기존 자동 갱신의 원격 발행을 연결한다. API Site ID는 `appgprj_6ae0d51638b481918f7767684a3cf38b`이며 API private 배포·가공7팩70카드 적재·전량 원격 검증·데이터 복귀/최신 복원은 확인됐고, 별도 조회 앱의 실제5경로/HTML 응답과 기존 자동화 공통 발행 절차 연결·fresh 소스/서비스 접근 replay도 검증했다. 다음 예약 실행과 사용자 브라우저 상호작용 검사는 아직 관측하지 않았고 공개 운영 사용자 검토 대기다. 상세 배포·데이터·복구·앱 결과는 [WORKPLAN T025](WORKPLAN.md#t025--apid1-비공개-배포와-원격-발행앱-연동)에서 확인한다. 아래 T023의 raw 전량 staging 수입·5테이블·미등록·실행 제외 설명은 당시 이력이다. 최신 read API는 `api_versions/api_records/api_current`의 검증된 가공 버전만 사용하며 raw 47,408개를 운영 API에 적재하지 않는다.

T025 배포는 공식 source helper로 각 하위 소스를 별도 Sites 저장소에 전달하고 해당 SHA의 Worker archive를 owner-private으로 저장·배포한다. 인증된 고정 JSON writer가 전량 원격 내용·해시를 검증한 후 expected-current 활성화를 수행한다. `health`의 HTTP200만으로 준비 완료라 하지 않고 ready·버전·manifest·실제 조회를 확인한다. 코드 저장 버전과 데이터 current 복귀는 별도로 시험한다. 새 private 서비스의 인증은 Sites service access를 서버에서만 사용하고 CORS와 구분한다. 상세 현재 절차는 [DEPLOYMENT](DEPLOYMENT.md)를 따른다.

> T024 최신 지시(2026-10-27): raw는 기존 형식을 유지하는 누적 원본이며 HTTP 조회에 사용하지 않는다. 가공 선수/팩은 공식 KR와 EFHub에서 같은 상품·회차가 확인된 대상만 누적한다. 선수 8개 필드, 팩의 선수 연결, 전체 중첩 live/archive와 파일별 로그를 구현한다. 과거의 모든 raw 항목 공개 API·얇은 아카이브·24시간 이관 대기는 이 결정으로 대체한다. [현재 데이터 계약](CATALOG_DATA_CONTRACT.md)을 우선한다.


2026-10-26 KST. 사용자의 최신 결정에 따라 **API를 앱과 별도의 Sites 프로젝트로 배포**할 소스를 준비한다. 저장소는 유지하고 `api-server-setup` 브랜치와 `services/catalog-api/` 독립 프로젝트를 사용한다. 기존의 같은 Site 권장안은 이 결정으로 대체한다.

## Git·배포 경계

| 대상 | 위치·처리 |
| --- | --- |
| GitHub 소스 | `Hyunwoo1205/efsimulator`, `api-server-setup` 브랜치 |
| API 소스 루트 | `services/catalog-api/` |
| 기존 앱 | `web/*`·root package와 Pages 호환 산출물 유지 |
| Sites 등록 | 후속 작업. `.openai/hosting.json`에는 `d1: DB`, `r2: null`만 있으며 실제 project_id 없음 |
| 데이터 업로드 묶음 | Git 비추적 `artifacts/catalog-api-import/`. raw·JSONL·순서/해시 manifest·SQL 99개 chunk |
| 검증용 DB | Git 비추적 `artifacts/catalog-api-staging.sqlite` |
| 별도 source 내보내기 | `scripts/export-source.mjs`로 API 하위 폴더만 외부 빈 디렉터리에 복사 |

이번에 준비한 서버는 읽기 API와 schema·초기/staging 수입 도구다. GitHub branch push는 소스 보존이며 Sites 배포나 데이터 공개를 뜻하지 않는다. Site 등록·version 저장·배포·원격 D1 수입·R2·새 자동화·기존 초기 Site 수정은 이번 준비 범위에서 수행하지 않는다. root 앱 배포 설정도 변경하지 않는다.

## 입력과 가공

최신 첨부 선수 파일은 47,408개로 이전 47,397개 뒤에 정확히 11개가 추가됐고 기존 값/순서·ID가 보존됐다. 팩 1,699개는 이전 원본과 동일하다. 입력 해시와 Library 식별자는 [inputs.manifest.json](../services/catalog-api/inputs.manifest.json)에 기록한다. 이전 T021/T022 수치는 당시 사실로 보존하고 최신 입력과 혼동하지 않는다.

- 카드 ID는 문자열·출시 카드 단위로 보존한다. 정규화 필드와 raw 참조를 분리하고 원문 누락 필드·추가 필드도 남긴다. 국가의 빈 문자열은 정규화에서 null이며 원문은 별도로 보존한다.
- 카드 47,408개, 유효 팩 1,697개, 격리 2개, 관계가 있는 팩 10개·관계 90개가 이번 수입 대상이다. 2개 격리는 빈 팩 식별자와 dummy이며 raw는 삭제하지 않는다.
- 기존 9팩·79관계와 첨부의 11관계를 사용한다. 원본 8명은 `source_reported_count`, 보정 11명은 `effective_member_count`와 `user_confirmed`로 보존한다. HTML 자체의 재관측이나 공식 회차·전체 특수 검증을 이번 오프라인 검증으로 대체하지 않는다.
- 의미 있는 내용의 해시로 불변 개정을 만들고 동일 내용은 재사용한다. 목록에서 빠진 엔티티·이전 값·관계는 삭제하지 않는다. 새 null로 기존 확인값을 덮지 않고 current revision을 유지하며 후보 개정을 보존한다. 향후 후보 병합·활성 선택은 별도 검토한다.
- 공식 초기 N·전체 특수 S·현재 판매·simulation_ready는 이번 수입만으로 확정하지 않는다. 현재 판매용 projection·가격/추첨 규칙·이미지 다운로드는 아직 미구현이다.

## 준비한 API와 연동

`/api/v1/health`, `/manifest`, `/cards`, `/cards/{id}`, `/packs`, `/packs/{slug}`, `/packs/{slug}/cards`를 제공한다. 목록은 검색과 최대 100개의 문자열 cursor 페이지를 사용한다. DB 미설정/미수입·잘못된 입력·없는 ID·비허용 Origin·쓰기 요청을 명확히 구분한다. GET에서 외부 수집이나 DB 쓰기를 실행하지 않는다.

[client/catalog-api-client.mjs](../services/catalog-api/client/catalog-api-client.mjs)를 앱에 연동할 수 있다. 별도 Site의 실제 API origin은 배포 후 설정하고 호출 앱 origin을 정확한 CORS allowlist에 등록한다. private API의 인증은 CORS와 별개다. 앱 서버의 지원 service access 또는 검증된 공개 읽기 정책이 필요하며 비밀 credential은 브라우저·Git에 넣지 않는다. 현재 앱이 실제 원격 API에 연결됐다고 주장하지 않는다.

schema migration에는 데이터가 없고 5개 테이블과 인덱스만 있다. D1 환경에서 초기 schema를 적용한 후 별도 데이터를 수입한다. 로컬 수입은 각 chunk를 transaction으로 적용하고 replay·개정·고아 참조·무결성을 검사한다. **첫 수입 marker가 마지막이라는 사실은 live DB 갱신의 원자성을 보장하지 않는다.** 운영 중 증분 수입 전에는 별도 staging/활성 포인터·유지보수 절차·백업·복구를 구현하고 검증해야 한다.

## 검증·다음 순서

공식 Sites Vinext starter를 초기화하고 제공된 설치·빌드 helper를 사용했다. Node 실제 실행 24.22.1, root/CI 기준은 24.19.0이며 API packageManager는 별도 `pnpm@11.25.0`이다. 새 프로젝트의 server Worker와 D1 manifest·Drizzle SQL/메타·locked dependencies·API contract·클라이언트·수입 도구·테스트·export 도구가 소스에 포함된다.

실행 결과의 정확한 수치·소스/수입 묶음 해시·로컬 API 대조는 [api-server-preparation.json](../data/research/api-server-preparation.json)에 기록한다. GitHub 원격 CI는 push 뒤 별도 관측하며 로컬 통과와 구분한다. hosted API·계정 한도/비용·원격 데이터/이미지 권리·백업 운영은 후속 검증이다.

다음 배포 작업은 **새 API Site 등록 → 실제 ID 저장 → source helper로 독립 소스 전달 → 동일 commit의 build/package·private 배포 → schema 확인·staging 데이터 수입 → 읽기/접근/복구 검증 → 앱 연동** 순서다. API 수입·조회 준비는 T010/T011의 일부 입력을 마련한 것이며 공식 현행 한 팩의 전체 검증 완료와 구분한다. 자세한 명령·API·접근 정책은 [API README](../services/catalog-api/README.md)를 따른다.

## 이번 검증 결과

- 기존 224개 + API/수입/클라이언트 21개, 총 **245/245 테스트 통과**.
- TypeScript 검사·공식 Sites Worker build/preparer 통과. 기존 앱 build·Pages 호환 7파일 비교 통과.
- 실제 전체 입력을 staging으로 수입해 엔티티/개정 각각 49,105개, 팩 관계 90개, quarantine 2개를 확인. 같은 SQL 재실행 후 변화 없음, 고아 참조 0개.
- 실제 staging DB로 health/manifest/카드 목록·상세/팩 상세·구성 6경로를 읽고 보정 8/11·11개 구성 ID를 검증.
- 관리 파일 212개·24작업·변경 경로 141개 검사와 상대 링크 179개 통과.
- GitHub API branch 정상 push 뒤 원격 SHA·CI를 확인한다. 실제 Sites 배포·D1 원격 수입·앱 원격 인증 연결은 이번 결과에 포함하지 않는다.
