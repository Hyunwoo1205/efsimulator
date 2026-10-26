> 과거 조사/구현 이력이다. 아래 당시 범위·현재 작업·제안은 최신 실행 지침이 아니다. 최신 정책은 **EFHub 전체 누적층(기존 엔티티 무삭제/변경 이력 보존)**과 **공식 KR 현재 판매 사이트층**을 분리한다. Standard/과거 카드의 원문 보존과 사이트의 가상 Standard 모델을 구분한다. [ROADMAP](../ROADMAP.md)·[수집 계획](../COLLECTION.md)·[인수인계](../CHATGPT_WORK_HANDOFF.md)가 우선하며 원래 관측/403·권리 근거는 그대로 보존한다.

> 과거 조사 기록: 아래 관측과 당시 후속 제안은 보존 자료입니다. 현재 작업 순서는 최신 AGENTS/WORKPLAN이 우선합니다. 개별 상품·기사·화면을 통한 감독 추가 조사는 중단했으며 감독 정보는 서비스 지원 범위에서 제외합니다.

# R3 표본 구현 중 출처 후속 조사

관찰 구간: **2026-10-25 13:01–13:03 (UTC+9)**. 이번 후속 조사만 HTTPS GET **10회**이며 200 응답 9회·403 응답 1회였다. 요청별 UTC 관찰 시각·URL·상태·원문 발췌·적용 범위는 [followup-observations.json](../../data/research/followup-observations.json)에 기록했다.

초기 [R1 조사](INITIAL_RESEARCH.md)와 초기 증거 JSON은 보존했다. 이번 자료를 현재 DB·seed에 자동으로 합치지 않았으며 전체 수집·스케줄 등록·별도 서비스 가입·인증이나 차단 우회는 하지 않았다.

## 추가로 해소된 공백

| 항목 | 추가 확인 | 적용 한계 |
| --- | --- | --- |
| 공식 공지 데이터 전달 방식 | 정상 공지 목록 HTML의 `newsData`에 JSON 170건이 인라인으로 포함됨 | 전체 프로모션 아카이브나 판매 상품 전체 목록이라고 판단하지 않음 |
| 특정 비코인 명단 이용 조건 | 공식 Halloween 캠페인이 `Epic: Daily Free Draw`의 무료·하루 1회·UTC 리셋·기간·조건부 보상을 명시 | Magical Dribblers나 Dortmund 팩의 가격·제한으로 전용하지 않음 |
| 특정 실제 판매 상품 가격·구성·기간 | 공식 에디션 목록이 링크한 한국 PlayStation 상품의 28,000 KRW·구성·판매/수령 기한 확인 | 한국 PS4/PS5 Messi Deluxe 2027 번들의 현금 구매 가격. 코인 개봉 가격이 아님 |
| 감독과 상품의 명시적 관계 | 감독 `coach` 객체와 Dortmund 상품 payload를 추가 대조 | 해당 연결은 여전히 미확인. 클럽·이름으로 관계를 만들지 않음 |

따라서 초기 조사에서 남았던 공지 구조·일부 조건·일부 실제 가격의 공백은 부분적으로 해소됐다. 현재 표본의 전체 구성·코인 개봉 조건·실제 상품↔감독 연결이 모두 확보된 것은 아니다.

## 공식 공지는 정상 HTML에서 바로 추출 가능

[공식 한국어 공지 목록](https://www.konami.com/efootball/ko/topic/news/list)은 HTTP 200이며, 화면 템플릿 외에 다음 인라인 데이터를 포함한다.

```javascript
data(){
  return {
    language: 'ko',
    newsData: [{"id":6043,"beginDate":"2026-10-23 11:00:00","title":"Regarding Match Connection Quality"}, ...]
  }
}
```

`newsData:` 뒤 배열을 JSON 파서로 읽어 **170건**을 확인했다. 첫 항목은 `6043`·2026-10-23, 마지막 항목은 `5408`·2026-06-18이었다. 원본 날짜 문자열의 시간대는 이번에 검증하지 않았다.

관련 제목에는 `6017`의 ‘[추가 정보] eFootball™ 코인 상품 구성 변경 안내’, `6012`의 ‘eFootball™ 코인의 가격 변경 안내 (2026/10/22)’, `5905`의 ‘"Show Time: Welcome to eFootball™" 선수 카드 변경 안내’가 있었다. 이들은 후속 상세 조사에 쓸 정상 경로다. **코인 자체의 구매 가격 변경을 선수팩 개봉 가격으로 쓰면 안 된다.** 이번에는 이 공지들의 상세 본문까지 수집하지 않았다.

## 실제 명단에 적용되는 무료·이용 제한

출처: [Halloween Campaign](https://www.konami.com/efootball/ko/topic/promotion/campaign/919/), 관찰 `2026-10-25T04:02:12.170798Z`, HTTP 200.

공식 원문은 아래와 같다.

> 하루 한 번, 무료로 에픽을 영입할 수 있는 기회! Epic: Daily Free Draw 에픽 Diego Forlán 등장!
>
> 본 특수 선수 명단은 하루에 1번만 선수를 영입할 수 있습니다. 02:00 (UTC)에 남은 횟수가 리셋됩니다. 상자를 리셋하더라도 남은 횟수는 리셋되지 않습니다.
>
> Epic: Daily Free Draw에서 12회 계약해도 Diego Forlán이 등장하지 않으면 도전 과제 보상으로 획득할 수 있습니다.

- 적용 명단: **Epic: Daily Free Draw**.
- 배포 기간: **2026/10/22 02:00 UTC–2026/11/05 01:59 UTC**. 원문은 분 단위이므로 종료 초를 임의로 채우지 않는다.
- 지역·플랫폼별 제공 범위: 해당 본문에서 구체적 적용 목록 미확인. 한국어 페이지라는 사실을 한국 전용 제공의 근거로 쓰지 않는다.
- 같은 캠페인은 로그인 시 **‘Highlight: Borussia Dortmund’ 추첨 계약권 ×1**도 별도 선물로 명시한다. 이를 EFHub `Borussia Dortmund Pack 26-27`과 동일 상품으로 연결할 근거는 확보하지 못했다.

이 근거는 무료 명단 조건의 실제 사례다. **Magical Dribblers의 개봉 가격·횟수 제한이 아니며**, 12회 조건은 해당 캠페인의 조건부 보상 규칙이다. 다른 상품의 보장 횟수나 공통 추첨 규칙으로 확장하지 않는다.

## 공식 연결 판매처의 실제 현금 번들 가격

[공식 에디션 목록](https://www.konami.com/efootball/ko/page/download_edition_list)이 실제 연결한 [PlayStation 한국 상품](https://store.playstation.com/ko-kr/product/HP0101-CUSA26994_00-EDITION000000013)을 정상 GET으로 읽었다. 관찰 `2026-10-25T04:02:53.760620Z`, HTTP 200.

| 항목 | 확인값 |
| --- | --- |
| 상품 | eFootball™: Leo Messi Edition 2027 [Deluxe] |
| 출처 상품 ID | `HP0101-CUSA26994_00-EDITION000000013` |
| 판매처 지역·플랫폼 | 한국 `ko-kr`, PS4·PS5 |
| 구매 가격·재화 | **28,000 KRW**, 본문 `28,000원` |
| 구조화 가격 근거 | JSON-LD `"offers":{"@type":"Offer","price":28000,"priceCurrency":"KRW"}` |
| 상세 구성 | 게임 본편, Epic Lionel Messi (2020-21 FC Barcelona) ×1, Highlight 선수 카드 ×10, Exp. 4,000 토큰 ×22, 유니폼 ×1, 프로필 배너 ×1, 경기장 설비 2종 각 ×1 |
| 추가 보너스 | eFootball™ 코인 450개 **무료 코인** |
| 판매 종료 | 2027-08-05 01:59:59 UTC |
| 상품·보너스 수령 기한 | 2027-08-12 01:59:59 UTC |
| 계정 조건 | 본 상품을 구입한 계정에 한해 증정 |

**28,000 KRW는 이 한국 PS4/PS5 에디션 번들의 구매 가격이다.** 450코인은 포함 보너스이며 구매 재화가 아니다. 다른 플랫폼·지역, EFHub 상품 묶음, Magical Dribblers 또는 코인 개봉 옵션으로 가격을 옮겨 넣지 않는다.

상세 설명은 유니폼을 `Leo Messi Edition 2027 [Deluxe]`로 표시하지만 같은 페이지의 에디션 비교 영역에는 `2025 [Deluxe]` 표기가 보였다. 원문 문맥을 나눠 보존했으며 이 차이를 임의로 정정하지 않았다. Highlight 10개의 개별 카드 ID·EFHub 대응·감독 연결·구매 횟수 제한은 미확인이다. 본문에서 감독을 찾지 못했다는 이유로 감독 수를 0으로 확정하지 않는다.

공식 목록이 연결한 [Microsoft 상품](https://microsoft.com/store/apps/9NQ0Q5P5QBXD)은 관찰 `2026-10-25T04:02:53.012200Z`에 **HTTP 403**을 반환했다. 인증·쿠키·토큰 변경이나 추측한 다른 경로로 접근하지 않았으며, Microsoft의 가격·구성·제공 조건은 확인값에 포함하지 않았다.

## 감독 관계 추가 대조와 남은 조사

[Niko Kovač 감독 상세](https://efhub.com/ko/managers/17610439655559)의 정상 전달 자료에는 다음 객체와 문자열 ID가 실제 존재한다.

```text
"coach":{"id":17610439655559,"name":"Niko Kovac","accentedName":"Niko Kovač", ...}
"coachId":"17610439655559"
```

이 객체의 능력·부스터·링크업 정보는 확인했지만 `packId`·`packIds`·`productId`·`price`·`currency`의 판매 관계는 찾지 못했다. [Dortmund 상품 묶음](https://efhub.com/ko/packs/borussia-dortmund-pack-26-27) payload에도 해당 감독 ID와 `coach`·`coachId`·`managerId`가 없었다. 이 결과는 **조사한 자료에서 관계를 입증하지 못했다는 뜻**이며 모든 정상 출처에서 확보가 불가능하다는 판정이 아니다.

[공식 개요](https://www.konami.com/efootball/ko/page/overview)는 일반적으로 ‘선수와 감독, 유니폼 등 다양한 보너스가 포함된 팩’이 판매된다고 설명한다. 이 일반 정의로 개별 팩에 특정 감독을 연결하지 않는다.

후속 작업은 명시적 상품↔감독 관계, 전체 게임 내 구성, 출처간 ID 대응, 실제 코인 개봉 옵션·제한을 해당 상품의 정상 근거로 확보하는 것이다. 이번 자료는 조사 증거로만 추가했으며 현재 seed의 새 상품·가격·조건·관계를 자동 변경하지 않았다. 실제 신규/변경 데이터의 운영 반영과 지속 갱신 검증도 별도 과제로 남는다.
