# efsimulator Catalog API

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
| `/api/v1/health` | DB 연결·수입 준비 상태·카드/팩 수 |
| `/api/v1/manifest` | 안전하게 공개할 수 있는 데이터 버전·준비 시각·수 |
| `/api/v1/cards` | 카드 목록. `q`, `limit=1..100`, `cursor` |
| `/api/v1/cards/{source_card_id}` | 문자열 원본 카드 ID의 상세 |
| `/api/v1/packs` | 팩 목록. `q`, `limit`, `cursor` |
| `/api/v1/packs/{slug}` | 팩 상세·원본 표시 인원·보정 인원·구성 확인 상태 |
| `/api/v1/packs/{slug}/cards` | 확보한 팩 연결 카드와 근거. `limit`, `cursor` |

응답은 `{data, meta, pagination?}`, 오류는 `{error:{code,message}}` 형식이다. 수입 전 목록은 503, 없는 개체는 404, 잘못된 입력은 400이다. POST/PUT/PATCH/DELETE는 405이며 HTTP 관리 쓰기 endpoint는 만들지 않았다. GET에서 원출처 수집·이미지 다운로드·DB 수정을 하지 않는다. 조회 데이터는 전체 누적층이고 현재 판매/공식 회차/전체 특수/추첨 준비를 뜻하지 않는다. 아직 공식 현행 스냅샷 경로는 없다.

`next_cursor`는 반환값 그대로 다음 요청에 사용한다. 페이지는 문자열 키 순서이며 정수 변환하지 않는다. 각 레코드의 `_meta`는 개체·개정·최초 근거 snapshot을 나타낸다. 최신 전체 상태는 여러 원문 시점의 누적값일 수 있으며 불변 과거 시점 API는 아직 없다.

## 데이터 수입 준비

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

D1 schema migration은 배포 시 적용되며 데이터 수입은 별도다. 원격 데이터 수입은 계정 한도·비용·권한·백업·staging 대상을 확인한 뒤 순서대로 수행하고 읽어 검증한다. 이번 묶음은 수만 개의 쓰기 작업이 있으므로 실제 서비스의 할당량에 맞게 나눠 실행한다. 원문 저장/이미지 재배포 조건도 별도 확인한다. 이번 준비 작업에서는 R2 binding·새 계정·유료 서비스·자동화가 없다.

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
