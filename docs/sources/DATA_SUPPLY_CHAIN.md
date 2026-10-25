# 선수 DB 공급망·공개 경로·갱신 운영 조사

관측일은 2026-10-25다. 기존 R1/T002·R4/T005의 출처/API 검증과 R2/R5의 구조·확장 선택을 C025/C027로 보강한다. [구조화한 근거](../../data/research/data-supply-chain-observations.json)는 운영자 설명·공개 코드·실제 HTTP·로컬 응답 전수 검사·독립 조사 공유를 구분한다. 사이트 자체 API를 KONAMI 원본 API로 부르지 않는다.

## 확인된 확보 경로

**PesLig의 정상 공개 프런트엔드가 사용하는 brief JSON을 1회 GET200으로 받아 로컬 연구 자료로 보존했다.** URL은 `https://peslig.com.tr/pesdb.php?api=brief&v=1792698603-30310520`이다. 09:07:42–09:08:26 UTC에 13,639,365바이트, SHA256 `add1257a3a8a1dc12ed27f176bc838c666d9a117a76da0e2a28ed645a518efb7`를 확인했다. 원문은 비추적 `artifacts/supply-chain/peslig-brief-response.bin`에만 보존하며 Git·빌드·공개 데이터에 넣지 않는다.

응답은 `meta`와 `players` 객체다. `players`의 문자열 키가 카드 ID이고 각 값은 `meta.fields` 순서의48열 배열이다. `source=dt870_console_win.cpk`, `schema=pml-efootball-all-cards-v15.1-current-cpk`, `generated_at=2026-10-22T14:30:18.575785+00:00`는 **공급자의 선언**이다. 원본 게임 파일을 확보·추출하거나 그 디코더를 검증한 결과가 아니다.

응답 내부 행·ID·필드 검사는 조사 기록의 `peslig_row_audit`를 따른다. 출처 보고 분류는 Standard19,018·variant13,947·그 외13,777이다. 그 외에는 Archived Base9,816·Unavailable Base3,851·Event/Special Character99·Internal/Fake Player11이 있으므로 non-Standard 전체를 특수 카드로 취급하지 않는다. variant 분류는 Legendary255·Trending3,626·Other Special478·Epic909·Big Time183·Highlight7,758·Show Time738이다. 이 구분은 공급자 분류이며 공식 taxonomy·복수 분류·전체 게임 역사 완전성의 입증과 별개다.

현재 EFHub83개 원본 카드 ID는 모두 이 응답에 있지만 OVR은14개가 다르다. 값이 같은 ID만으로 판본·능력 조건·분류·실인물 관계를 동일시하거나 기존 값을 덮어쓰지 않는다. 능력치 원본/디코딩값, 공급자 계산값, 외부 보강값을 나눠 검증해야 한다. 상품별 Standard 포함 관계는 이48열에 없다.

실측 행·고유 문자열 키·고유 행 ID는 각각46,742개이며 중복 JSON object key·행 ID 중복·키/ID 불일치는0개다. 모든 행이48열이고 이름·OVR·card_type·is_variant·26개 능력치는 모두 있다. 현재 최대 ID는387113187158919로2^53 안전 범위 안이지만, 이후 수집에서도 원본 키 문자열을 기준으로 보존한다. 이 검사는 받은 snapshot의 정합성이며 게임 전체 카드의 완전성이나46,742명의 고유 실인물을 입증하지 않는다.

스킬·AI 스타일은 전46,742행이 빈 문자열이다. 최대 레벨0인43,116행은 `server_level_cap_required`이고 나머지3,626행은 `fixed_max`다. 0을 성장 불가·최대 레벨0으로 바꾸지 않는다. 이미지 URL·명시적 다른 버전/실인물 연결·상품 관계·OVR 적용 조건은 없다. 같은83ID의 공급자 분류도 Show Time16·Highlight13·Epic4·Other Special21·Trending29로 EFHub와 다르므로 Other Special을 임의로 Highlight/Trending으로 치환하지 않는다.

## 사이트별 공급망

| 사이트 | 원본 근거 | 정규화·저장·사이트 제공 | 업데이트 근거와 미확인 |
| --- | --- | --- | --- |
| PesLig | brief meta가 `dt870_console_win.cpk` 명시 | 48열 압축 행·카드 ID 키·분류·능력값을 사이트 JSON으로 제공. 내부 저장 엔진/변환기 소스는 미확인. 이미지 별도 PHP 경로 | UI의 Decoder V20.4.1·PlayerWeekly A–E·Standard 추가/삭제 diff, meta 생성 시각은 확인 단서. decoder 버전과 JSON schema 버전은 별개. 배치 일정·완전한 행 delta·실제 자동 실패 복구는 미검증 |
| EFHub | 팬 사이트/비KONAMI 소속 고지. 공개 분석 기사의 패키지/ARM64 언급은 카드 DB 전체 추출 경로의 증거가 아님 | 같은 origin players/packs API·상세 HTML/Flight→React 상태·지역화 이름·imageUrl 렌더링 확인. 게임 원본 취득·내부 정규화 규칙/DB는 미확인 | 새 카드 페이지의 릴리스별 반영 소개는 사이트 설명. query 변경 fetch는 화면 조회이며 정기 수집 아님. 캐시4시간·JS Last-Modified도 DB 갱신 주기가 아님 |
| PESDB | [약관 §4](https://pesdb.net/terms/)가 게임 데이터에서 추출/파생한다고 명시 | 게임 파일명·추출기·저장 엔진·공개 수집 API는 미확인. 사용자 빌드의 브라우저 저장은 서버 카드 DB와 별개 | 버전·업데이트 페이지의 신규/수정/이적 집계는 공개 기록. 실제 추출 자동화·완전한 증분 feed는 미확인. **§3의 자동 수집/DB 재구축 금지 및 bulk export/feed 미제공으로 자동 수집 후보에서 제외** |
| PES Master | [DB 소개](https://www.pesmaster.com/efootball-2022/)가 게임 Live Update 반영을 명시. 특정 원본 파일/추출기·공식 원본 API 미공개 | 날짜별 Featured·문자열 카드 ID·이미지는 관측. 이번 직접 HTML GET은403이라 연결 검색 JS/새 API는 확인하지 못함 | 목요일마다 주간 Live Update를 반영한다는 운영자 설명. 정확한 실행 트리거·수집 프로그램·delta API·DB 스택은 미확인 |
| eFootballDB.com | [About Us](https://efootballdb.com/)가 official data와 주간 갱신을 설명하나 취득 경로는 명시하지 않음 | 공개 사이트·카드 검색 제공. 특정 KONAMI API/파일·정규화/저장 구현은 미확인 | 주간 갱신은 사이트 주장. 오래된2022/2023 소개·규모를 현행2027 완전성 근거로 쓰지 않음. `.info`와 운영/공급망 동일성 미확인 |
| eFootballDB.info | 원본·선행 공급자 미확인. 공식 뉴스 링크는 카드 데이터의 공식 원본 증거가 아님 | 보존된 공개 JS가 카드 상세 schema_version2·identity.id와 optional include를 검사. 내부 저장 엔진·원본 변환은 미확인 | 주간 갱신 소개와 표시 날짜만 확인. 라이선스 본문은 이번403. 자동/증분 운영·삭제/복구·허용 재사용 범위 미확인 |
| eFootballLAB | [Privacy의 Data Sources](https://efootballlab.com/privacy)가 일부 선수/통계를 efootballhub.net·efootballdb.com에서 가져온다고 명시. 푸터는 EFHub 카드 자료도 크레딧 | 커뮤니티 DB 재가공의 공개 근거. 별도 slug ID·카드 화면은 관측했지만 수집/저장·공개 bulk API 미확인 | Privacy 개정일은 DB 갱신일이 아님. 이번 직접 문서 GET은403·`error code:1010`; 그 전에 읽은 웹 도구의 공개 문서와 구분 |
| PlayersDB | 공개 검색 색인의 자체 소개는 시리즈 전반 커뮤니티·제3자 자료/기여·외부 ID 교차 참조를 설명 | CSV/JSONL 제공 설명은 있으나 실제 파일·스키마·다운로드 URL/라이선스·REST 계약 미검증. 이번 홈/about403, 파일 다운로드 없음 | 2026.10.22 및10/8·15·22 릴리스는 색인에서 읽은 공개 주장. 자동/수동 실행·증분 제공·현재 행 수 검증은 미실행. 104,505 고유 선수 주장을 현행 카드 수로 쓰지 않음 |

PESDB 약관은 공개 인터페이스의 제한된 개인 참고와 링크 공유를 별도로 허용한다. 이를 자동 카탈로그 복제 허가로 확대하지 않는다. 다른 사이트도 공개 조회 성공과 데이터/이미지의 재사용·재배포 허용을 구분한다. 이번에는 가입·연락·유료 계약·운영 배포를 수행하지 않았다.

## API/JSON 경로와 실제 검증 범위

| 정확한 경로·메서드 | 용도·쿼리 | 검증 상태 |
| --- | --- | --- |
| `GET https://peslig.com.tr/pesdb.php?api=brief&v=1792698603-30310520` | 전체 brief 카드 snapshot; `v`는 관측된 프런트엔드 버전 문자열 | 이번1회200·원문 로컬 보존·오프라인 행 검사. 페이지/cursor를 따라 전 게임을 수집한 결과는 아님 |
| `GET https://peslig.com.tr/pesdb.php?api=index&v=1792698603-30310520` | 공개 HTML의 FULL_INDEX_URL | 실제 클라이언트 경로 발견만. 미호출·응답/필드/규모 미검증 |
| `GET https://peslig.com.tr/efootball/card-image.php?id=106800804418912` | HTML에 실제 나온 카드 이미지 ID | 독립 표본1개200·image/png·PNG signature·159,422바이트. 전체 이미지 성공/재배포 허용 아님. 응답48열에는 이미지 URL 없음 |
| `GET https://efhub.com/api/public/players` 및 `?page=2` | 카드 목록·검색/필터·페이지, JSON players/total/page/limit/totalPages | 과거200·2쪽24행 표본. 이번 정상 HTML/연결JS4GET200으로 경로 재확인, API 재호출0. limit100 기본 UI 미사용·서버 지원 미확인 |
| `GET https://efhub.com/api/public/packs?search=&page=1&limit=30` | 소개 상품 검색/페이지; search/page/limit | 과거 목록/상세 수집 근거. 게임 전체 풀·판매 중·지급 방식을 보증하지 않음. 이번 API 호출0 |
| `GET https://api.efootballdb.info/api/v2/players/88046292727298` | 공개 JS의 카드 ID 상세; optional `include`는 코드에서 발견 | 과거 이 정확한 요청404. 이번 재시도0. 상세 API를 상품 구성 API나 KONAMI API로 부르지 않음 |

EFHub에서 코드상 발견한 `search`, `position`, `playerType` 등의 쿼리 문자열은 서버의 모든 허용 값·응답 계약을 검증한 것이 아니다. EFHub 원본 목록403은 실패 본문/헤더 부재로 원인 미확정 상태를 유지한다. 이번 다른 문서의403/1010을 그 과거 요청의 원인으로 소급하지 않는다.

## 게임 파일·도구 문서에서 확인한 범위

공개 [Mod Studio 포맷 설명](https://github.com/Master-Antonio/Efootball-Mod-Studio/blob/main/docs/PESDB_DATABASE_FORMAT.md)은 Player·Team·Assignment 테이블, 64비트 PID, 빌드별 레이아웃·해시/manifest를 설명한다. Assignment는 팀 소속 관계이며 상품의 초기 전체 추첨풀과 다르다. [Player.bin 연구](https://jiahao.uk/en/blog/efootball-player-bin-study-guide/)는 PlayerVariationDetail과 특수 카드→pack label 단서를 설명하지만 오프라인 자료에 Dream Team 특수 카드 일부만 있다고 명시한다. label이 있어도 해당 상품의 모든 Standard가 포함됐다는 증거는 아니다.

공개 Master League 도구의 dt200→SQLite/JSON·별도 얼굴/문장 자산·업데이트 후 rebase, PESDatabase/PESBuilder의 주간 서버 DB 설명도 조사했다. 이들은 각각 도구 문서의 기능/운영 주장이고 EFHub·PesLig가 이 도구를 쓴다는 연결은 미확인이다. PESPLATFORM은 현재404라 과거 검색 색인의 CPK/CSV 설명을 현행 실행 가능 경로로 채택하지 않는다. 모든 문서 조사는 읽기만 했고 보호된 게임 데이터 다운로드·도구 설치/실행·복호화는0회다.

## 실제 확보에 가장 가까운 순서

1. **현재 T005/R1:** PesLig brief의 고정 snapshot·원문 해시·실제 ID/필드 검사를 기준으로 이용조건과 운영자 자료를 확인한다. 현재 공개 재사용 라이선스는 미확인이다. PESDB는 자동 수집 경로에서 제외한다. 새 provider/토큰/계정/자동 수집 작업을 만들지 않았다.
2. **R2/R5로 연결:** 사이트 키 ID를 원본 문자열로 보존하고 provider schema/생성 시각·분류 원문·능력 산출 조건·미확인을 저장하는 정규화를 계획한다. 현재83ID의 OVR14건 차이와 type 차이를 검토한 뒤 필드별 근거를 분리한다. `max_level=0`·빈 스킬 등을 확정값으로 정규화하지 않는다.
3. **카드와 상품 관계 별도 검증:** brief가 제공하는 것은 전역 카드다. 기존 EFHub 상품 소개 관계는 그 범위대로 유지하고, 공식 회차·기간·지역·초기 수와 특수 카드 부분의 완전성을 따로 확인한다. 전역 Standard19,018에서 임의로 상품 구성원을 고르지 않는다.
4. **갱신 검증:** 제공자의 생성 시각/schema/종류별 수와 ID집합/필드 해시를 관측별 비교하는 방식을 설계한다. 최초 snapshot 보존→검증→정규화→기존 정상 자료 유지 후 게시, 실패/급감 보류를 유지한다. 완전한 snapshot은 delta feed와 다르다. 실제 새 주차 반영·삭제 정책·실패 복구를 확인하기 전 R6 완료가 아니다.

## 익명 Standard 슬롯 제안 — 보류·미구현

C026은 **Standard를 필요한 범위에서 확보하지 못할 경우에 한한 조건부 대안**이다. 전역 Standard 카드 조회가 가능하다는 이번 발견과 상품별 Standard 포함 관계의 미확보를 구분한다. 특수 카드 DB만으로 진행할지는 아직 결정하지 않았고 가상 선수·ID·슬롯·연출을 만들지 않았다.

향후 채택 판단에는 다음 조건이 필요하다.

- 게임 내 상품 유형/회차·지역·기간·공식 초기 인원수 N이 같은 상품에 대응해야 한다. 이름이나 `/packs` 경로만으로 판단하지 않으며 미래 대상은 기존 방침의 코인 기반 특수 명단이다. 일괄 지급 팩은 계속 제외한다.
- 특수 카드 수 S는 해당 회차의 **모든 비Standard 구성 종류와 출시 카드 ID/수량을 확보했다는 근거**가 있어야 한다. 예컨대 Epic3만 확보하고 Highlight8이 빠졌으면 N−S를 Standard로 채울 수 없다. unknown type·누락된 특수 카드·기간/버전 불일치는 보류한다.
- 공식 자료가 나머지를 Standard로 볼 수 있는 구성 근거를 제공해야 한다. N−S는 음수가 아니어야 하며 초기/잔여·중복/수량을 구분한다. 계정에서 이미 영입한 잔여 명단으로 초기 N을 계산하지 않는다.
- 가상 슬롯은 실제 카드/선수·원본 ID·확보 수·실측 Standard 명단과 분리한다. 일반 Standard 실제 카드를 임의로 넣지 않고 가정/합성 수량임을 명시하는 별도 표현을 계획한다. 미확인을 실제0명이나 확인된 Standard 수로 바꾸지 않는다.

사용자는 이 대안을 나중에 채택한다면 이름 없는 “스탠다드 선수”에도 개봉 모션을 원한다고 밝혔다. 이는 미래 의도 기록이며 지금 시뮬레이터 설계·모션 구현을 시작하는 승인이 아니다. 우선 공개 카탈로그 경로와 상품 구성의 검증 범위를 확정한다.
