# 선수·선수팩 자동 갱신 운영 절차

T036/T041/T042의 공통 실행 계약이다. T041은 원본 타입의 가공/API 전달과 역할별 사이트 접근 정책을 추가한다. 예약은 이 문서와 현재 상태 파일을 읽는다. 상품명·수량·일회성 승인·장애 경과는 예약 문구에 복사하지 않는다. 매시간 점검이며 원출처 변경을 즉시 전달하는 webhook은 아니다.


T042 고정 가격: 신규 가공은 사용자 확정 정책에 따라 `drawOptions.single.coinCost=100`, `drawOptions.ten.coinCost=900`, 사용자 확인 provenance referenceT042를 전달한다. 전체11명 단일 전용·11명초과 단일/10회·minimumRemaining10은 유지한다. API 목록/상세·live/archive·소비 사이트의 가격/지원 값을 전량 대조한다. 정기 실행이 할인·팩별 가격을 추정하거나 확인된 가격을 null로 바꾸지 않는다. 과거 T040 null가격은 불변 세대 읽기 호환성을 위한 값이며 현행 새 가공의 가격이 아니다. 규칙 검토/채택·현재 세대 migration은 별도 승인 개발 작업이고 시간별 실행에서 자동 수행하지 않는다.

## 변경 감지와 안전한 수집

1. 작은 모니터 파일의 최신 버전, 정상 HTML 기준, transportState, nextEndsAt, 미완료 후속 단계를 먼저 읽는다. 영속 자료를 못 읽으면 성공/무변경으로 추정하지 않는다.
2. EFHub new-players와 공식 KR 확률표의 일반 HTML을 최소 요청으로 비교한다. 의미 없는 동적 값은 고정 파서 결과로 제외한다. 정상 자료 비교와 이미 확인한 종료 UTC를 별개로 판단한다. 추가 요청은 필요한 선수/팩 상세 HTML만 허용한다. 원본 API·challenge 우회는 사용하지 않는다.
3. EFHub origin의 nextRequestAt 이전에는 어떤 경로·도구로도 요청하지 않는다. 실제 403/429/challenge 시 같은 실행의 요청을 중단하고 실제 연속 차단에 따라 2/4/8시간 대기한다. 유효 Retry-After는 최소 대기로 적용한다. 정상 전체 HTML만 대기를 해제한다. 오류/점검/부분 응답을 정상 해시나 상품 삭제 근거로 저장하지 않는다.
4. 양쪽 정상 HTML의 의미 있는 변경도, 새 종료 전이도, 미완료 후속 단계도 없으면 즉시 무쓰기·무커밋·무응답 종료한다. 대기/동일 장애만으로 대용량 묶음을 다시 풀거나 저장하지 않는다. 미완료 API/사이트/GitHub 단계는 이 조기 종료보다 먼저 확인하되 그 단계만 재시도한다.

## 고정 데이터 처리

최신 GitHub api-server-setup과 데이터 묶음의 RULES/CURRENT·검토 매핑 해시를 검사한 뒤 `services/catalog-api/scripts/lifecycle/run-cycle.mjs`만 실행한다. 보존 HTML/오류 receipt의 재실행 결과를 사용한다. AI가 DB JSON·verified 후보·가짜 HTTP receipt를 작성하지 않는다.

순서는 신규 raw append → 선수/팩 raw 로그 → 공식 상품 한정 가공 선수9필드(원본 `playerType` 포함)와 팩 전체 연결 → 종료 live 전체를 archive로 이동 → 현재 유효 자료 전체 중첩 → 실제 targetFile별 api_updates 로그다. 무삭제·문자열 카드 ID·N/S/A·정확한 회차·원본 보존·검증된 보정·멱등성·불변 세대와 CURRENT 전환을 유지한다. 종료 시각은 출처 장애 중에도 적용한다.

**현행 자동 처리 범위:** 검토 레지스트리에 등록된 매핑의 정상 추가와 확인된 판매 종료다. 미등록 신규 상품/같은 제목의 새 회차, 특수 ID 누락·인원 불일치, 기존 raw 값 변경은 pending/충돌로 근거를 보존한다. 전체 EFHub 신규 raw 전수 누적이나 기존 raw 개정 자동화를 완료했다고 주장하지 않는다. 이 경우 관련 HTML 근거 수집·완전성 점검까지 하고 필요한 근거/수정 개발을 한 번 보고한다. 완료된 승인과 카드 ID 검증/DB 반영을 구분하며 같은 질문을 반복하지 않는다. 규칙/파서/매핑/타입사전을 정기 실행 중 임의 수정하지 않는다. 신규 가공은 정확한 카드 ID의 raw `playerType`을 양의 안전 정수로 검사하고 가공 선수·목록/상세 API·live/archive 중첩에 그대로 전달한다. 타입 누락/잘못된 입력은 반영을 보류한다. 알려진5(Epic)·8(Show Time)·3(Trend)·6(Highlight)는 공통 소비 코드로 분류하고, 나머지 유효 코드는 원본 그대로 미분류로 보존한다. 예약을 실행하는 에이전트는 새 코드를 실제 발견하면 중복 억제해 한 번 보고한다. 이는 운영 지침이며 알 수 없는 양의 코드만을 위한 cycle 전용 경고/pending 생성기를 구현했다는 뜻이 아니다. 팩 이름·OVR·고정70명 레지스트리로 카드 타입을 추정하지 않는다. 타입 전달/원본 코드 일치 검사도 전량 readback의 일부다.

## 저장 → 발행 → 소비 사이트 확인

1. 최신 세대·raw/logs/불변 publication을 보존한 깨끗한 source를 기존 검증 압축 도구로 묶는다. SOURCE 밖에 생성하고 최종 exit 0과 gzipComplete/tarComplete/membersMatchSource를 확인한다. 같은 Library ID에 expected_current_version을 지정해 저장하고 정확한 새 버전의 SHA/압축 무결성을 확인한다. 압축본 저장 실패 전에 정상 기준 해시를 앞당기지 않는다.
2. 실제 변경을 확인하면 첫 저장 전에 작은 모니터에 preparing 의도를 기록한다. 데이터 묶음 저장 후 checkpoint 기록 사이에 중단돼도 다음 실행이 같은 Library ID의 실제 최신 버전·CURRENT를 대조해 이어가도록 기준 bundleVersion/runtime과 목표 세대/receipt를 보존한다. 후속 작업이 중간에 끊겨도 재개되도록 작은 모니터의 `hosting.pipeline`에 runtimeVersion/publicationVersion/bundleVersion과 단계별 상태(bundle/api/sites/github), receipt hash, lastErrorCode를 버전 보호로 먼저 기록한다. GitHub 미완료 시 엄격한 요약 영수증 전체와 SHA도 pipeline.github.record에 보존해 실행 환경이 바뀌어도 동일 기록을 재사용한다. credential·HTML 원문·개별 선수 데이터는 넣지 않는다. `pendingPublication`의 기존 미완료 상태도 계속 읽는다. 단계 완료 뒤 상태를 갱신하고 마지막 정상 기준과 transport*를 보존한다. 미완료 단계가 있으면 전체 완료가 아니다.
3. 각 Site의 최신 get_site로 사용자 소유와 역할별 기대 접근 정책을 확인한다. 기존 ID·origin·`expectedAccessMode`는 `config/catalog-automation.json`을 따른다. API와 검토 viewer는 owner-private(소유자만 허용, 다른 편집자/그룹/외부 방문자 없음), 실제 앱은 사용자가 공개를 승인한 public이다. API/admin을 앱과 함께 공개하지 않는다. 현재 지원되는 서비스 접근을 필요한 Site별로 각 실행마다 얻고 메모리/숨긴 stdin으로만 전달한다. 실제 앱의 익명 읽기 검증에는 인증 헤더를 보내지 않는다. 기대 audience와 다르면 발행/사이트 검증을 보류하고 접근 설정·토큰을 자동 생성/회전/변경하지 않는다.
4. `publish-remote.mjs --root ABSOLUTE_CATALOG_RUNTIME`에 stdin으로 원격 연결 정보를 전달한다. 분할 적재 → 전량 readback/해시 검증 → expected-current CAS 활성화 → health/manifest/선수·팩 전량 재조회를 통과해야 api=verified다. 같은 publication이면 재적재하지 않는다. 충돌/오류 시 정상 활성본을 보존한다.
5. `verify-sites.mjs`로 API·검토 viewer·실제 eFsimulator의 health/manifest와 players/packs/live/archive를 페이지 끝까지 읽어 같은 버전·전체 내용·참조/분할/인원·카드 타입을 대조한다. 비공개 API/viewer는 각각의 서비스 접근으로 읽고 공개 실제 앱은 익명 GET으로 같은 데이터를 제공하는지 확인한다. 부분 응답·로그인 HTML·다른 버전이면 sites를 pending/failed로 남긴다. API만 성공했다고 실제 사이트 반영 완료로 보고하지 않는다. 데이터 변경에는 소스 재배포가 필요 없다.
6. 열린 두 화면은 보이는 탭에서 60초마다 manifest를 비교하고 탭 복귀/온라인 복구 때 확인한다. 버전 변경 때만 목록 전체를 검증해 한 번에 교체한다. 실패하면 마지막 정상 화면을 유지한다. 숨긴 탭·오프라인·브라우저 지연 때문에 정확히 60초 내 반영을 보장하지 않는다.

## GitHub 갱신 기록과 재개

실제 데이터 변경에는 GitHub 반영이 완료 조건이다. raw·가공 전체 DB·HTML·상세 로그·비밀값은 계속 비공개 묶음에 보관하고, GitHub에는 `data/updates/catalog-latest.json`의 엄격한 요약 영수증만 갱신한다. 전체 로그는 묶음의 raw/API 로그, 작업별 요약 이력은 이 고정 파일의 Git 이력이 담당한다. 고정 경로이므로 매시간 새 파일/FILE_SYNC 항목을 만들지 않는다.

- `scripts/catalog-update-record.mjs`로 버전/해시·전후 변경 수·targetFiles·단계 결과만 허용한다. 입력 임의 필드·토큰·원문은 거부한다. 같은 runtime/publication/단계 결과는 같은 영수증을 재사용하고 의미 없는 시각 변경 커밋은 만들지 않는다.
- 소스 기준 브랜치의 최신 ref와 기존 영수증을 읽고 같은 작업 브랜치에 이 고정 파일만 정상 commit/push한다. 로컬 미커밋 사용자 변경을 자동 stage하지 않는다. Git 데이터 API를 쓸 때도 최신 head를 부모로 하여 expected_sha를 적용하고 force=false로 전진한다. 충돌하면 최신 head를 다시 읽고 자기 영수증만 재적용한다. main/work·관리문서·FILE_SYNC·규칙 파일은 정기 실행에서 수정하지 않는다.
- 업로드 뒤 원격 ref·영수증 전체 내용과 해당 SHA의 실제 CI 상태를 확인한다. 영수증의 github=pending은 자기 자신을 포함할 미래 SHA/CI를 꾸미지 않기 위한 값이다. 완료 SHA·CI run ID/상태는 모니터의 pipeline.github에 기록한다. 같은 영수증을 찾으면 새 커밋 없이 그 SHA와 CI만 확인한다.
- GitHub 장애가 나도 검증된 API를 옛 버전으로 되돌리지 않는다. github=pending을 보존하고 다음 실행에서 소스 수집/DB 발행/재압축 없이 해당 기록만 재시도한다. sites 검증 실패도 동일하다. 실패 단계/범위와 현재 정상 자료를 구분한다.
- 전송 대기 상태만 바뀌거나 무변경 점검일 때는 Git 커밋을 만들지 않는다. 새로운 사용자 조치 필요/실제 데이터 변경/새 미해결 항목만 한 번 알린다. 대기·동일 오류·동일 pending 알림은 반복하지 않는다.

## 별도 개발 작업의 완료 조건

수집 형식·계약·기존 raw 수정·신규 매핑 검토/정책·표시용 타입 메타데이터·서버 코드 변경은 별도 개발 작업이다. 필요한 증거 → 영향 파일/FILE_SYNC 역할·우선순위·연관·검토 기록 → 회귀/규칙 버전·검토 잠금 → 필요 시 expected CURRENT 채택 → 같은 브랜치 정상 commit/push·원격·CI 확인을 수행한다. 실제 변경된 Site 소스만 Sites 절차로 배포하고 데이터와 소스 버전을 구분한다. 단순 데이터 갱신을 코드 재배포·임의 self-heal로 처리하지 않는다.
