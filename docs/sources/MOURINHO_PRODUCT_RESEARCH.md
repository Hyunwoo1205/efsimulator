> 비활성 참고 기록: 최신 사용자 지시에 따라 개별 감독 관계 조사와 수동 상품 연결은 중단했습니다. 아래 관측은 보존 자료이며 활성 데이터·검색·상세의 근거로 사용하지 않습니다. 일괄 관계 API를 확보하기 전 모든 상품의 감독 정보와 독립 감독 목록을 서비스 범위에서 제외합니다.

# José Mourinho 상품·감독 관계 조사

조사 단계는 R3이며, 이번 사례는 **제3출처가 보고한 별도 상품·감독 관계(`source_reported`)**로 채택한다. 공식 출처의 상품별 교차 검증은 미완료이고, 기존 EFHub 상품·감독·선수 카드와 동일 ID라고 판단하지 않는다.

정확한 관측 시각과 응답 해시를 남기기 위해 이미 발견한 기사·게시물·이미지만 정상 HTTPS GET으로 3회 재조회했다. 관측 구간은 **2026-10-25 13:51:27–13:51:28 (UTC+9)**이며 모두 HTTP 200이었다. 요청별 UTC 시각·응답 바이트 SHA256·원문 발췌는 [관측 JSON](../../data/research/mourinho-product-observations.json)에 있다. 로그인·접근 제한 우회·서비스 가입·환경 변경은 없었다.

## 확인한 출처와 인용 관계

1. [Sportsdunia 기사](https://www.sportsdunia.com/esports/efootball-adds-new-jose-mourinho-manager-pack)는 Shubhrajit Goswami의 작성물이다. 기사 JSON-LD는 최초 게시 `2026-09-10T07:52:23.056Z`, 수정 `2026-09-12T22:49:40.865Z`를 표시한다.
2. 기사는 [eFootball__PES의 게시물](https://x.com/Efootball__PES/status/2097939763076669826)을 임베드한다. 원문은 계정을 **Fan account**로 표시하며, `Manager Pack: JOSE MOURINHO`와 `LONG BALL COUNTER 90 ⚡`를 명시한다.
3. 게시물이 제공한 [실제 상품 화면 이미지](https://pbs.twimg.com/media/HR1hEoXawAAdgDk?format=webp&name=large)를 직접 시각 확인했다. 재조회한 이미지 바이트가 직접 확인한 이미지의 SHA256과 같음을 검증했다.

기사와 게시물은 **인용 관계**다. 독립된 두 출처의 교차 확인으로 계산하지 않는다. 기사의 공식 스토어·공식 eFootball 계정 연결은 확인하지 못했다. [초기 조사](INITIAL_RESEARCH.md)와 [기존 후속 조사](FOLLOWUP_RESEARCH.md)에서 특정 상품과 감독의 관계가 남아 있었으므로, 보완 가능한 제3출처의 실제 관측을 별도 사례로 보존한다. 이를 모든 공식 경로에서 관계 확보가 불가능하다는 판정으로 확대하지 않는다.

## 상품과 감독의 직접 연결 근거

기사의 `h2#jose-mourinho-arrives-in-a-new-manager-pack` 다음 문단과 `NewsArticle.articleBody`는 아래 내용을 동일하게 제공한다.

> The new eFootball Jose Mourinho manager pack was released on September 10, 2026. The manager pack is listed at a price of 750 eFootball coins, and it includes Jose Mourinho as the manager and Arda Guler and Brahim Diaz as the two highlight cards.

게시물의 인게임 상품 화면에서는 다음 항목이 **같은 상품 화면 안에** 보인다.

| 항목 | 직접 관측값 | 적용 범위 |
| --- | --- | --- |
| 상품 제목 | `José Mourinho 11-12` | 원문 문자열 보존. 다른 연도·버전과 자동 병합하지 않음 |
| 감독 | Mourinho 사진과 감독 아이콘 | 해당 상품에 포함된 감독 관계의 근거 |
| 선수 미리보기 | `Arda Güler`, 표시 `95 AMF`; `Brahim Díaz`, 표시 `93 CF` | 이 화면의 두 카드. EFHub 카드 ID는 미확인 |
| 감독 팀 스타일 | `Long Ball Counter 90` | 해당 화면의 감독·버전 정보 |
| 상품 구매 가격 | 코인 아이콘과 `750` | 기사도 `750 eFootball coins`라고 명시. 다른 상품의 개봉 옵션 가격으로 전용하지 않음 |
| 남은 수량 원문 | `Remaining: 1` | 캡처 계정의 표시값. 공통 구매 제한 1회로 확정하지 않음 |
| 상대 기간 원문 | `Ends in: 83 day(s) 19 hr(s)` | 캡처 시각이 검증되지 않아 절대 종료일을 계산하지 않음 |
| 전체 구성 확인 | `Content` 버튼은 있으나 해당 화면을 열지 않음 | `known_full_composition: false` 유지 |

표시 종합 능력의 각주는 아래와 같다.

> *The displayed Overall Ratings reflect the highest possible Ratings of the players.

따라서 95와 93은 **최고 가능 능력을 표시한다는 조건을 포함한 관측값**이다. 기본 능력이나 조건 없는 공통 값으로 사용하지 않는다. 기사에서 두 카드를 Highlight로 보고한 사실과 원본 이미지의 표시값도 각각의 근거에 연결한다.

이 자료는 감독 한 명과 보이는 두 선수의 관계를 뒷받침한다. 전체 `Content` 목록을 확보하지 않았으므로 다른 구성품이 없다는 결론이나 전체 구성 완료를 선언하지 않는다. 지역·플랫폼·보편 구매 조건·전체 판매 기간·현재 판매 여부도 미확인이다.

## 식별자와 이미지 처리

- 실제 게시물 ID는 문자열 `2097939763076669826`, 이미지 식별자는 문자열 `HR1hEoXawAAdgDk`다. 기사 자체의 식별에는 원본 기사 URL을 사용한다.
- 이 식별자는 **출처 게시물·이미지의 ID**이며 원본 게임의 상품·감독·선수 카드 ID가 아니다. 원본 게임 ID를 만들어 채우지 않는다.
- `screenshot_slot`은 해당 게시물 이미지 내부의 대상 위치를 구별하는 **로컬 레코드 식별**이다. 선수 1번과 2번, 감독 위치 등으로 내부 레코드를 나누더라도 그 값을 원본 게임 ID로 표현하지 않는다.
- 이름·클럽·유사 이미지로 EFHub 감독이나 카드와 병합하지 않는다. `José Mourinho 11-12`도 이 출처와 버전에 한정해 보존한다.
- 이미지는 상품 UI·감독·카드를 합친 스크린샷이다. 분리된 감독 PNG·선수 이미지·카드 배경 자산이라고 표현하지 않는다. 저장소에 이미지를 재호스팅하지 않고 관측 JSON에 원본 URL을 보존했다.
- 기사 대표 이미지는 편집 합성물이며 상품 가격·구성을 보여 주지 않는다. 상품 관계 근거로 채택한 이미지는 위 게시물의 실제 인게임 캡처다.

이미지 SHA256은 `d21927ca5f7bd8adf5eca0d900aca7733f58c963487ce1563213b32478cc7b63`, 응답 크기는 245,832바이트, 직접 읽은 해상도는 2048×1449다.

## 코드에서 참조할 관측 구조

[관측 JSON](../../data/research/mourinho-product-observations.json)의 `sources`는 `sportsdunia`, `efootball_pes_fan` 두 출처를 정의한다. `observations`의 조회 키는 다음과 같다.

| 관측 ID | 근거 | `source_entity_id` |
| --- | --- | --- |
| `mourinho_article_product` | 기사 실제 문단·작성자·게시/수정 시각·포함 구성 보고 | 원본 기사 URL |
| `mourinho_post_product` | 팬 계정 표기·상품 게시물 본문·정확한 이미지 연결 | `2097939763076669826` |
| `mourinho_product_screenshot` | 직접 시각 확인한 같은 상품 화면의 제목·감독·카드·가격·각주·상대 표시 | `2097939763076669826` |

세 관측 모두 `source_entity_kind: "product"`이며, 상품 출처 문맥 안에서 얻은 필드를 `verified_fields`와 `excerpts`에 보존한다. `source_entity_id`는 위 출처 레코드의 식별자라는 뜻이며 게임 상품 ID를 확보했다는 뜻이 아니다.

`product_record`에는 제목·감독명·750코인·원본 이미지 URL·두 선수의 표시 능력·각주·기사/게시물 URL을 정리했다. `product_record.observation_ids`로 해당 근거를 찾을 수 있고, 각 필드의 실제 관측 내용은 `observations.find(({ id }) => id === observationId)`로 조회할 수 있다. 이 파일은 정규화 seed 자체가 아니며 DB 반영 시 원본 출처·버전·근거 연결과 미확인 값을 유지해야 한다.

## 지속 갱신의 확인 범위

기사의 게시·수정 시각과 [eFootball 보도 목록](https://www.sportsdunia.com/gaming/efootball)의 2026-10-20·22 신규 보도는 계속 기사화하는 출처라는 근거다. 그러나 이 기사가 전체 상품 DB를 지속 동기화하거나 가격·구성 변경을 모두 반영한다는 근거는 아니다. 실제 신규/변경 자료 수집과 운영 경로 반영, 스케줄 가동·실패 복구는 별도로 검증해야 한다.
