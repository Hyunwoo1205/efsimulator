# 현행 상품·구성 카드 범위와 EFHub 대조

2026-10-25 11:57 UTC 이후 공개 관측을 기준으로 기존 R1/T002·R4/T005를 보강한다. 최신 사용자 범위는 **현재 구입·교환·이용 가능한 선수 관련 상품과 그 안의 카드, 판매 기간/상태와 갱신**이다. 과거 상품 전체·전역 카드 전수 확보·다른 버전 신규 수집은 핵심 완료 조건에서 보류한다. 기존 데이터·기능·조사 근거는 보존한다. [구조화 근거](../../data/research/current-shop-observations.json)를 함께 관리한다.

## 결론과 비교 모수

**EFHub에 현행 상점 상품이 전부 있다고 확인할 수 없다. 현재 앱의9상품도 현행 상점 전체가 아니다.** EFHub는 판매 시작/종료·현재 상태를 제공한 것으로 검증되지 않은 역사 카탈로그다. 이번 정상 목록1·2쪽의60행·총계1,698개를 현행 판매 수로 사용할 수 없다.

공식 한국어/일본어 확률표는 동일한 특수 명단7개와 초기 인원·종료 시각을 보여준다. 그러나 같은 시점 캠페인에는 이 표 밖의 Daily Free Draw와 Dortmund 추첨 계약권 대상이 따로 있다. 플랫폼별 특별판도 별도다. **7+2+4를 전체 상점 수로 합산하지 않는다.** 전체 공개 상점 모수, 국가/플랫폼별 차이, 계정 한정·복귀/신규·영입 완료/계약권 보유 조건은 미확인이다. 목표 지역/플랫폼 답변 전 한국 PlayStation을 전체 상점 기본값으로 확정하지 않는다.

## 공통 공개 특수 명단: 확률표7개 대조

공식 출처는 [한국어 확률표](https://efootball-web.konami.net/probability_kr.php)와 [일본어 확률표](https://efootball-web.konami.net/probability_jp.php)다. 아래 종료는 UTC이며 모두 관측 시각 이후다. 시작은 미기재다. 한국어/일본어는 문서 언어이며 국가별 계정의 제공 자격을 뜻하지 않는다. 개별 플랫폼·가격·코인/무료/지명 방식도 이 표만으로 확정할 수 없다.

| 공식 명단 | 초기 수 / 종료(UTC) | EFHub에서 관측한 대응 후보 | 구성 확보와 한계 |
| --- | --- | --- | --- |
| National Team Selection: Worldwide Sep '26 | 11 / 11-05 01:59:59 | 60행에서 충분한 후보 미확인 | 일반 National Teams Selection9/10·9/17행은 같은 회차로 확정하지 않음. EFHub 전체 부재가 아님 |
| League Selection: Italian Oct '26 | 11 / 12-03 01:59:59 | [Italian League Selection 8 Oct '26](https://efhub.com/ko/packs/italian-league-selection-8-oct-26) | 목록 표시11; 상세 구성/타입 미수집. 같은 수량만으로 동일성/완전성 확정 불가 |
| Epic: Ricardo Quaresma | 50 / 10-29 01:59:59 | 60행에서 미확인; Quaresma검색403 | 검색 결과0이 아니라 요청 거부. 전체 카탈로그 부재 판정 불가 |
| Epic: European Clubs Midfielders | 150 / 10-26 01:59:59 | [European Clubs Selection Midfielders19Oct](https://efhub.com/ko/packs/european-clubs-selection-midfielders-19-oct-26) | 목록8; 상세/타입 미수집. source date10/15와 제목10/19 차이. 다른 소개 그룹과 임의 합산 금지 |
| Show Time: Magical Dribblers | 150 / 10-29 01:59:59 | [Magical Dribblers22Oct](https://efhub.com/ko/packs/magical-dribblers-22-oct-26) | 소개11카드 확보: Showtime3·Highlight8. 전체150과 별개 |
| POTW: Worldwide22Oct '26 | 11 / 10-29 01:59:59 | [POTW22Oct](https://efhub.com/ko/packs/potw-22-oct-26) | 소개11 확보: Trending11. Worldwide 생략·공식 카드ID 연결 미확인 |
| POTW: European Club Championship | 11 / 10-29 01:59:59 | [POTW UCL22Oct](https://efhub.com/ko/packs/potw-european-club-championship-22-oct-26) | 소개11 확보: Trending11. 공식 표에는 회차 날짜가 없어 동일 상품/카드 구성 연결 미확인 |

이름·시기 후보는 **7개 중5개**, 충분한 후보 미확인2개는 **National Team Selection: Worldwide Sep '26와 Epic: Ricardo Quaresma**다. 이5개도 공식 상품/회차와 EFHub의 명시적 식별자 연결은0건이며 전체 게임 풀 대조 완료는0건이다. 관측한 source slug·URL·공식 문서/기사 ID·카드 ID/타입은 JSON에 둔다. 이름만으로 활성 관계나 판매 상태를 변경하지 않았다.

Midfielders [공식 소개1407](https://www.konami.com/efootball/ko/topic/promotion/agent/1407/)는 Epic3·Highlight8 외 현역139명을 명시한다. EFHub의8명 목록을 이150명 전체로 보지 않으며139명의 타입/ID도 추정하지 않는다. [Quaresma 소개1405](https://www.konami.com/efootball/ko/topic/promotion/agent/1405/)의 게시일은 판매 시작 시각으로 치환하지 않는다.

## 확률표 밖의 현재 캠페인

[Halloween919](https://www.konami.com/efootball/ko/topic/promotion/campaign/919/)는2026-10-22 02:00 UTC부터11-05 01:59 UTC까지를 분 단위로 안내한다. 종료 초를 임의로 채우지 않는다.

| 대상 | 확인된 이용 방식 | EFHub 대조/미확인 |
| --- | --- | --- |
| Epic: Daily Free Draw | 무료1일1회, 02:00 UTC 리셋; Forlán 소개. 12회 계약 후 미등장 시 별도 보상 조건 | 전체 초기 수/ID·동일 EFHub상품 미확인. 소개1명이나12회 조건을 전체 풀 수로 보지 않음 |
| Highlight: Borussia Dortmund | 로그인 선물 추첨 계약권1개·추가 활동 보상 | 배포 기간과 명단 영입 종료를 구분. 최대5명 영입 안내≠초기 풀5명. EFHub Halloween5·Dortmund Pack11과 동일상품 근거 미확인 |

이 자료는 무료·계약권도 DB 범위에 남겨야 할 근거다. 단순 현금 판매 목록과 다르며, 코인/지명/무료를 명칭만으로 판정하지 않는다. 현재 지명 계약 상품의 완전한 공개 모수도 미확인이다.

## 별도 부록: 한국 PlayStation 특별판

[공식 특별판 목록](https://www.konami.com/efootball/ko/page/download_edition_list)이 연결한 아래4개 페이지를 각각1회 GET200으로 확인했다. PS4/PS5·한국 `ko-kr`의 공개 가격/상품 설명이며 계정별 실제 구매 자격·Xbox/모바일/Steam의 같은 조건을 검증한 것이 아니다. 목표 플랫폼의 전체 상점 기본값으로 사용하지 않는다.

| 상품·PS 원본 ID 끝자리 | 가격 | 본문 카드 구성 | 현재/기간과 미확인 |
| --- | --- | --- | --- |
| [Leo Messi Deluxe / …013](https://store.playstation.com/ko-kr/product/HP0101-CUSA26994_00-EDITION000000013) | 28,000 KRW | Epic1+Highlight10 | 공개 구매 표시·판매 종료2027-08-05 01:59:59 UTC. 개별 카드ID/이미지/OVR 미확보 |
| [Lamine Yamal Deluxe / …015](https://store.playstation.com/ko-kr/product/HP0101-CUSA26994_00-EDITION000000015) | 28,000 KRW | 본문Epic1+Highlight7 / 비교표Epic1+Highlight10 | 제목/가격은Deluxe이나8·11카드 충돌. 구성 수 확정 보류 |
| [Leo Messi / …012](https://store.playstation.com/ko-kr/product/HP0101-CUSA26994_00-EDITION000000012) | 18,000 KRW | Epic1+Highlight7 | 같은 판매 종료. 개별 카드ID/이미지/OVR 미확보 |
| [Lamine Yamal / …014](https://store.playstation.com/ko-kr/product/HP0101-CUSA26994_00-EDITION000000014) | 18,000 KRW | Epic1+Highlight7 | 같은 판매 종료. 개별 카드ID/이미지/OVR 미확보 |

스토어 `releaseDate=2026-08-12T22:00:00Z`는 별도로 보존하며 게임 내 상품 판매 시작과 동일시하지 않는다. 포함 코인250/450개는 보너스이지 결제 재화가 아니다. 일괄 지급 에디션은 DB/검색 참고 대상이지만 미래 개봉 시뮬레이터에서 제외한다. 4종 모두 관측한 EFHub60행에서 식별되지 않았으며, Gracias Leo 등 이름 유사 행으로 연결하지 않는다. 이것도 전체 EFHub 부재의 증거는 아니다.

## 현재 DB와 다음 완료 조건

활성9상품·상품 연결79카드·별도 Yaya 상세/버전4카드를 보존했다. 9상품의 `availability`는 모두unknown이며 확정 시작/종료는0건이다. 최신 카탈로그에 보인다는 이유로 판매 중으로 승격하지 않는다. 누적 보존 데이터와 현행 판매 뷰는 분리하고, 기간 종료는 삭제가 아니라 근거 있는 상태/노출 변경으로 다룬다. 이 뷰는 후속 구현 계획이며 이번에는 앱/seed를 변경하지 않았다.

최소 필드는 다음 이유로 필요하다. 미확인은null로 남기며 모든 확장 필드 수집을 요구하지 않는다.

| 최소 정보 | 필요한 이유 |
| --- | --- |
| 카드 이름·이미지·표시 OVR 및 확인된 적용 조건 | 사용자가 찾는 카드 정보. 서로 다른 조건의 수치를 섞지 않음 |
| 출처별 안정 상품/출시 카드 ID·상품 연결 | 동명 카드 구별, 중복 방지, 정확한 구성과 갱신 |
| 타입·상품 종류·일괄 지급/추첨/지명 방식 | 희귀도/구성 구분과 시뮬레이터 대상 판정 |
| 지역·플랫폼·판매 시작/종료·상태·확인 시각 | 어떤 상점의 “현재”인지 판정하고 종료/신규 상품 갱신 |
| 확인된 가격·재화·개봉 옵션/확률·제한/리셋 | 추후 비용·추첨 규칙을 정확히 재현. 현재는 미확인 표시 가능 |
| 출처 URL·관찰 시각·필드 근거 | 오류/변경 추적과 서로 다른 자료의 충돌 처리 |

T005는 대상 지역/플랫폼과 공개 비교 범위를 확인하고 상품별 대응 근거·판매 기간·필수 카드 필드를 보강한다. R5/T006은 **현행 상품의 구성·상태·필드 공백 보강**으로 바꾸며 과거 전체/다른 버전 신규 수집을 보류한다. 기존 버전 탐색 기능과 기록은 삭제하지 않는다. R6는 현행 신규/종료·조건 변경의 실제 반영과 실패 시 정상 자료 보존을 검증하며 전역5만 카드 전수 감사 완료에 종속시키지 않는다.

목록 수준은 범위가 정해진 공식 모수와 상품별 판매 상태/기간을 대조해야 하고, 구성 수준은 소개 목록/전체 초기 풀/미확인을 구분해야 한다. 부분 공개와 대상 범위 완료를 구분한다. 익명 Standard 슬롯과 시뮬레이터는 계속 미도입이다.

`dt870_console_win.cpk`는 API 주소가 아닌 게임 DB 파일 컨테이너다. PesLig는 그 파일을 출처로 선언한 자체 JSON API를 제공하지만 내부 추출/정규화 과정은 미확인이다. 이 전역 snapshot은 현재 상품의 필요한 카드 조회에 참고할 후보이지 전역/역사 수집을 다시 필수화하는 근거가 아니다. 별도10개 최근 카드 DB·인물 DB·커뮤니티 비교는 [공급망 조사](DATA_SUPPLY_CHAIN.md)의 후속 절을 따른다.
