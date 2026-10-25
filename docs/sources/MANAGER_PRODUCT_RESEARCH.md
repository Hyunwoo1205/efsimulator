> 비활성 참고 기록: 최신 사용자 지시에 따라 개별 감독 관계 조사와 수동 상품 연결은 중단했습니다. 아래 관측은 보존 자료이며 활성 데이터·검색·상세의 근거로 사용하지 않습니다. 일괄 관계 API를 확보하기 전 모든 상품의 감독 정보와 독립 감독 목록을 서비스 범위에서 제외합니다.

# R3 상품·감독 관계 조사

관찰 시작: **2026-10-25 13:41 (UTC+9)**. 현재 T004의 실제 상품↔감독 관계를 확인하기 위해 EFHub의 정상 목록·상세·실제 JS·기사와 기사 본문 이미지를 조사했다. 요청별 증거는 [manager-product-observations.json](../../data/research/manager-product-observations.json)에 보존했다.

**정상 감독 목록 계약과 기사에 표시된 José Mourinho의 독립적인 감독 자료를 확보했다. 조사한 상품에 해당 감독이 포함된다는 직접 근거는 아직 확보하지 못했다.** 이 결론은 링크 유무만으로 판단한 것이 아니다. 기사 원문이 설명하는 출시 맥락, 실제 이미지와 상품·감독 전달 자료의 의미를 함께 확인했다.

- 이번 조사: GET **26회**, 고유 URL 24개. HTTP 200 응답 25회·403 응답 1회.
- 시각 기록: 25회는 정확한 UTC 응답 관찰 시각을 확보했다. 병렬 조사에서 최초 검색 요청 1회의 정확한 시각을 놓쳤으므로 그 기록의 `observed_at`은 `null`, 이후 시계 확인 시각은 `recorded_at`으로 구분했다. 정확한 시각을 만들어 넣지 않았다.
- 변경 범위: 이번 신규 JSON과 문서만 작성했다. 초기·후속 관측 원본, seed·앱 코드·관리 문서와 기존 브랜치는 수정하지 않았다.
- 모든 요청은 기존 프록시·TLS 검증을 유지했다. 추측한 감독 상세 API·다른 인증·쿠키·토큰·우회 경로를 사용하지 않았다. 댓글·리뷰·투표 등 쓰기 API는 호출하지 않았다.

## 정상 감독 목록의 구조와 범위

[감독 목록 HTML](https://efhub.com/ko/managers)은 HTTP 200이며 처음 전달한 화면에 `0 managers`가 보인다. 해당 숫자는 클라이언트 초기 상태다. 실제 연결 JS `695b4bfb1720fddb.js`의 정상 요청은 다음과 같다.

```javascript
fetch(`/api/public/coaches${t ? `?${t}` : ""}`)
```

이를 근거로 [정상 감독 목록 API](https://efhub.com/api/public/coaches)를 요청했고 `2026-10-25T04:42:07.283037Z`에 HTTP 200을 확인했다.

| 항목 | 확인값 |
| --- | --- |
| root 배열 | `coaches` |
| 다른 root 키 | `total`, `page`, `limit`, `totalPages` |
| 출처 보고 총계 | 2,012 |
| 확인한 페이지·응답 수 | 1쪽·24개, `limit=24`, `totalPages=84` |
| 감독 객체 필드 | `id`, `name`, `accentedName`, `japName`, `chineseName`, `country`, `age`, `affinity`, `skills`, `boosts`, `hasBoost`, `linkupId`, `linkup`, `linkupId2`, `linkup2` |
| 포함 상품·가격 필드 | 조사한 응답에는 없음 |

원문 감독 `id`는 JSON 숫자다. 예를 들어 Niko Kovač의 원문 값은 `17610439655559`이며 조사 기록에서는 정확한 10진 문자열로 보존했다. 이후 수집기에서도 긴 숫자가 부정확한 `Number`가 된 다음 문자열화되지 않도록 해야 한다. 2,012명은 출처가 보고한 총계이며 이번에 전원을 수집한 것은 아니다.

[Niko Kovač 상세](https://efhub.com/ko/managers/17610439655559)는 다음 자료를 실제 전달한다.

```text
"coach":{"id":17610439655559,"name":"Niko Kovac","accentedName":"Niko Kovač", ...}
"coachId":"17610439655559"
```

실제 클라이언트 컴포넌트는 `ManagerSubHeader`, `ManagerOverview`, `ManagerCommentsSection`이었다. 대응하는 네 개 JS를 읽었으나 상품 경로·가격·재화·명시적 상품 ID 연결은 확인하지 못했다. `abb22cc21329b4fe.js`의 `packId` 부분 문자열 네 번은 `datapackIdA/B`에 포함된 검색 결과이며 상품 식별자가 아니다.

## 상품 목록·상세와 감독 관련 기사 대조

| 실제 조사 경로 | 결과 | 관계 판단 |
| --- | --- | --- |
| [상품 목록](https://efhub.com/ko/packs) | 200, 초기 상태 `No packs found.` | 초기 화면만으로 빈 DB라고 판단하지 않음 |
| JS에 실제 존재하는 `packs?search=manager&page=1&limit=30` 요청 | 403 | 정상 검색 파라미터로 요청했으나 거부됨. 조건·인증 변경으로 재시도하지 않음 |
| [Manager Pack 15 Oct '26](https://efhub.com/ko/packs/manager-pack-15-oct-26) | 200, `2 players`, Alexis Mac Allister·Endo Wataru | 두 항목은 CMF 선수 카드. 감독으로 분류하거나 특정 감독을 이름·날짜로 연결하지 않음 |
| 상품 상세가 실제 연결한 PlayerCard·사이드바 JS | 200, 선수 링크 또는 `name/slug/playerCount` 표시 | 감독/coach 연결은 확인되지 않음 |
| [첫 수비 연계 플레이 기사](https://efhub.com/ko/articles/261017_1-the-first-defensive-link-up-play-how-does-it-perform) | 200, Jürgen Klopp의 연계 플레이 설명 | 특정 상품에 포함된다는 설명은 없음 |
| [첫 90 LBC 감독 기사](https://efhub.com/ko/articles/260910_3-it-s-here-the-first-manager-with-90-long-ball-counter-proficiency) | 200, 여름 이적 명단과 신규 감독 출시 서술·실제 본문 이미지 2개 | 아래에서 원문·이미지 의미를 구별 |
| [Real Madrid 팩 기사](https://efhub.com/ko/articles/260907_3-the-real-madrid-pack-has-the-best-featured-midfielder) | 200, 선수 평가·실제 첫 이미지가 선수 8개 모음 | 감독 포함 설명/이미지는 확인하지 못함 |
| [Shadow Link 기사](https://efhub.com/ko/articles/261006_1-the-link-up-with-the-coolest-name-shadow-link) | 200, Mourinho의 전술 설명 | 상품 구성 관계는 확인하지 못함. 링크업 영상은 이번에 내려받지 않음 |

[기사 목록](https://efhub.com/ko/articles)은 `전체 177`을 표시하고 실제 기사 링크 177개를 제공했다. 전체 기사를 다운로드하지 않았으며 그중 감독·상품과 관련된 네 기사만 좁혀 읽었다.

## Mourinho 이미지의 확보와 포함 관계의 구분

첫 90 LBC 감독 기사의 일반 HTML 이미지 태그만 확인하면 본문 이미지를 놓칠 수 있다. 실제 Next.js Flight 본문의 `img` 노드에 아래 두 URL이 들어 있다. 정상 경로 그대로 요청해 응답·해시·치수를 기록하고 메모리에서 이미지를 확인했다.

1. [본문 이미지 1](https://cdn.efhub.com/external-assets/amadeusz-panel/260910_3/260910_3_1.webp): HTTP 200, WEBP 532×374, 관찰 `2026-10-25T04:47:35.304877Z`. **Summer Transfer vol.3**와 Ronald Araújo·John Stones·Nicolas Anelka 선수 카드 세 개를 표시한다.
2. [본문 이미지 2](https://cdn.efhub.com/external-assets/amadeusz-panel/260910_3/260910_3_2.png): HTTP 200, PNG 1958×1348, 관찰 `2026-10-25T04:47:35.498616Z`. **José Mourinho**의 이름·초상, Star Players 친화도, Long Ball Counter 90, Possession Game 62, Quick Counter 82, Long Ball 75, Out Wide 67, Overload 59, Finishing +1·Aggression +1, Shadow Link A·1-2 Cut-in C를 명확히 표시한다.

이 감독은 `article:260910_3:image:2:manager:1`이라는 출처 한정 근거 식별자로 구별할 수 있다. 다른 버전의 Mourinho를 이름만으로 병합하거나 이 이미지에 표시되지 않은 EFHub 감독 ID를 붙이지 않았다. 감독 원본 목록 ID·판매 상품·가격·재화는 이 자료에서 미확인이다.

상품 포함 관계를 판단하기 위해 페이지의 실제 canonical 링크인 [영어 원문](https://efhub.com/articles/260910_3-it-s-here-the-first-manager-with-90-long-ball-counter-proficiency)도 대조했다. 관찰 `2026-10-25T04:48:16.747831Z`, HTTP 200.

> Going live today with the global version's Thursday maintenance is the third wave of the Summer Transfer pack, featuring an Araújo card with three special skills (The Destroyer). **Also arriving is the first manager** in eFootball history with 90 Long Ball Counter proficiency.

원문은 **같은 날 여름 이적 명단과 감독이 등장한다**고 설명한다. 감독이 그 명단의 구성품이라고 직접 설명하지 않는다. 첫 이미지는 선수 명단, 둘째 이미지는 감독 능력 화면이며 같은 상품의 구성 목록 화면이 아니다. 따라서 두 이미지를 함께 실었다는 이유만으로 `Summer Transfer vol.3 → Mourinho` 관계를 만들지 않는다. 기사 본문이나 구성 스크린샷으로 관계가 직접 확인되면 링크 없이도 근거로 사용할 수 있으나, 이 사례는 그 조건을 충족하지 못했다.

## 수집기에 공유한 실제 상품 구성 경계

[Magical Dribblers 상세](https://efhub.com/ko/packs/magical-dribblers-22-oct-26)의 재관찰은 전체 페이지에서 재귀적으로 발견한 모든 `player` 객체를 상품 구성으로 처리하지 않도록 하기 위한 조사였다.

- 실제 Flight에서 `className="py-6 md:px-6"`인 상품 래퍼의 첫 직속 자식은 `div.mb-6`다. 여기에 상품명 `h1`, 날짜와 `11 players`를 표시하는 `p`가 있다.
- 둘째 직속 자식은 `className="grid gap-3 grid-cols-3 md:grid-cols-[repeat(auto-fill,minmax(168px,1fr))]"`인 구성 격자다. 격자의 직접 자식 `PlayerCard` 컴포넌트에 해당 구성의 `props.player`가 있다.
- DOM에도 같은 상품 제목·표시 수의 래퍼와 직속 구성 격자가 있으며 `a[href="/ko/players/{ID}"]` 링크를 대조할 수 있다. 다른 영역의 추천·프로필 카드를 구성으로 끌어오지 않는다.
- 관찰한 Flight 행 이름 `e`와 컴포넌트 참조 `$L2e`는 응답 내부 참조이므로 고정 식별자로 사용하지 않는다.

이 경계와 원문 구조는 수집기 담당자에게 직접 전달했다. 이를 검증해 수집하는 11개는 출처가 표시한 구성이고 게임 내 전체 150개 구성의 확보 증거가 아니다.

## 남은 작업과 완료 판단

이번 조사로 정상 감독 목록·문자열 ID 보존 방식·Mourinho의 정확한 기사 한정 감독 자료·상품 구성 추출 경계를 확보했다. 실제 상품과 포함 감독의 관계는 미해결이며 R3의 해당 요구를 완료로 표시하지 않는다.

다음은 식별 가능한 판매 상품의 구성 설명 또는 실제 구성 화면에서 감독 포함을 확인하는 것이다. 해당 출처의 감독을 별도 식별자로 기록할 수 있으며 다른 출처·버전과 이름만으로 병합할 필요는 없다. 명시적 포함 근거가 생긴 뒤 해당 상품 관측과 감독 식별·이미지·수량을 연결한다. 이번 조사 결과로 기존 seed를 자동 수정하지 않았다.
