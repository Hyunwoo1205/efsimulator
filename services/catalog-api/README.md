# efsimulator Catalog API

T024 최신 계약: raw는 누적 입력 원본이고 HTTP 조회 대상이 아니다. 가공 DB는 공식 KR와 EFHub에서 동일 상품·회차가 확인된 팩과 선수만 누적한다. [데이터 계약](../../docs/CATALOG_DATA_CONTRACT.md)을 우선하며 아래 기존 ingest는 역사/검증용 staging으로 남긴다.

기존 앱과 **별도의 Sites 프로젝트**에 배포할 누적 데이터 API다. GitHub `efsimulator` 저장소의 `services/catalog-api/`가 독립 소스 루트이고 `api-server-setup` 브랜치에서 준비한다. 기존 `work` 앱 소스와 Pages 파일은 유지한다. 현재는 **소스 업로드·DB 수입 준비 단계**이며 Site 등록/원격 배포/원격 DB 수입은 실행하지 않았다.

## 소스 구성

| 경로 | 용도 |
| --- | --- |
| `app/api/v1/[[...path]]/route.ts`, `lib/catalog-api.mjs` | Vinext 요청 어댑터와 D1 읽기 API |
| `db/schema.ts`, `drizzle/` | 스키마와 생성 migration SQL/Drizzle 메타. 실제 데이터 미포함 |
| `scripts/ingest/` | 입력 검증·정규화·데이터 SQL 생성·로컬 수입/재실행 검증 |
| `client/catalog-api-client.mjs` | 앱에서 가져다 쓸 GET 클라이언트 |
| `.openai/hosting.json` | Worker + D1 logical binding `DB`. 등록 전이므로 project_id 없음 |
| `scripts/export-source.mjs` | monorepo 하위 폴더를 별도 Sites 소스 루트로 내보냄 |
| `scripts/vite/`, `worker/`, 그 외 framework scripts | Sites 공식 Vinext 통합. 보존 필요 |
| `pnpm-lock.yaml` | API 프로젝트 자체 의존 잠금. 루트 앱의 npm과 분리 |

## 로컬 검사·빌드

Node 24.19.0을 기준으로 한다. 이번 실행 환경은 Node 24.22.1이며 실제 차이는 상위 준비 확인서에 기록한다. packageManager는 `pnpm@11.25.0`이다.

```sh
cd services/catalog-api
pnpm install --frozen-lockfile
node --test tests/*.test.mjs
pnpm run build
```

ChatGPT Work에서는 현재 Sites 스킬의 install/build helper를 사용한다. 공식 initializer에서 유지한 `sites()` 빌드 통합을 제거하지 않는다. root package/lock과 섞어 설치하지 않는다. `dist/`와 node_modules는 Git에 넣지 않는다.

## 읽기 API 계약

| GET/HEAD | 내용 |
| --- | --- |
| `/api/v1/health`, `/manifest` | 가공 버전 발행 준비·발행 당시 수. 전체 공식 상품 완성/추첨 준비를 뜻하지 않음 |
| `/api/v1/cards`, `/players` | 가공 누적 선수 목록. `q`, `limit=1..100`, `cursor` |
| `/api/v1/cards/{id}`, `/players/{id}` | 정확히 지정된 8개 필드. 문자열 ID 유지 |
| `/api/v1/packs` | 공식 게재 이력으로 채택한 누적 가공 팩 |
| `/api/v1/packs/{saleId}` | 정확한 회차. slug 별칭은 회차가 유일할 때만 지원 |
| `/api/v1/packs/{saleId}/cards` | 팩에 연결된 선수 8개 필드 |
| `/api/v1/live`, `/archive` | 팩 정보 전체와 `players` 상세 전체를 중첩 |

응답은 `{data,meta,pagination?}`, 오류는 `{error:{code,message}}`다. GET은 발행 포인터를 한 번 읽고 해당 불변 버전만 조회한다. raw/기존 전체 카탈로그 테이블로 fallback하지 않는다. 미발행 목록 503, 없는 항목 404, 잘못된 입력 400, 변경 요청 405다. 만료 시점 사이의 정확성을 위해 live는 요청 UTC에서 종료된 팩을 제외하고 archive 뷰는 그 전체 내용을 포함한다. 파일 이동/로그는 다음 갱신에서 확정하며 GET은 쓰기를 하지 않는다. `manifest.counts`는 발행 당시 수다.

## HTML 수집·가공·파일 갱신

```sh
node scripts/lifecycle/workspace.mjs init --root /absolute/private-data --players /absolute/players_raw.json --packs /absolute/packs_raw.json --player-update /absolute/players_update_20261026.json
node scripts/lifecycle/run-cycle.mjs --root /absolute/private-data --mappings /absolute/catalog-sale-mappings.json --db /absolute/local-processed.sqlite
```

`run-cycle`은 공식 표와 new-players HTML을 한 번씩 확인하고 필요한 신규 상세 HTML과 목록에서 사라진 검토 과거 팩의 상세 HTML만 수집한다. 원본 API는 사용하지 않는다. 명시적 회차 매핑과 전체 특수 명단을 확인해야 raw→가공 순서로 추가하며, 불확실한 신규 상품은 pending이다. 접근 거부 시 해당 실행의 EFHub 수집은 멈춘다. 실제 HTML 레이아웃이 바뀌면 기존 정상 자료를 보존한다.

논리 파일은 raw 2개, raw 로그 2개, processed 2개, live/archive, API 로그다. 모든 파일을 해시 검증한 불변 세대에 기록한 후 CURRENT 포인터를 교체한다. 시간별 점검의 외부 사전검사는 양쪽 정상 HTML 해시가 같고 종료가 도래하지 않으면 가공·checks·receipt·SQL·압축·저장·응답 없이 종료한다. run-cycle을 직접 실행해 재검증한 횟수는 checks.jsonl에 남는다. 서버 배포 데이터는 `publications/<version>/sql`과 activate.sql이며, 전량 적재 후 내용 해시·참조를 검증하고 활성 포인터를 단일 문장으로 전환한다. 명령의 `--db`는 로컬 SQLite 검증 옵션이며 원격 D1을 수정하지 않는다.

## 이전 전체 원본 staging 수입 도구

원본·JSONL·대량 SQL·SQLite는 **Git 소스와 공개 dist에 넣지 않는다.** root `artifacts/` 아래 별도 비공개 수입 묶음으로 생성한다. 첨부 원본 세 파일과 기존 팩 관계 파일의 정확한 경로를 인자로 넣는다.

```sh
node scripts/ingest/prepare-import.mjs --players /absolute/players_raw.json --packs /absolute/packs_raw.json --update /absolute/players_update_20261026.json --relations /absolute/current-catalog-observations.json --out /absolute/new-import-folder
node scripts/ingest/apply-local.mjs --bundle /absolute/new-import-folder --schema drizzle/0000_productive_khan.sql --db /absolute/new-staging.sqlite
```

산출물은 원본 byte 사본 `raw/`, normalized `records.jsonl`, 파일 해시·수입 수·chunk 순서를 담은 `manifest.json`, `sql/*.sql`이다. 원문 수집 시각이 없으면 null로 두며 `prepared_at`으로 대체하지 않는다. 출력 폴더는 새 경로여야 하고 입력을 덮어쓰지 않는다. 카드 문자열 ID·동명 다른 카드·기존 원본은 보존한다. 빈 팩 식별자와 dummy는 삭제 대신 quarantine에 보존한다.

이번 입력의 11카드 관계 보정은 원본 `source_reported_count=8`, 연결 `effective_member_count=11`, `correction_status=user_confirmed`를 함께 저장한다. 이를 공식 초기 총원 N 또는 검증된 전체 특수 수 S로 승격하지 않는다. 팩의 관계가 없으면 unknown이다. 원본 playerType은 코드로 보존하며 이름을 추정하지 않는다.

새 snapshot은 원문 해시로 식별하고 의미 있는 필드가 달라질 때 새 revision을 만든다. 같은 수입을 다시 실행해도 중복되지 않는다. 목록에서 빠진 엔티티·이전 개정·관계는 삭제하지 않는다. 새 입력의 null이 기존 확인값을 지우게 되면 기존 current revision을 유지하고 새 candidate revision을 보존한다. 이 후보의 병합/선택은 후속 검토 대상이다.

**초기/검증용 staging DB 전용 흐름**이다. 최초 수입 manifest는 마지막 chunk에 기록하지만 기존 live DB의 여러 chunk 갱신은 원자적 전환이 아니다. 실제 운영 중 업데이트 전에는 별도 staging/활성 포인터나 유지보수 절차를 구현·검증해야 한다. 앱 rollback이 DB migration/data를 자동 rollback하지 않는다.

## Sites 소스 업로드 준비

```sh
node scripts/export-source.mjs /absolute/empty-catalog-api-source
```

이 명령은 API 폴더만 내보낸다. 기존 Git metadata, 로컬 환경값, node_modules, dist, 준비 데이터, runtime state는 제외하고 파일별 해시를 기록한다. 결과는 **소스 업로드 묶음**이며 Sites에 바로 배포할 archive가 아니다. 기존 앱 저장소 루트 전체를 API 사이트에 보내지 않는다.

다음 배포 작업에서 이 source를 새 API Site의 준비 폴더로 사용하고, native `create_site`가 반환한 실제 project_id를 `.openai/hosting.json`에 저장한다. 이전에 제외한 초기 Site는 재사용하지 않는다. 공식 source helper로 Sites 저장소에 정확한 source commit을 전달하고, 해당 상태에서 build/package → version 저장 → private 배포를 진행한다. ID·URL·credential을 지어내거나 source에 token을 넣지 않는다. 상세 순서는 현재 Sites 스킬을 따른다.

D1 schema migration은 배포 시 적용되며 데이터 수입은 별도다. 원격 데이터 수입은 계정 한도·비용·권한·백업·staging 대상을 확인한 뒤 순서대로 수행하고 읽어 검증한다. 이번 묶음은 수만 개의 쓰기 작업이 있으므로 실제 서비스의 할당량에 맞게 나눠 실행한다. 원문 저장/이미지 재배포 조건도 별도 확인한다. T023 당시 R2 binding·새 계정·유료 서비스·자동화는 없었다. T024의 매시간 점검 예약은 별도 작업 기록을 따른다.

## 별도 앱과 연결

실제 배포 후 받은 API origin을 클라이언트의 baseUrl에 넣는다. 예시에서는 값이 이미 설정된 `catalogApiOrigin` 변수를 사용한다.

```js
import { createCatalogClient } from './catalog-api-client.mjs';
const api = createCatalogClient({ baseUrl: catalogApiOrigin });
const page = await api.cards({ limit: 30, q: 'Lewandowski' });
const pack = await api.pack('italian-league-selection-attackers-26-oct-26');
```

별도 앱 origin을 `CORS_ALLOWED_ORIGINS`에 정확히 등록한다. wildcard를 허용하지 않는다. CORS는 Sites의 private 접근 인증을 대체하지 않는다. private API와 앱을 연결할 때는 앱 서버에서 지원되는 Site service credential로 호출하고 그 credential을 브라우저·Git에 노출하지 않는다. 클라이언트의 기본 fetch는 credential을 보내지 않으므로 서버 호출 adapter 또는 검증된 공개 읽기 정책이 필요하다. 로그인 HTML이 돌아오면 API JSON으로 오인하지 않고 오류로 처리한다.

상위 프로젝트의 현재 작업·검증 결과는 [API_SERVER_PREPARATION](https://github.com/Hyunwoo1205/efsimulator/blob/api-server-setup/docs/API_SERVER_PREPARATION.md)을 따른다.


## 반복 실행 규칙 (T027)

`npm run data:rules-check`로 검토 규칙과 해시를 확인한 다음 `data:cycle`을 실행한다. 같은 기준 세대·저장 HTML·매핑·규칙·UTC에는 같은 가공 결과와 콘텐츠 버전이 나온다. 원본의 모든 필드와 가공 팩/로그도 공통 엄격 검증을 적용하며 불명확한 입력은 기존 정상 데이터를 유지한다.

정기 작업은 파서/스키마/코드/테스트/매핑/검토 레지스트리/규칙 잠금을 수정하지 않는다. 신규 상품은 등록된 정확한 회차·전체 ID 근거가 없으면 pending이다. 데이터는 AI가 직접 편집하지 않고 HTML receipt의 오프라인 재실행을 통과한 결과만 반영한다.

기존 묶음 최초 채택 또는 별도 승인된 규칙 변경 후에는 현재 CURRENT 해시를 읽고 다음 명령을 사용한다. 일반 실행은 자동 채택하거나 잠금을 다시 만들지 않는다.

```bash
npm run data:adopt-rules -- --root /absolute/catalog-runtime --expected-version CURRENT_SHA256 --review-id REVIEW_ID --reason REVIEW_REASON --now UTC_ISO
```

채택은 raw/가공/로그 바이트를 보존하고 검토 정책에 바인딩한 세대와 감사 기록을 만든다. 전체 계약과 예외 처리는 저장소 docs/CATALOG_DATA_CONTRACT.md를 따른다.


## 검토된 과거 명단의 즉시 반영

현재 가공 데이터는 7팩·70카드(live7/archive0)이며, T028에서 대기 세 상품의 26카드 연결을 완성했다. 사용자 확인은 상품과 팩의 대응에 한정하고, 전체 카드 링크는 보존된 검색 HTML 추출 응답을 코드로 재검증했다. 세 상품의 원출처를 신규 수집한 것으로 표시하지 않는다.

```sh
node scripts/lifecycle/run-cycle.mjs --root /absolute/private-data --mappings /absolute/catalog-sale-mappings.json --reviewed-cache /absolute/reviewed-evidence.json --db /absolute/local-processed.sqlite --now VERIFIED_UTC
```

검토 파일은 `cachedEvidence`(추출 응답 및 retrieval UTC)와 `officialSnapshot`(최근 정상 공식 HTML)만 제공한다. raw·매핑·승인·규칙은 작업 공간의 고정 정책에서 읽는다. 전체 근거 해시가 매핑 검토와 일치해야 하며 영수증을 재실행한 후보만 반영한다. 기존 raw에 없는 카드는 이 경로에서 거부한다. 일반 정기 갱신은 기존 HTML 경로를 사용하고, 상품별 상태는 monitor/매핑 파일로 관리한다.
