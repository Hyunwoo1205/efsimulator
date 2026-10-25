# EFHub 표본 수집

## 현재 범위

`scripts/collect-efhub.mjs`는 실제 EFHub 페이지가 사용하는 상품 목록 JSON과 목록이 반환한 상품의 한국어 상세 HTML을 순서대로 수집합니다. 기본 범위는 목록 1쪽·상품 최대 30개, 단일 동시성, 요청 사이 500ms입니다. 목록과 상세 요청을 합친 기본 예산은 최대 31회입니다. 자료를 import하는 것만으로 외부 요청이 실행되지 않습니다.

이 수집은 최신 출처 목록의 표본입니다. 판매 여부·게임의 전체 구성·전체 카드 수집·상품과 감독의 연결·가격과 제한의 확보를 뜻하지 않습니다. 선수 상세 API의 403을 우회하거나 미확인 API를 탐색하지 않습니다. 수집 주기는 아직 확정하지 않았으며 스케줄도 가동하지 않았습니다.

## 활성 정규화와 지원 범위

수집 원본은 addCollectedProducts를 거쳐 원본 ID와 관측별 근거로 병합합니다. 가격·능력 조건·버전·복수 분류처럼 이 요약 수집으로 다시 확인하지 않은 필드는 기존 근거와 함께 보존합니다. 상품별 감독을 일괄 반환하는 정상 API는 미확보이므로 모든 상품의 감독 정보와 독립 감독 목록은 지원 범위에서 제외합니다. 수동 감독 관계를 입력하면 거부하며, 실제 상품에 감독이 없다는 뜻으로 해석하지 않습니다.

일괄 지급형 팩은 DB·검색에 유지하지만 코인 결제여도 미래 시뮬레이터에서 제외합니다. 출처의 /packs 경로 자체는 상품 유형 근거가 아니며 미확인 종류·지급 방식은 null로 남깁니다. 카드 수가 맞아도 감독·기타 구성까지 확인한 상품 전체 complete는 허용하지 않습니다.

전체 카드 API 감사의 403·미완료 결과와 요청 형식 진단은 CARD_API_AUDIT 문서와 별도 JSON을 기준으로 합니다. 이 상품 표본 수집의 성공을 전체 카드 API 성공으로 바꾸지 않습니다.

## 실행

Node.js 24.19.0의 `--use-env-proxy` 지원을 확인했습니다. 세션의 HTTP/HTTPS 프록시와 TLS 검증을 유지하기 위해 다음과 같이 실행합니다.

```bash
source /workspace/efsimulator-environment/activate.sh
cd /workspace/efsimulator
node --use-env-proxy scripts/collect-efhub.mjs
```

기본 저장 위치는 `data/research/current-catalog-observations.json`입니다. 범위·요청 예산을 명시해 확대할 수 있습니다.

```bash
node --use-env-proxy scripts/collect-efhub.mjs --page-limit 2 --max-products 40 --delay-ms 1000 --request-budget 42 --output data/research/current-catalog-observations.json
```

기본 fetch를 사용할 때 프록시 환경변수가 있지만 프록시 사용 옵션이 없으면 중단합니다. TLS 검증을 끈 환경도 거부합니다. 사용자 에이전트는 앞선 정상 관측과 같은 `Mozilla/5.0`을 사용하며 인증·접근 차단을 우회하지 않습니다. 리디렉션·HTTP 실패·응답 형식 변화는 성공으로 처리하지 않습니다. 실패 후 자동 재시도로 요청을 늘리지 않습니다.

## 구조와 검증

목록의 실제 계약은 `{packs, total, page, limit, hasMore}`입니다. 각 상품의 이름·문자열 slug·날짜·표시 카드 수를 보존하고 요청한 페이지와 총계·hasMore·행 수를 대조합니다. 페이지 사이 총계 변화나 slug 중복이 있으면 중단합니다.

상세는 `self.__next_f.push`의 JSON 배열과 문자열을 `JSON.parse`로만 읽습니다. 여러 push로 나뉜 문자열을 합친 뒤 줄별 Flight JSON record를 순회합니다. JavaScript나 페이지 코드를 실행하지 않습니다.

확인한 구성 경계는 `py-6 md:px-6` wrapper의 직속 제목·날짜/카드 수와 직속 구성 grid입니다. 그 grid의 직접 PlayerCard `props.player`만 읽고 동일 HTML 구성 grid의 카드 링크 ID와 대조합니다. record ID와 컴포넌트 export 번호를 고정하지 않습니다. 추천 그룹이 섞이거나 경계가 여러 개이거나 제목·표시 수·카드 ID가 다르면 실패합니다. 화면 구조가 바뀌면 파서를 재조사해야 하며 임의의 모든 player 객체를 모아 성공시키지 않습니다.

2026-10-25 04:53:22 UTC에 `https://efhub.com/ko/packs/ranking-event-rewards-2027`의 HTTP 200 응답에서 같은 grid의 카드 9개는 직접 JSX 데이터였고 3개는 `$L…` 문자열로 뒤쪽 JSON record를 참조했습니다(응답 SHA256 `8183e45608d99915eee1a026f56f7d72ae64ddb82ff829c995c0cb0f44dee276`). 파서는 해당 grid가 명시한 자식 참조만 record ID로 찾아 PlayerCard인지 확인합니다. 컴포넌트 종류의 import 참조나 다른 위치의 카드들을 임의로 연결하지 않으며, 참조가 없거나 다른 종류의 요소이면 실패합니다.

카드 ID는 원본 숫자 문자열만 허용하며 숫자로 변환하지 않습니다. 원본 속성과 `$undefined` 같은 전달 sentinel은 조사 자료에 보존합니다. 이를 앱의 확인값으로 사용하지 않으며 후속 정규화에서 null·미확인을 구분합니다. 이미지 URL은 원본 참조일 뿐 이미지 접근성과 합성·분리 형태의 검증 결과가 아닙니다.

## 결과와 실패 보존

결과는 `schema_version`, UTC `observed_at`, `scope`, `source_totals`, `observations`, `products`, `limitations`를 포함합니다. 관측별 URL·시각·HTTP 상태·응답 SHA256·확보 필드·소량 근거를 저장합니다. 각 상품은 목록 관측 ID와 상세 관측 ID, 원본 카드 payload를 연결합니다. 출처 총계와 확보한 표본 수는 별도로 기록하며 `scope.complete`는 false입니다.

모든 요청과 검증이 끝난 뒤 같은 디렉터리의 임시 파일을 원자적으로 rename합니다. 일부 상세만 성공하거나 예산이 부족하거나 기존 자료보다 범위·총계가 감소하면 기존 출력은 바꾸지 않습니다. 같은 상품에서 이전에 확보한 카드가 사라져도 자동 반영하지 않습니다. 실제 총계·구성 감소나 의도적인 범위 축소는 새 파일에 수집하여 근거를 검토해야 합니다. 최신 목록의 제한된 창 밖으로 이동한 상품은 현재 표본에서 빠질 수 있으므로 이 파일을 전체 이력 DB로 사용하지 않습니다.

수집 결과를 공개하려면 정규화·관계·이미지 검증과 DB/공개 갱신 절차를 별도로 통과해야 합니다. 이 명령의 성공만으로 공개 사이트 갱신이나 실제 지속 갱신 검증이 완료되지는 않습니다.
