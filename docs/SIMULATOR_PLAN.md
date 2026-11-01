# eFsimulator T017 설계·구현 계획

## 최신 T018 IPA 개봉 자료 정적 분석

2026-10-31 KST 사용자는 제공한 IPA의 분석 계획을 승인하고 분석 시작을 요청했다(C099~C100). 현재 기준은 실제 확보한 IPA의 앱 버전11.1.1/빌드11.1.110·4,145,921,439bytes이며 전체22,040 ZIP 항목 CRC 검사 통과와 SHA256은 WORKPLAN T018에 기록했다. APK는 서로 다른 버전이라는 사용자 설명만 있고 원본 다운로드/내부 비교는 확인하지 못했다. 과거의 IPA/APK 미제공 문구는 해당 작업 당시 관측이다.

이번 범위는 개봉 관련 네이티브 코드 추적과 PAK·IoStore·CPK의 형식/압축/암호화·의존성 판독을 병행하고, 추가된 efootxi 커스텀 구성의 영향을 구분하는 정적 분석이다. 코드가 참조하는 장면·모델·텍스처·카메라·모션·효과·음향의 포함/판독/표본 추출·변환 가능성을 단계별로 기록한다. 원본 소스 완전 복구·실제3D 재생/정확 타이밍·자산 재사용·웹/모바일 검증·배포를 선행 완료로 주장하지 않는다. 원본/추출 자료와 상세 분석은 비공개 작업 자료로 유지하고 Git/public dist에는 넣지 않는다.

C109의 최신 재구성 기준은 원본 명령·데이터에서 정적으로 복구한 연산/순서·상수·정규화/역수 임계값·초기화/reference map·flag·호출/데이터 경로만 사용하는 것이다. 해당 재구성 산출물의 연산·입력·분기·시간 등에 영향을 주는 미확인 의존성은 blocker로 남긴다. 관련 없는 scene/shader 미확인을 이유로 입증된 독립 원본 함수나 raw 추출까지 차단하지 않으며, 미해결 입력에 의존하는 원본 재구성 pose/GLB/영상은 생성하지 않는다. raw 추출·파싱/I/O는 보존하고 source99/target99 대체 기본값·helper→inline 동일성·source clock/fps 추정·경험 보정식·도구가 선택적으로 추가한 정규화/보간으로 채우지 않는다. 원본의 정규화/보간은 원본 근거가 있는 범위만 복구한다. 좌표/단위·직렬화 변환은 native pose 연산과 분리하며 native 결과를 변경하거나 변환 자체를 원본 로직이라 부르지 않는다. C108의 A/B/C 영상·GLB와 QA는 당시 진단 이력으로 보존하고 원본 재구성 완료로 간주하지 않는다. Stage10의non-root inline자체initializer/store·3부호vector공급확인은보존한다. C109/Stage11에서는 Stage3/Stage10 입력3ZIP·16members와 native/정상CPK를실제로복원·검증하고, 선택698명령/기존110정확일치·명시적ABI모델의alias9검사/두reference경로·자체inline계수의기호식8검사/원본조건순서를확인했다. 독립근거검토PASS·findings0이나실제reference객체/배치·alias/FPCR·flag/후처리가남아원본재구성gate BLOCKED·pose/GLB/영상0이다. 이후실행환경이연결해제돼새증거묶음영구저장/최종관리검사는미완료이며새저장영수증은0개다. 다음한작업은환경복구후Stage11로컬근거의실재/무결성확인·private/safe묶음검증/영구저장이고, 그뒤두reference경로/container reference producer·객체배치·non-overlap을추적한다. 기존Stage10정확4영수증과C108 A/B/C진단을보존하며T018부분진행/P5미착수·native완성/자연스러움해결미확정을유지한다. 실제입력복원/정적검토범위·환경해제/저장미완료와다음작업의권위는WORKPLAN C109의Stage11절이다. 원본 소스 완전 복구·전체 native pipeline 완료는 미확정이다.

후속 3D는 현재 저장된 동일 batch를 받아 재생하고 skip·실패·재생 종료가 재추첨/추가 비용을 발생시키지 않는 계약을 따른다. 실제 제품 renderer·추첨/저장·가격100/900·API/원본/규칙·예약·사이트 접근범위는 이번 분석에서 변경하지 않는다. 현재 진행·검증 결과와 한계는 WORKPLAN T018을 따른다.

1차 조사에서 개봉 setup·skip/end의 네이티브 직접 호출과 card-pack skip 음향 이름 참조를 확인했다. 자산 묶음의 실제 판독은 UTOC/PAK의 암호화 표시, CPK목록/경계 및 ACB3개 bank의308cue 중71CARDBOX 이름 메타데이터까지이며 UE 개봉 모델·모션·카메라·효과의 decode·음원/장면 실제 재생·정확 타이밍과 웹 변환은 아직 미확인이다. 커스텀 `_use_agent`가 일부 연출 응답 필드를 비우는 영향을 기존 게임 동작과 구분한다. 구체적인 수치·주소·근거, 비공개 증거 저장 영수증과 검증/원격 전달 범위 및 미해결 항목은 WORKPLAN T018에 기록한다.

### 선수별 3D 모델·모션 추출 계획 (C102)

2026-11-01 KST C102 사용자 요청으로 선수별 식별·모델·모션 추출을 T018의 명시적 작업 계획에 포함했다. C102 당시 계획만 반영한 뒤 C103/C104로 실제 분석/추출·독립 기술 결합, C105로 표시/원키 비교, C106으로8요구·선택/후처리/scene 참조를 조사했다. 아래 표는 현재 부분진행 상태이며 이전434프레임 PSA를 실제scene player clip/특정선수 고유모션으로 바꾸어 부르지 않는다.

대상은 확보한 IPA에 실제 포함된 선수 자산을 우선 목록화하고, 게임 선수 ID와 자산 참조를 검증할 수 있는 대표 선수부터 시작해 검증된 범위로 확대한다. 현재 사이트의 팩만으로 조사 대상을 제한하지 않는다. IPA에 없는 선수나 확보하지 못한 다른 버전의 자산은 미확보로 기록한다. 카드 ID·게임 선수/entity ID·모델/모션 자산 ID는 별도 식별자로 보존하고 실제 테이블·package property·코드 참조로 대응시킨다. 같은 이름·숫자 유사성·같은 선수의 다른 카드라는 이유만으로 ID 또는 모델을 동일시하지 않는다.

| 순서 | 작업 | 산출물·완료 기준 | 현재 상태 |
| --- | --- | --- | --- |
| P1 선수와 자산 식별 | 선수/카드/게임 ID와 원본 컨테이너·package·모델/모션 참조를 연결한다. 개별 자산과 공유 자산, 버전·variant를 구분한다. | 각 연결의 출처·참조·확인/추론/미확인을 가진 대응표, 대상 수와 연결 성공/누락/충돌 목록. 이름만 맞는 연결은 확정하지 않는다. | 부분 진행: 기존join/피부두경로·Uniform등록/Type+2×HomeAway·equipment3061/기본1 근거; 실제scene값/착용·외부카드/전체조합 미확인 |
| P2 선수별 모델 추출 | 얼굴·헤어·체형·몸·유니폼/장비의 실제 분리·조합 방식과 mesh, skeleton, skin weights, material, texture, morph/LOD/bulk data 의존성을 추적해 필요한 파일을 추출·변환한다. | 표본별 원본/출력 크기·hash·도구/profile·의존성 목록, geometry/UV·뼈대/skin·참조 구조 검증 결과. 카드마다 독립 mesh가 있다고 가정하지 않으며 누락/미지원은 남긴다. | 부분 진행: 선택7mesh/Skeleton과새3061Shoes/g001Glove geometry/전체UV·material10/PNG4; 이전GLB보존·Stage7새GLB/영상없음·완성외형 미확인 |
| P3 선수 모션 추출·대응 | 개봉·입장·경기 모션을 구분하고 각 모션의 공용·선수 고유·미확인 여부, 실제 선수 binding·선택 조건과 대상 skeleton을 추적한다. 필요한 animation/curve를 추출·변환한다. | 선수/rig별 모션 연결표와 frame/rate·범위·bone/curve 구조 검사. 고유 모션은 실제 연결 근거가 있을 때만 확정하며 파일명과 기존 PSA 표본만으로 분류하지 않는다. | 부분 진행: 실제scene player2/prop2 clip decode·127,876rows/18,079stored keys 대조·skeleton-only GLB2 검증, mode3정적Q순서 확인; runtime/후처리/native clock 미확인 |
| P4 대표 선수 결합 검증 | 대표 선수 모델·재질/텍스처·뼈대와 대응 모션을 결합해 좌표계/단위·bind pose·skin·bone/curve 정합성과 실제 시각 재생을 확인한다. | 추출/변환/구조 검사/시각 재생·rig 호환성을 별도 결과로 기록. 대표 표본의 완료는 필요한 의존성과 모션 결합 재생을 확인한 경우에만 표시하며 파일 생성만으로 완료하지 않는다. | 진행·미완료: C109/Stage11 선택입력alias9/기호식8·근거검토PASS, 실제reference/배치·alias/FPCR·후처리gate차단·출력0; 환경해제로새증거영구저장/최종검사미완료; 기존 A/B/C의6전체60fps+2비교·fullfinite/viewport QA와C정책4mesh/4skin GLB(Khronos0/0/0/0); GLB독립reader통과/선택입력복원검증; inline별도BSS·actualnative/체감미확정 |
| P5 대상 확대·재현 자료 | 대표 표본의 검증 결과를 바탕으로 IPA에 포함된 확인 가능한 선수·variant로 확대하고 공유 모델/모션은 중복 추출 대신 연결 관계를 보존한다. | 범주별 대상/시도/추출/변환/구조 검증/재생 확인/미해결 개수, 누락·실패 이유와 재현 가능한 비공개 파일 목록. 카드 수·선수 수·고유 자산 수를 분리한다. | 미착수: P4대표결합 검증 후 확대 |

P1의 목록화와 독립 hash/형식 검증은 기존 T018 분석과 병행하고, P2/P3는 검증된 선수/자산 대응·의존성부터 진행한다. ImageSharp3.2.0은 정상 restore/audit 뒤 공식 license target이 빌드를 차단해 사용하지 않았다. target 제거/라이선스 우회 없이 ImageSharp/Conversion 참조가 없는 Core-only 기하 도구의 정상/locked restore·Release 경고0/오류0/advisory0을 확인했고, 대표 ASTC mip0은 정상 배포 MIT Texture2DDecoder1.0.6으로 해독했다. 3차의 ImageSharp3.1.12 경고를 소급하여 제거한 결과가 아니며 다른 포맷/전체mip 지원은 별도 검증한다. 잘못된 ID/미지원 포맷을 맞추기 위해 검사를 완화하거나 이름으로 관계를 채우지 않는다.

C103 당시에는 정적 preview/atlas PNG까지만 확인했고 C104에서 별도 texture/skin motion 기술 진단을 추가했다. 같은 skeleton 참조만으로 완성 선수 모델을 확정하지 않으며 mesh별 reference pose/non-unit scale6본·bone index 차이를 유지한다. 독립 viewer는 정확한 bone name의 `sourceGlobalAnim×inverse(sourceGlobalRef)`와 전체 influence LBS를 쓰고 quaternion/weight 정규화·camera-follow를 명시한다. 원raw animation은 보존하며 이 진단을 게임 native retarget/clock/shader/kit 선택과 동등하다고 보지 않는다. Stage4 GLB의 Y/Z 반사 후 추가 winding swap 앞면 오류는 원본을 동결 보존하고 새 corrected GLB로 수정했다. 새6GLB의 Khronos 오류0/경고0·semantic diff는 변환 보존 검증이며 native appearance 동등성은 아니다. 원본/수정ID·missing 자산과 선수별 선택 미확인은 [WORKPLAN T018](WORKPLAN.md)에 기록한다.

#### 모션 자연스러움 비교와 원인 분리 (C105)

사용자는 C104 영상을 보고 모션이 자연스럽지 않다고 보고했으며 프레임 끊김/수집 미완료 중 원인을 모른다고 했다. 사용자 관찰과 검증된 원인을 구분하고 P3/P4에 아래 비교를 추가한다. 기존12fps는 인코딩/표시 정책의 확인값이지만, 이것만으로 부자연스러움의 원인이라고 확정하지 않는다. encoded67tracks와 source reference-local로 유지된99tracks를 원본·decoder·선택된 retarget 근거 없이 추출 누락으로 분류하지 않는다.

| 비교 축 | 조사·검증 계획 | 판정과 보존 조건 |
| --- | --- | --- |
| 표시 fps와 보간 | 동일 source clip/mesh/material·camera/시간 범위로 기존12fps와30/60fps·frame interpolation을 비교한다. key 선택/보간·quaternion 정규화·root/camera 정책을 명시한다. | 실제 fps/frame 수/duration과 대응 source time을 검증한다. 고fps/보간으로 새 원키나 모션을 복구했다고 주장하지 않는다. |
| 원키·track coverage/연속성 | compressed/sparse key와 decoded sample 전체의 수·time coverage·끝점·position/rotation/scale 연속성을 조사한다. reference track과 실제 encoded track, quaternion 표현 차이·수치 이상을 구분한다. | 끊김/불연속의 위치와 source/표시 단계 근거를 남기고 미검증 codec/retarget은 미해결로 둔다. 임의 smoothing으로 원본 오류를 숨기지 않는다. |
| bind/retarget와 부품·선택 | source/mesh bind·AnimationRelative·twist/facial 조건, 실제 Uniform/skin selector producer와 참조된 손/신발·visibility를 추적한다. | 화면상 부품 누락과 모션 샘플/retarget 문제를 같은 원인으로 단정하지 않는다. 실제 참조·구조·조립 검증 후 반영한다. |
| 비교 결과와 수용 범위 | 같은 동작/시간대의 비교 영상·측정과 관찰을 대응시키고 개선된 표시와 남은 native 차이를 정리한다. | 원인 확정/추론/미확인을 구분한다. 자연스러움·native 동등성 완료는 실제 결과/관찰 근거가 있는 범위에서만 기록한다. |

이 표는 C105 조사 계획이며 최종 결과와 구분한다. 현재 비교 경로는 old12의 nearest 정수 frame/무보간과 raw sparse T/S lerp·정규화 shortest quaternion SLERP의30/60fps를 분리한다. endpoint pose를1frame 추가 유지한 실제 인코딩 duration과 원clip 길이를 구분하고 old12 endpoint가 먼저 도착하는 비교를 native-time-aligned로 표시하지 않는다. Optical Flow/AI/temporal filter나 원키 추가 복구를 수행한 것으로 표현하지 않는다.

기본 손/fallback 신발의4부품 기술 후보도 실제 PID의 장비 선택/피부색·shader/retarget와 구분한다. Appearance Skin3→cfg120→DefaultFace mode1의actor1100과RealFace mode0의 실제 mesh.AssetUserData→typed SkinColor2→actor1100 경로는 서로 다르며 cfg488은 별도 중복 저장이다. 손/신발GLB/전체UV/skin 검증과 sampler의 선택 유효 입력 일치를 범용validator 완성이나 native선택관측으로 확대하지 않는다. sampler의 일반 입력 검증 한계5개·동결 manifest/실제 저장 영수증은 [WORKPLAN T018](WORKPLAN.md)에 기록한다. 기존 source/Stage5 영상과 T018 진행·P5 미착수·제품/배포/확정 DrawBatch 계약은 유지한다.

#### 8개 추출·분석 요구의 명시적 범위 (C106)

사용자는 앞서 설명한8개 요소의 포함 여부를 확인하고 계획에 넣어 다음 작업을 진행하도록 요청했다. 기준 commit `3a6c5e7f94f931be6a0ab535a92954337c0abf12`에서1/2/3/8은 목적이 명시되어 있었고4/5/6/7은 포괄 범위·일부 단서/한계만 있어 세부 계획이 불충분했다. 정확한 기존 행 근거와 판정은 [WORKPLAN C106 audit](WORKPLAN.md)에 보존한다. 아래 표로8개 모두를 입력→산출물→완료 기준 및 P1~P5/T018 scene 조사 S1에 연결한다. 계획 포함과 실제 확인/추출·native 동등성 완료는 서로 다르다.

| 요구 | 단계·선행 | 실제 조사 입력 | 산출물 | 완료 기준 | 현재 상태 |
| --- | --- | --- | --- | --- | --- |
| E1 ID/카드/선수와 실제 선택 | P1→P2/P4; 원본/수정 namespace와 caller/selector 출처 구분 | Player/Appearance·카드 대응 근거, Uniform key/팀·홈원정, equipment row/등록·callback·loader 참조 | ID→선택값→실제 파일/부품의 조건별 대응표와 충돌/미관측 목록 | 실제 대표 선택 경로를 근거로 연결하고 외부카드/런타임 미확인을 분리한다. 이름·PID 숫자로 장비를 추정하지 않는다. | 부분·미완료: Uniform등록/key=Type+2×HomeAway·PID100112 boots3061 row/glove기본1 확인; 실제scene값/착용/외부카드 미확인 |
| E2 전체 mesh/body/kit/gear·의존성 | P2→P4; E1의 확인된 선택/참조부터 | 얼굴·헤어·몸·유니폼·손·신발 등 실제 참조, mesh/LOD/bulk·skeleton/skin·material/texture·visibility | 원본/변환 목록·의존성/누락 graph, 부품별 geometry/UV/weight 및 대표 조립 후보 | 실제 사용 부품과 의존성의 확보/변환/구조·조립을 각각 검증하고 부재/미지원을 남긴다. | 부분·미완료: frozen4part14386v20792t/전체skin·7texture와C정책GLB생성; source/PNG불변·normal/Q직렬화/material근사·reader통과/actual착용 미확정 |
| E3 bind/scale/twist/facial retarget | P3/P4; E2 geometry/rig와 source animation | source/mesh reference pose·bone name/parent/index·scale, twist/facial/AnimationRelative 설정과 호출 근거 | bone/retarget 대응표·차이/미적용 목록, source와 변형 결과의 독립 비교 | bind/scale/weighted·untracked bones와 실제 retarget 조건을 검증한다. 독립delta를 native 정책으로 부르지 않는다. | 부분·미완료: Stage11자체inline계수의기호식8검사/ABI모델alias9·두reference경로확인/기존A·B·C보존; 실제객체/배치·memory alias/FPCR/flag/후처리미확정·출력차단/환경해제로새영구증거저장미완료 |
| E4 motion graph·실제 clip 선택/clock | P3/P4; E1선택+E3rig, scene S1과 연결 | native/AnimBP·table/state/sequence 참조, clip·speed/rate·loop·transition·root motion 설정/호출 | context/state→clip/clock/speed/loop/전이/root의 조건표·원시간과 표시시간 구분 | 실제 사용 graph/선택과 시간·전이/root 정책을 근거로 연결한다. 파일 길이나 고fps 영상만으로 확정하지 않는다. | 부분·미완료: 6영상+2비교60fps/전체grid표시검증·encoded-loop gate확인; source pose span/encoded길이구분·nativeclock/active분기 미관측 |
| E5 추가 finger/face/gaze·procedural/IK/cloth/hair | P3/P4; E2/E4에서 사용 여부부터 조사 | 실제 node/curve/layer·constraint/solver·bone/mesh 설정과 참조·enable 조건 | 요소별 사용/미사용/미확인 근거, 사용된 layer의 입력/순서/parameter·추출/재현 한계 | 사용 여부를 먼저 판별하고 사용 확인 범위에서만 분석/결합한다. 이름 부재를 전체 미사용으로 단정하지 않는다. | 부분·미완료: finger30/face13 encoded 보존·99helper의reference입력가정 분리, body/kit12twist 양의직접weight 영향 확인; 추가layer/guarded후처리 실제활성 미확인 |
| E6 shader·UV/mask/skin/hair alpha/normal·roughness | P2/P4; E1선택+E2재질/전체UV | 실제 material/instance/parent·override, texture channel/UV·mask·scalar/vector·sRGB·alpha/cull·shader 참조 | 슬롯/parameter/channel/UV·피부/헤어/normal/roughness 대응표·적용식/미확정 목록 | 실제 선택 parameter·mask/UV/alpha와 texture 용도를 검증한다. base-color 진단을 원shader로 간주하지 않는다. | 미완료: texture/UV 일부 검증, native skin blend/헤어alpha·normal/roughness 조합 미확정 |
| E7 전체 개봉 scene·배경/카메라/조명/VFX/음향 timeline | T018 scene 조사 S1; E1/E4/E6·기존sequence/audio 근거 | 실제 개봉 map/sequence/subsequence·camera/cut/FOV·light/VFX/material·cue/trigger·skip/end 분기와 시간 기준 | scene 의존성 graph·branch별 통합 timeline, 원본 참조와 독립 재현/미해결 목록 | 배경/카메라/조명/VFX/audio의 포함·연결·시간/분기를 근거로 검증한다. 정적 file range를 전체 game duration으로 승격하지 않는다. | 부분·미완료: actualprop2instance→unique dummy mesh12v4t2본·reference/constant key차이 확인; componentinitial/seqactorTRS합성·worldroot/runtime·분모/native clock 미검증 |
| E8 대표 검증 뒤 다른 선수 확대 | P5; 대표 P4의 정확한 ID→선택→조립/모션 검증과 확대 범위 확정 | E1~E6 대표 결과·공용/고유/variant 근거, 관련 S1 사용 범위 | 선수/카드/고유자산별 coverage·공유/고유 연결·실패/미해결/재현 목록 | 대표 검증을 통과한 범위만 확대하고 다른 선수의 동일성을 추정하지 않는다. | 미착수: 대표 native 선택/조립/재생 미완료로 P5 gate 유지 |

S1은 T018 안의 scene 조사 subtrack이며 새 작업 ID나 제품 renderer/배포 승인이 아니다. 선수 P1~P4와 실제 참조를 공유하되 장면의 입력·시간·완료 상태를 별도로 기록한다. E1/E2의 확인된 표본, E3~E6의 독립 조사, S1 참조 판독은 선행 근거가 있는 범위에서 병행한다.8행 전체가 완료된 것으로 표시하지 않으며 현재 실제 상태/새 결과는 [WORKPLAN T018](WORKPLAN.md)을 따른다.

#### Work 유지·단계별 인계와 Stage8 범위 (C107)

사용자는 Work를 유지하고 단계마다 인계 기록을 남기며 분석을 계속하기로 했다. 재개는 AGENTS 전체→WORKPLAN 상단의 최신 압축 체크포인트→최신 C107/Stage8 핵심절과 정확한 보고서/인계MD 영수증→이 표의 관련 요구/P행·FILE_SYNC5항목 순서다. 과거 전체 대화/작업계획을 매번 읽지 않되 필요한 원근거는 보존한다. 새환경의scratch/SDK/cache·전체IPA/UE컨테이너·보호된키가 자동복원된다고 가정하지 않는다.

Stage8은 실제scene player2clip의461/301frames·166bones(67encoded+99ref)와prop2clip의231/461frames·실제2bones/2encoded를 decode/대조했다. prop의`1bone`은이름이며 localconstant가worldconstant를뜻하지않는다. 원키quaternion norm오차약1e-7과pinned tool sampled FastInvSqrt오차약.001693을분리하고원키수정0·표시정규화정책을명시한다. skeleton-only GLB2개는각2clips·mesh0/skin0/Khronos오류0경고0정보71의구조결과이며완성캐릭터/장면재생이아니다.

선택native non-additive mode3의순서는 `normalize((Qanim*conjugate(QsourceRef))*QmeshRef)`, `Tanim+(TmeshRef−TsourceRef)`, `Sanim*SmeshRef*safeReciprocal(SsourceRef)`다.142asm/256synthetic와새player2clip의13facial encoded본·meshname13/13정적대응을확인했으나 runtime활성/후처리/native clock/최종외형은미확정이다. 이분기식의확인과source decode에이미retarget를적용한것을구분한다. safeReciprocal은유한성분s에서abs(s)<=약1e-8이면0,그외1/s이며conjugate를inverse로볼수있는것은unit reference일때뿐이다. top-level분모의CUE fallback0은serialized0이아니며native1을증명하지못해16초주장을보류한다.

sceneprojection은Name+ArrayIndex+ordinal을유지해prop2×TRS9채널총18개를보존했다. 이전name-only표현은각prop의T/R/S index2각3개만남겨총6채널이보였고새projection은누락된12축을복구했다. Times/Values0의localdefault와parent/attachment에따른world pose는별개다. event15keys(직접Function참조키9의이름후보대조/null6)·선택20AST의28call-occurrences(virtual19/final9)와부착참조를판독했다. LIFO traversal occurrence는실행순서나각entry→downstream완전CFG가아니며전체bytecode소비/AST완전성·실제trigger/active binding은미증명이다. Pl Away상위targetGUID와camera component GUID1개가선택ObjectBindings에서미해결이므로worldroot를가정하지않는다. 다음은실제sceneclip→대표geometry mesh reference/13mode3조건부진단비교와부착world/runtime연결을병행하고후처리/선택/shader를검증하는순서다.

검증한원본/입력과별도복구본을구분한다. 잘린oldCPK는보존하고별도Stage8정상CPK137,093,472bytes의CRC/SHA를대조했으며기존private-input ZIP의현재로컬본과native/CPK전체stream도재검증했다. 원격Library재다운로드나전체4GB IPA/2.6GB UE컨테이너백업을뜻하지않는다. 정확한범위/저장ID·다음한작업은WORKPLAN상단과C107절이권위다.

#### 실제scene 조건부 skin/retarget와 소품 연결 Stage9 (C108)

다음 작업 승인을 받아 actualmono10/idle04의동결raw sparse자료와대표4part(face100112+trainingkit+fixedhand+boots3061)를연결한다. static후보14,386vertices/20,792triangles·정확166bone/parent/name join·전체influence/rawsum255·실제7texture 참조를유지하고body기본mesh를kit에중복하지않는다. 실제activeUniform/장비/skin shader·완성선수확정과기술조립은구분한다.

A는old source-global-delta, B는mode3+source99, C는mode3+target99의명시적초기입력정책이다. 원키를수정하지않으며 source/target reference와Q정규화·선택표시clock을명시한다. 정상compactRef전체copy와byte240==1일때mappedsourceRef덮어쓰기의정적초기화경로를확인했으나flag의semantic/runtime값·container실제구성/활성분기는미관측이므로B/C를현재native정답으로확정하지않는다. body/kit의untracked12twist reference차이는각2,099/2,887·4,102/8,368정점에양의직접weight로연결되지만face의untracked reference차이는0이다.

독립선정LBS검토의같은정책계산잔차(palette약4.263e-13/vertex약5.329e-15m)와정책간거리(kit B/C최대6.700cm·hand2.196cm 등)는다르다. 후자를native GT오차/개선이나13mode3단독효과로해석하지않고palette translation91.6source units를90cm정점오류로환산하지않는다. 실제수치/선정범위와root시각관찰·최종표시검증은WORKPLAN최신C108절을따른다.

소품2instance는uniqueSK_One_bone_dummy1개(12vertices/4triangles·실제2bones/1slotWorldGridMaterial)로연결됐으며reference는mesh와exact여도constant animation key는bind와다르다. componentinitial/sequenceactorTRS·부착/socket·world/runtime이해결되기전에world pose나전체scene재현을확정하지않는다. 6개 full60fps/2비교·C정책GLB의 Khronos0error/0warning/0info/0hint와 독립 reader blocking0을 확인하고 정확한8개 version0 영수증을 저장했다. GLB의664joint nodes는166본 rig4개 직렬화이며 native664본을 뜻하지 않는다. safe/private를 빈 폴더에 복원해169source/data·13inputs/5sources/moduleSHA gate를 확인했으나 전체 재렌더를 재실행하지는 않았다. non-root encodedmode3 inline의 coefficient는 standalone helper와 다른 BSS이고, 파일상0을 runtime값으로 쓰거나 이전 계수증명을 전이하지 않았다. 새 initializer 조회는0이며 inline Q/T/S 동일성은 미해결이다. 다음 첫 검증은 이 별도 BSS initializer/inline 입력식이고, 이어 actual flag/reference producer·12twist 후처리와 PlAway world/shader를 연결한다. C105체감자연스러움해결·nativeclock/후처리/최종외형미확정·P5미착수·원본보존을유지한다.

C105의 사용자 자연스러움 보고/미확정 원인, 원source·이전 단계 동결, 비공개 자료와 원본 코드 미실행·확정 DrawBatch 계약은 유지한다. 실제 사용하지 않는 추가 layer를 임의로 채우거나 새 분석 결과 없이 자연스러움/native 동등성을 완료로 기록하지 않는다.

원본/추출 자산·키·상세 덤프는 비공개로 보존하고 Git/public dist에는 넣지 않는다. 위의 결합 재생 검증은 추출 데이터와 독립 분석 도구를 대상으로 하며 IPA 앱·내장 Python/dylib/서버·Blueprint를 실행하지 않는다. 선수 모션 조사 항목이 경기 기능 구현을 뜻하지 않으며 웹3D 적용·배포는 후속 범위다. 같은 확정 DrawBatch를 재생하고 skip/실패로 재추첨·추가 비용을 발생시키지 않는 기존 계약을 유지한다. 실제 진행/검사 결과와 미해결 목록은 [WORKPLAN의 T018 기록](WORKPLAN.md)을 따른다.

## 최신 T048 선수팩 선택 진입 통합

시뮬레이터의 선택 진입은 판매상태별 두 버튼 대신 수량·이미지로 선택 문구가 없는 `선수팩 선택` 버튼 하나다. 판매중/종료 탭과 수량은 기존 창 안에서 고른다. 선택된 팩이 있으면 그 그룹으로 열고, 미선택은 판매중을 우선하며 판매중이 비었으면 종료 그룹을 연다. 기존 검색·대표이미지·초점/닫기·busy/pending 잠금과 추첨/저장 계약은 유지한다. 검증·배포 상태는 WORKPLAN T048을 따른다.

## T047 이미지 선수팩 선택 — 진입 버튼은 T048로 보완

팩 선택은 이름만 있는 select 대신 native dialog의 팩 이름·기존 대표 카드 최대3장 미리보기로 제공한다. 판매중/종료 체험을 구분하고 팩/선수 검색·현재 선택 표시·Escape/닫기/초점 복귀와 배경 스크롤 잠금을 지원한다. 이미지는 기존 playerType 기반 최고 확인 등급 OVR상위3 규칙을 재사용한다. 팩 목록 하단의 바로 열기는 정확한 saleId를 가진 시뮬레이터 URL로 연결한다.

중앙 상단 메뉴와 페이지 영문 큰 제목에 기존 eFootball 폰트를 사용하고 홍보/중복 설명은 제거한다. 선택창은 busy/pending의 팩 전환 잠금을 유지하며 추첨/저장·가격100/900·회차/비복원/리셋·결과 정렬/시작 위치는 T017/T045/T046을 유지한다. 실제 검증/배포 상태는 WORKPLAN T047을 따른다. IPA/APK가 아직 제공되지 않았으므로 T018의 파일/3D 분석을 수행한 것으로 기록하지 않는다.

## 최신 T046 10명 결과의 시작 위치·계속하기

2026-10-30 KST 사용자는 10개 결과가 하단 계속하기에 초점이 맞아 아래로 스크롤된 상태로 보이는 현상을 수정하도록 지시했다. 10명 결과 단계 진입은 위쪽 버튼에 `preventScroll` 초점을 주고 결과 창의 `scrollTop`을0으로 맞춰 기존 등급→OVR 정렬의 첫 카드부터 표시한다. 연출 완료·건너뛰기·같은 결과 재생도 이 표시 계약을 따른다.

10명 결과에만900코인 아래 기존 헤더 여백의 계속하기를 추가하고 하단 버튼을 유지한다. 두 버튼은 같은 결과 확인 handler를 사용하고 새 버튼은 헤더/결과 창의 세로 공간을 늘리지 않는다. 1개 결과의 기존 초점·배치·버튼은 유지한다. [첨부 근거](../data/research/simulator-ui-reference-T017.json)의 T046 후속2장은 정지화면 관찰이며 실제 모바일 스크롤/공간·저장 동작의 검증과 구분한다.

T046은539회귀·타입/공식빌드·v15 public과실제10명재생/skip/자동완료의위쪽초점/scroll0·상하단2버튼/기록·비용보존·v14와정확동일헤더/창높이·기존단일1버튼/하단초점/동일크기를확인해완료했다. 구현commit의원격380blob과실제CI2건성공도확인했다. 관찰폭은1363×936이고모바일Safari실기기/실제스크롤넘침은재현하지못했으며소스계약과실측범위를구분한다. 실제값/버전·구현commit/CI와한계는WORKPLAN T046을따르고최종문서commit의미래SHA/CI를기록하지않는다.

## 최신 T045 표시 보완 — 개봉 빛·결과 정렬·일반 선로딩

2026-10-30 KST의 추가 첨부2장/사용자 지시는 T017 결과를 획득 순서로 나열하던 표시를 대체한다. 저장된 결과의 표시 사본만 공통 `sortPlayers` 기준인 Epic5 → Show Time8 → Trend3 → Highlight6 → 미분류, 같은 등급 안 OVR 내림차순/최종 문자열ID순으로 정렬하고 익명 일반 결과는 마지막에 둔다. 저장 batch·명령 이력의 획득 순서와 추첨/비용/풀은 유지하며 표시 정렬 때문에 다시 뽑지 않는다.

결과 카드 아래 실명/`일반 선수`·`n번째 획득`은 없애고 화면 읽기용 카드 식별은 유지한다. 특수 카드 내부 기존 이름/OVR/포지션은 보존하며 일반에는 실명/OVR을 추가하지 않는다. 두 카드의 표시 프레임은 동일 240×340 비율·상단 기준선으로 통일한다. 일반 고정 PNG는 원본 바이트를 바꾸지 않고 개봉 전 선로딩과 즉시/우선 로딩으로 준비한다. 이미지 선로딩 개선은 모든 망/기기의 실제 지연 시간 동등성 보장이 아니다.

자체 2D 후반에 카드가 점차 흰색으로 밝아지고 한 번 빛이 퍼진 뒤 같은 확정 결과로 이동한다. skip/replay·동작 줄이기를 유지하고 반복 점멸·추가 추첨이나 실제 게임 3D 타이밍 재현을 넣지 않는다. 두 첨부의 해시/파일ID와 정지화면 관찰은 기존 [참고 기록](../data/research/simulator-ui-reference-T017.json)의 후속 근거에 보존한다.

T045는539회귀·타입/공식빌드와v14 public·실제 결과 정렬/하단문구0/기준선/고정일반complete·기록/비용보존·원격380blob/구현CI2건을 확인해 표시 보완 범위를 완료했다. 발광은 실제 computed style에서 white opacity0→1 및후반glow/ring팽창을 확인했으나 흰색 픽셀의 스크린샷 시각 캡처는 미확인이다. reduced motion 실제 전환·모바일실기기·네트워크시간/동일지연보장도 확인하지 않았다. 실제 값·버전·구현commit/CI와 한계는 WORKPLAN T045를 따르며 최종 문서commit의 미래SHA/CI를 기록하지 않는다.

작성 기준: 2026-10-30 KST. T037~T044 기반과 최신 첨부9장·2D우선/구입확인생략·명단표시위임의 C084~C087을 반영한다. 이문서는완료된T017의2D계약과후속수용기준이다.533회귀·타입/공식빌드·public배포의실제단일/10회·복구/리셋/소진/다중탭과구현commit의원격378파일/실제CI2건을검증했다. 전체실제상호작용QA는v12에서관측했고README만정리한v13은같은실행artifact다.360px/모바일실기기와150명풀을R9까지소진하는hosted검증은미수행으로구분한다. 후속T018은APK미업로드/3D미구현의예정이다.

## 최신 T017 실행 계약 — 첨부9장과 사용자 지시

[참고 기록](../data/research/simulator-ui-reference-T017.json)은 순서대로9장의 정확파일명·LibraryID·로컬원본SHA와 root의 개별정지화면 관찰을 남긴다. 사진들은 서로 다른 팩을 포함하며 하나의 연속 개봉/동일회차/현재DB 선수ID 연결을 증명하지 않는다. 원본이미지는 저장소에 복사하지 않는다.

| 단계 | 구현 계약 | 근거·구분 |
| --- | --- | --- |
| 팩·명단 | 대표카드·모두보기·1회100/지원되는10회900,판매중/종료체험을구분 | 사진1·2의정지화면,기존API/사용자정책;사진끼리동일팩매핑없음 |
| 추첨버튼 | 구입확인창없이바로저장명령,저장중중복조작잠금 | 사진3의실제확인창은관찰했지만사용자가생략지시 |
| 저장확정 | 결과·비용·잔여풀·pending batch를하나의IndexedDB전이로확정 | 앱의원자성설계이며사진/영상이저장을증명하는것아님 |
| 2D개봉 | 저장후짧은자체2D장면,건너뛰기/동작줄이기는같은확정결과로즉시이동 | 사진4는후속3D참고;실제3D정확타이밍재현아님 |
| 단일결과 | 중앙1장·계속하기 | 사진5의정지화면 |
| 10회결과 | 정확히10장·넓은화면5×2참고·작은화면반응형그리드·계속 | 사진6·7은서로다른팩의관찰;모바일5열강제없음 |
| 계속·명단 | 현재회차획득특수의정확ID만어둡게표시,일반은잔여수만 | 사진8·9의정지화면+사용자가위임한표시선택 |

일반결과는기존고정170588공통이미지로실제표시한다. 개별명단항목은특수카드만두고일반은별도정보패널의공통그림1장과잔여수로표시한다. 이공통그림을N개의일반선수실체로확장하거나실명/가짜선수ID를만들지않는다. 같은 이미지가 여러 장 나와도 각 장은 따로 소비한 익명 슬롯이다. 과거 회차·동명이인의 카드를 현재 획득으로 어둡게 만들지 않는다. 수동/전체소진 리셋은 이전 결과와 누적100/900사용량을 보존하며 현재풀만복원한다. 소진된 마지막 결과와 새회차 준비를 명시해 명단상태가 섞이지 않게 한다.

기존영상 `-OPQF_c4WN4`는 등급별3D의 후속참고로 재분류하며 이번에 재요청하지 않는다. 추가영상 `VoEDBxb9iNY`는 앞부분을건너뛴도착화면참고요청이지만 실제프레임0개·metadata0:52·currentTime0/readyState0/buffered0/errornull이고1회새로고침뒤동일하여중단했다. skip도착화면을영상에서확인했다고쓰지않는다. **최신 첨부9장과 명시지시가2D계약을승인하므로 영상프레임재생을2D선행게이트로두지않는다.** 계약권재화·3D·APK는 이번2D범위에추가하지않는다.

T017은2D범위로완료했다.전체533/533회귀·앱TypeScript `--noEmit`·공식Worker빌드139clientmodules·관리검사가통과했다. public v12에서정확10명/900·새로고침동일pending/replay/skip·현재회차dim·수동리셋기록보존·단일전용11명팩의고유11명소진/자동준비/마지막결과복구·동시두탭1회반영을관찰했다. 구현commit `11ed42504af5c3b890902561cbf4a9eca61e161e`의원격378blob일치·실제App/API CI2건성공을확인했다. README3줄정리v13의실행artifact는v12와같으며최종문서commit의미래SHA/CI를선행기록하지않는다. 실제1363px와미수행360px/모바일·150명풀R9브라우저경계를구분하고상세근거는WORKPLAN을따른다.

팩별UI상태는chosenId의key로분리한다. 지연된이전팩저장응답은스토어인스턴스대조로버리고현재팩기록만복원한다. 새draw/reset은IndexedDB transaction대기이후전이직전의동기 `getContext`로현재pack/preparation을다시읽어자료오류/풀변경을막으며transaction안에서네트워크/await를하지않는다. 기존commandId중복·저장된pending결과확인은최신자료실패때도복구할수있다. 저장성공응답이불명확하면같은명령의저장결과를읽어직접성공과동일한UI정리경로를거쳐리셋창/ack후replay·모션/busy잠금을정리하며재추첨하지않는다.

## T038/T040/T042/T044 사용자 확정과 조사 상태 (2026-10-30 KST)

최신 사용자 결정은 T037의 제안보다 우선한다. 이 절은 제품 동작 계약이며 기능 구현/배포 완료가 아니다. 조사 근거와 미확인 범위는 [결정·조사 기록](../data/research/simulator-decisions-T038.json)을 따른다.

| 항목 | 확정한 동작 / 확인 상태 |
| --- | --- |
| 종료 팩 | 검증된 종료 팩도 체험 가능. 시뮬레이터에 **판매 중인 선수팩**과 **판매 종료 팩 체험**의 독립 섹션·제목·개수·상태 배지를 제공한다. 각 섹션 안에서는 Epic→Show Time→Trend→Highlight 우선·등급별 팩날짜 최신순 유지 |
| 가상 코인 | 잔액·충전·잔액 부족 제한 없이 사용량만 누적한다. 사용자 확정 고정 가격인 단일100/10회900코인을 누적한다. 할인·잔액 제한은 적용하지 않는다. 현재 회차/팩 전체 누적을 구분 |
| 기본 추첨 | 잔여 슬롯 n에서 각 카드가 1/n인 균등 비복원 방식. 한 회차에서 획득한 특수 카드 ID는 재등장하지 않는다. 익명 일반 슬롯도 수만큼 소비 |
| 수동 리셋 | 미확인 게임 기능 여부와 별개로 사용자가 요청한 시뮬레이터 기능이다. 해당 팩만 새 roundId로 전체 풀 복원, 이전 획득 기록·누적 추첨 수·가상 사용량 보존 |
| 전부 소진 | 마지막 결과를 확정·보존하고 완료 회차를 닫은 뒤 전체 풀의 다음 회차를 자동 준비한다. 추가 추첨·코인 사용은 자동 실행하지 않는다. 화면에 회차 완료와 새 회차를 명시 |
| 단일/10회 | T040 사용자 확인: 전체 11명 팩은 단일만, 전체 11명 초과는 단일·10회. 가공 팩/API `drawOptions`로 전달하며 특수 인원·등급으로 판단하지 않는다. T042 가격은 단일100/10회900코인으로 고정 |
| 익명 일반 표시 | T044 사용자 지정170588 원본이미지를 별도 고정 파일로 사용한다. 얼굴 사진·이름·OVR·포지션 오버레이 없이 공통 표시하며 원본 프레임·별·배경은 보존. 슬롯은 N−S 익명 집계로 유지 |
| 준비 판정 | T044 승인: 같은 원자적snapshot의 정확한회차·N/S/A·전체특수관계/9필드·API옵션100/900을 검증. ready는 데이터구성 준비이며 엔진/저장/신선도 검증을 뜻하지 않음 |
| 결과 공개 | 최신C084~C087: 구입확인생략→원자저장→짧은자체2D→단일중앙1/정확히10장그리드→계속/현회차획득dim. 첨부정지화면과사용자지시로확정했으며영상실제프레임/3D타이밍관찰과구분 |
| 3D | 최신 C099~C100에 따라 확보 IPA의 개봉 코드·PAK/IoStore/CPK와 커스텀 구성을 정적으로 분석 중이다. 실제 포함·판독·표본 변환·재생·사용 가능 범위를 구분해 후속 웹 구현 범위를 정한다. APK 원본/버전 비교와 3D 구현·재사용 가능은 아직 미확인 |

T038 조사 당시 자체 API의 팩 raw는 name/slug/date/playerCount 4필드, 가공 팩은 13필드였고 가격·10회 지원 필드가 없었다. T040 최신 사용자는 지원 여부를 가공 선수팩과 실제 사이트용 API에 넣도록 명시했다. 가공 팩은 `drawOptions`를 추가한 14필드로 확장하고 live/archive·목록/상세 API·소비 사이트까지 같은 값을 전달한다. raw4필드는 유지하며 T040 당시 선수8필드는 T041에서 정확한 원본 `playerType`을 더한9필드로 확장했다. `single={supported:true,count:1,coinCost:100}`, `ten={supported:totalPlayerCount>11,count:10,coinCost:900,minimumRemaining:10}`이며 최신 가격 provenance는 `authority:direct_user_confirmation/reference:T042/rule:total_player_count_gt_11`이다. 사용자 확정 시뮬레이터 정책이며 공식 출처의 가격 필드를 읽었다고 표시하지 않는다. 과거 T040 null가격 불변 세대는 읽기 호환성을 유지한다. 앱은 API 가격을 그대로 소비하고 별도 할인/가격 추정을 추가하지 않는다. 보장 조건과 별도 simulatorPolicyVersion은 기본 가격과 구분해 관리한다.

T038 당시 공식 1차 자료에서 특정 상품의 첫 회500코인 할인·보장형 상품을 조사한 기록은 역사적 근거로 보존한다. 최신 T042는 시뮬레이터 가격을 단일100/10회900으로 고정하고 할인은 적용하지 않는 사용자 결정이다. 과거 할인 조사 때문에 현재 가격 적용을 보류하지 않는다. 게임 횟수 제한·보장 조건은 기본 가격과 구분해 별도 근거와 적용 범위를 기록한다. 사용자가 선택한 연습 리셋/자동 새 회차는 실제 게임의 제한 초기화와 같다고 표현하지 않으며 보장형 등 다른 모드는 검토 전 활성화하지 않는다.

**잔여 1~9명 처리 — 사용자 확정(C075):** 10회 지원 팩도 잔여가 10명 미만이면 10회 버튼을 비활성화하고 단일 추첨으로 소진한다. 10회는 현재 회차 잔여가 10명 이상일 때 정확히 10명을 추첨하며, 묶음을 축소하거나 묶음 중간에 새 회차로 넘어가지 않는다. 단일 추첨 비용은 고정100코인을 적용하고 900코인을 잔여 인원수로 나누지 않는다. 전부 소진한 마지막 결과를 보존한 뒤 전체 풀을 복원한다. 이는 사용자가 정한 시뮬레이터 정책이며 실제 게임의 잔여 묶음 규칙을 확인했다는 뜻은 아니다.

**남은 조사:** 실제게임보장조건·등급별3D세부/타이밍과APK자료. 최신첨부와사용자지시로2D흐름은확정되어영상재생이새선행게이트가아니다. 기본 가격은 T042에서 단일100/10회900으로 확정되어 추가 조사 게이트가 아니다. 11명 기준의 지원 수량은 T040 사용자 확인으로 결정됐으며 T040에서 가공/API·앱소비 구현,469회귀·타입/Worker빌드·v18저장·원격발행·두서비스배포를 확인했다. 세사이트 전량·실제앱13팩상세/API옵션 일치도 확인했다. 구현commit `86397b57f47f01519322e3d2c08fa2c81ef36c24`의 원격359파일일치·실제CI3건성공도 확인해 T040을 완료했다. 현재T017 엔진 구현은 별도 후속이다. T040 당시 hosted직접UI는 로그인으로 미수행이었고, T041에서는 공개 전환 후 팩/선수 등급·OVR 순서를 브라우저에서 확인했다. 실제 추첨 엔진/개봉 흐름 QA를 완료했다는 뜻은 아니다.

### T044 자산·준비 판정 작업의 현재 범위

사용자는 EFHub170588 이미지의 별도 고정과 직전 팩 준비 판정안을 승인하고 [실제 개봉 영상](https://www.youtube.com/watch?v=-OPQF_c4WN4)을 제공했다. 이 승인은 추첨 엔진·세션·리셋·2D공개흐름까지 이미 구현/검증됐다는 뜻이 아니다. 전체494회귀·앱타입/공식Worker빌드와기존공개API의원자적snapshot13팩data-ready검증을확인했다. 앱version11public배포·고정자산익명200/원본SHA일치·실제WPOTY구성150/11/139와이름/OVR없는일반이미지·가격버튼비활성·원격367파일일치/구현commit `f2ff13cf73d33633e6af95f28c3c5489a959a64c`의실제CI2건성공까지검증해한정된T044를완료했다.1363px화면은확인했으나360px/모바일실기기QA는미수행이며추첨엔진·세션/리셋·2D공개흐름완료와구분한다. 최종문서commit의미래SHA/CI를선행기록하지않으며상세근거는WORKPLAN T044를따른다.

지정 상세페이지는 한 번의403/error1010으로 실패했고 우회하지 않았다. 기존 raw의 정확한ID170588에 연결된 `https://efimg.com/efootballhub22/images/player_cards/170588_l.png`에서 원본PNG를 정상 확보·직접 시각확인했다.240×340 RGBA·114,522bytes·SHA256 `cdf8117dae82623d6408ad285a3c4cfae6b1c18703f896f044d585e52c29957c`이며 회색 실루엣과 원본 프레임/별만 있고 이미지 자체 이름·OVR·포지션은 없다. 고정 파일은 `services/efsimulator-app/public/images/simulator/standard-card-170588-cdf8117dae82.png`, 출처 설명은 같은 폴더 README다. 실행 중 원격 URL을 읽거나 자동 교체하지 않는다. StandardCard는 Player입력/텍스트오버레이가 없는 익명 표시 전용이며 A>0인 선택팩에 미리보기로 연결한다.

제공영상은 공개페이지와3분35초metadata를 확인했지만 실제player는 currentTime0/readyState0/buffered0/errornull이었다. 한 번 새로고침 뒤15초광고대기도0:00에 머물러 실제프레임을 관찰하지 못했다. T044당시에는단일/10회공개흐름을미확정으로두었다. 현재T017은최신첨부9장과사용자지시로2D화면계약을확정했으며이영상은3D후속참고로분리한다. 영상세부/정확시간/skip관찰완료를주장하지않는다. APK는아직없다.

## 1. 목표와 범위

첫 버전은 **팩 선택 → 추첨 → 카드 결과 → 잔여 명단·획득 내역 → 새로고침 후 이어하기**가 실제 사이트에서 일관되게 동작하도록 만든다. 기존 서버·private API relay·선수/팩 조회·공통 카드·정렬·자동 갱신을 재사용한다. 자동화의 실제 변경 전체 경로 관찰은 유지보수로 병행하며 제품 개발 전체의 새 선행 조건으로 삼지 않는다.

| 구분 | T017 계획 |
| --- | --- |
| 대상 | 공식 KR 게재 이력의 검증된 판매 중 회차와 종료 팩 체험. 판매 상태와 추첨 준비 상태를 별도로 표시 |
| 기능 | 팩별 진행 저장, 균등 비복원 단일/검증된 다회, 잔여 풀, 획득 기록, 수동 리셋·전체 소진 후 자동 새 회차 |
| 표시 | 기존 OVR·포지션·영문 이름 카드, 익명 일반 카드, 기본 2D 개봉·건너뛰기 |
| 저장 | 같은 기기·브라우저의 IndexedDB를 1차 설계안으로 사용 |
| 비용 | 사용자 확정 고정 가격: 단일100/10회900코인. API 값을 소비해 사용량 누적, 할인 없음 |
| 후속 | T018에서 같은 확정 결과를 재생하는 3D renderer와 모바일 성능 개선 |

실제 결제·게임 계정 연동·게임 API 조작은 범위에 없다. 구매 즉시 전원 지급 팩과 감독은 기존 정책대로 개봉 대상에서 제외한다. 종료 팩도 검증된 구성을 사용해 독립 체험 섹션에서 새 세션·추가 추첨을 허용한다. 종료를 실제 게임에서 구매 가능하다는 의미로 표시하지 않는다. 기기 간 동기화와 클라우드 복구는 후속 범위다.

## 2. 현재 구조와 재사용

T044전달시점의SimulatorPage는팩선택·구성조회·비활성버튼이었다. 현재T017에서는별도simulator-page/results와engine/random/session/storage를구현중이며실제검사·배포완료범위는WORKPLAN을따른다. 메뉴와 팩 선택은 전체 페이지 이동을 사용하므로 React 메모리만으로 진행을 보관하면 상세 방문·새로고침 때 사라진다. 저장·복구를 화면 연결보다 먼저 구현한다.

| 기존 경로: services/efsimulator-app/ 아래 | 재사용 책임 |
| --- | --- |
| lib/catalog-relay.mjs | 서버 전용 private API 인증·GET 전용 중계·관리/쓰기 차단 |
| app/components/catalog-data.tsx, lib/catalog-refresh.mjs | 동일 publication 전체 목록, 60초 갱신, 종료 시각 분류, 마지막 정상본 유지 |
| app/components/catalog-ui.tsx | Portrait·카드 글꼴·OVR/포지션/이름·겹침/크롭 |
| lib/catalog-order.mjs, lib/pack-preview.mjs | API타입 기반4등급·전역날짜/팩내OVR 표시 정렬·대표 카드 선택 |
| lib/simulator/prepare.mjs | 원자적catalog의 정확한회차·N/S/A·전량특수9필드/멤버십·API옵션 검증; 추첨/저장 없음 |
| app/components/standard-card.tsx, public/images/simulator/ | Player입력/오버레이 없는 고정 익명일반 카드와 출처/해시 |
| app/components/catalog-pages.tsx | 기존 페이지/팩 URL 연결, SimulatorPage를 별도 화면으로 분리할 출발점 |

설계는 **카탈로그 읽기 / 순수 추첨 엔진 / 세션 저장 / 결과 연출**을 분리한다. 서버가 검증된 팩 자료를 공급하고 개인 추첨은 브라우저에서 처리한다. 현행 API 선수9필드(`playerType` 포함)와 raw 원문을 유지한다. T040에서 명시 승인된 가공 팩 `drawOptions` 계약을 먼저 API에 전달하며 이후 추첨 엔진은 이 값을 사용한다. 표시용 카드 등급·정렬은 추첨 확률의 근거로 사용하지 않는다. 로컬 저장을 서버의 진위 검증이나 실제 계정 잔여 수 연동으로 표현하지 않는다.

## 3. 규칙 조사와 준비 판정

첫 작업 T017-A에서 API의 `drawOptions`를 소비하는 준비 판정과 고정 비용100/900·팩별 보장 근거·UX·세션 계약을 만든다. 공식 확률표의 초기 인원·표시 확률만으로 게임의 리셋·10회 추첨·가격이 확인됐다고 보지 않는다. 사용자가 별도로 확정한 균등 비복원·연습 리셋·소진 후 자동 새 회차는 simulatorPolicyVersion으로 기록한다. Epic이라는 이름만으로 비복원 규칙을 부여하지 않는다.

| 확인 항목 | 실행 조건 |
| --- | --- |
| 회차·초기 전체 N·특수 S | 정확한 saleId·전체 특수 문자열 ID·N/S/A 일치·중복/누락/음수 없음. 미분류라도 유효한 양의타입은 특수에 포함 |
| 확률·복원 방식 | 기본 연습 모드는 사용자 확정의 균등 비복원 정책 적용. 실제 게임 일치 표시는 해당 근거 확보 후 제공; 보장/가중 등 다른 모드는 별도 검증 |
| 단일·다회·마지막 수량 | T040 API drawOptions 지원 수량 사용. 사용자 정책에 따라 잔여10명 미만이면10회 비활성화·단일 소진, 묶음 축소/회차 이월 금지 |
| 리셋·횟수 제한 | 연습 리셋/소진 후 자동 새 회차는 사용자 결정. 실제 게임의 일일 제한·보장 카운터는 별도 확인하고 근거 없이 초기화하지 않음. T042 가격에 할인 카운터는 없음 |
| 가격·무료/티켓 | 기본 코인 가격은 단일100/10회900으로 확정. 할인 없음. 무료권/티켓 등 다른 모드는 별도 검토 |
| 판매·신선도 | 공식 종료 UTC·최신 채택 회차·실제 관측 근거·신선도 정책 연결 |

레지스트리의 제안 필드는 saleId, poolFingerprint, ruleVersion/ruleHash, 항목별 confirmed/unknown/not_applicable, 근거 URL·자료 해시·실제 관측 시각, 지원 모드, 비용/제한과 검토 상태다. 확인한 개별 회차에만 적용하고 새 회차로 자동 상속하지 않는다. 데이터 매핑 승인과 추첨 규칙 검토는 별개다.

T044의 `prepareSimulatorPack`은 같은 CatalogProvider 원자적snapshot의 manifest version과 live/archive/players를 입력받는다. 정확한 saleId가 하나만 있어야 하고 안전정수N/S/A·N=S+A·members와중첩선수/전역선수의전량9필드일치·고유문자열ID·현행T042 drawOptions/100·900을 확인한다. 로딩/조회오류·불완전snapshot·부분명단·필드충돌·잘못된타입/옵션은 고정reasonCodes와 ready:false다. 유효한 미분류 양의타입은 그대로특수로포함하고 일반은A집계만반환한다. 입력을변경하거나난수·실명일반ID·세션쓰기를생성하지않는다.

ready:true는 **데이터구성 준비만** 뜻한다. 제공자가 같은 publication의 모든 페이지를 검증해 하나의snapshot으로전달한다는 전제이며 임의version문자열을인증증거로보지않는다. 원출처최신관측·TTL·저장가능·보장조건·추첨엔진준비는별도계약이며 준비판정이이검증을대신하지않는다. 조회UI는유지하고 엔진이없는현재추첨버튼은비활성이다. 최종추첨가능상태는 데이터준비와후속엔진/세션계약을함께확인해결정한다.

신선도는 브라우저의 API 읽기 시각과 원출처 정상 관측 시각을 구분한다. T044 준비함수는 원출처TTL을 새로 추정하거나 관측시각을 수정하지 않는다. manifest 생성 시각이나 60초 화면 점검만으로 원출처 최신성을 보장하지 않는다. T017-A에서 기존 publication/receipt로 연결 가능한 관측 근거와 유효 기간을 명시하고 앱의 별도 검증 metadata로 전달 가능한지 확인한다. 부족하면 해당 준비 판정을 보류하고 필요한 최소 전달 방식을 설계한다. 실패를 새 정상 관측으로 만들거나 현행 API 계약 필드에 임의 값을 넣지 않는다. 종료 팩 체험은 검증해 동결한 회차 snapshot을 사용하므로 현재 판매의 관측 유효 기간을 그대로 적용해 영구 잠그지 않는다. 종료 확인만으로 충분하지 않으며 구성·회차·추첨 모드가 검증돼야 한다.

## 4. 추첨 엔진과 익명 일반 선수

T038 사용자 확정의 동일 슬롯 균등·비복원 모드부터 구현한다. 실제 게임과의 일치 여부와 연습 정책은 별도로 기록한다. 복원형·가중형·보장형은 별도 근거와 전이 계약으로 추가한다. 아래 수식과 예시는 비복원·균등 모드에 한정한다.

초기 전체 N, 검증된 전체 특수 슬롯 수 S, 익명 일반 A=N-S로 둔다. 특수 문자열 카드 ID 하나는 실제 슬롯 하나에 연결하고 일반은 A개 실명 객체 대신 정수 집계로 보관한다. 특수 누락·중복·회차 혼합·음수 A는 시작을 막는다.

잔여 특수 Sr와 일반 Ar를 더해 R=Sr+Ar로 계산한다. [0,R)에서 균등 정수를 뽑아 특수 구간이면 해당 ID를 제거하고 일반 구간이면 Ar을 1 줄인다. 특정 특수 카드 확률은 1/R, 일반 그룹 전체 확률은 Ar/R이다. 특수/일반을 50:50으로 선택하거나 일반 그룹을 한 장처럼 취급하지 않는다.

설명용 예시: N=150, S=3이면 A=147이다. 초기 특정 특수 카드는 1/150, 특수 전체는 3/150, 일반 전체는 147/150이다. 일반 1개가 나온 다음은 R=149·Ar=146이다. 반복되는 일반 결과는 서로 다른 익명 슬롯을 소비한 것이며 특수 ID 중복과 다르다. 이 수치는 실제 현재 팩의 구성이나 규칙을 뜻하지 않는다.

검증된 다회 모드는 매 결과 뒤 갱신된 잔여 풀에서 순차 계산하고 전체 묶음을 한 command로 저장한다. 범위 초과를 몰래 잘라 처리하지 않는다. C075에 따라 잔여10명 미만에서는 단일만 허용하며 10회 묶음의 부분 실행·다음 회차 이월은 지원하지 않는다.

엔진은 DOM·네트워크·저장소를 모르는 순수 모듈로 구성하고 난수 공급기를 주입한다. 실제 브라우저는 Web Crypto 난수와 rejection sampling으로 편향 없는 정수를 만든다. 난수 기능이 없으면 임의 대체하지 않고 실행 불가를 안내한다. 테스트는 고정 난수로 경계를 재현한다. 클릭 시점·카드 표시 순서·연출 길이·이미지 로딩으로 확률을 가감하지 않는다.

매 성공 전이 뒤 검사할 불변식은 다음과 같다. 수동 리셋과 자동 새 회차에서는 완료/이전 roundId의 불변식을 먼저 검증하고 새 회차를 따로 검증한다. 현재 라운드와 전체 누적 통계를 분리한다.

- 초기 N = 현재 라운드 획득 수 + 잔여 수
- 잔여 수 = 잔여 특수 ID 수 + 잔여 익명 일반 수
- 초기 S = 획득 특수 + 잔여 특수, 초기 A = 획득 일반 + 잔여 일반
- 같은 비복원 라운드 특수 ID 중복 0, 인원은 모두 0 이상의 안전 정수

## 5. 세션 저장·복구

1차안은 팩별 활성 세션 1개와 이전 라운드 기록을 IndexedDB에 저장한다. schema 버전과 검증된 migration을 둔다. 이전 자료를 읽지 못하면 삭제·자동 초기화하지 않고 보존·오류 안내·새 세션 선택을 제공한다. 저장소 불가 시 기본은 추첨 잠금이며 무통보 메모리 모드 전환은 넣지 않는다.

| 묶음 | 제안 필드 |
| --- | --- |
| 식별 | schemaVersion, sessionId, saleId, roundId, stateRevision |
| 고정 입력 | 시작 publicationId, poolFingerprint, ruleVersion/ruleHash, simulatorPolicyVersion, 초기 N/S/A, 정확한 특수 ID·최소 표시 snapshot |
| 현재 진행 | remainingSpecialIds, remainingStandardCount, 현재 라운드 횟수·확인된 가상 비용 |
| 결과 기록 | commandId, batchId, 순서·확정 결과·라운드·미확인 결과 batch |
| 관리 | createdAt, updatedAt, 마지막 정상 확인, 제한 카운터·리셋 내역 |

poolFingerprint는 saleId·N·정확한 특수 ID 집합 등 확률 입력을 정규화해 계산한다. 표시 정렬·이름/이미지 보정만으로 풀을 바꾸지 않는다. 시작 publication은 근거로 보관하되 글로벌 publication 변경만으로 세션을 폐기하지 않는다. 세션을 API에 역발행하지 않는다.

추첨 command는 다음 순서로 처리한다.

1. 회차·규칙·판매 상태에 맞는 근거·저장 가능 여부를 확인한다. 판매 종료만으로 추첨을 거부하지 않고 종료 팩 체험으로 분류한다. 페이지 즉시 실행 잠금을 잡고 commandId·expected revision을 만든다.
2. IndexedDB 단일 readwrite 트랜잭션에서 최신 세션을 읽는다. 이미 저장된 commandId이면 기존 결과를 반환한다. revision 충돌이면 추첨하지 않고 최신 상태를 읽게 한다.
3. 트랜잭션 대기 중 판매 종료 경계를 넘었으면 체험 모드로 상태를 재분류한다. 구성/규칙 변경은 실제 전이·쓰기 직전에도 확인한다. 엔진으로 묶음 결과를 계산하고 불변식을 확인한다. 잔여 풀·획득 기록·revision·commandId·미확인 batch를 같은 트랜잭션에 저장한다. 전체 소진이면 완료 회차·마지막 batch·자동 리셋 사유(exhausted)·전체 풀이 준비된 다음 roundId도 함께 기록하며 추가 난수 추첨/코인 사용은 하지 않는다. 네트워크·애니메이션 대기를 트랜잭션에 넣지 않는다.
4. 저장 완료 확인 뒤 결과를 공개하고 연출한다. 완료·건너뛰기는 확인 상태만 바꾸며 다시 추첨하지 않는다.

다중 탭 정확성은 트랜잭션과 expected revision으로 보호한다. BroadcastChannel은 새 상태 안내만 담당한다. 같은 동작의 재시도는 같은 commandId를 쓰며 페이지 잠금은 연속 클릭을 합친다.

저장이 명확히 abort되면 이전 정상 풀을 유지하고 성공 결과를 표시하지 않는다. 완료 여부가 불명확하면 commandId를 다시 조회해 확정 여부부터 확인하고 새 난수로 실행하지 않는다. 저장 후 화면이 닫히면 다음 진입에서 미확인 batch를 복원한다. 브라우저 저장 삭제·기기 변경까지 복구된다고 표시하지 않는다. snapshot은 세션 단위로 공유하고 batch에는 결과 참조만 두며 용량 부족 시 기존 기록을 무통보 삭제하지 않는다.

리셋은 T038 사용자 요청에 따라 해당 팩만 제공한다. 확인창에 복원 범위를 설명하고 새 roundId로 풀을 복원하되 과거 결과·전체 누적 사용량·추첨 수를 보존한다. resetReason은 manual/exhausted를 구분한다. T042 가격은 회차와 무관하게 단일100/10회900으로 고정하며 할인 카운터를 두지 않는다. 별도로 검토한 보장 카운터가 있으면 적용 범위에 맞춰 처리한다. 결과 저장/개봉 처리 중 리셋은 잠그며 reset command도 expected revision·commandId로 중복을 방지한다. 기록 삭제는 연습 리셋과 분리한다.

## 6. 자동 갱신·종료·장애 정책

| 상황 | 처리 계획 |
| --- | --- |
| 다른 팩 갱신으로 publication만 변경 | 진행 유지, 선택 팩의 구성·규칙·현재성만 재대조 |
| 이름·이미지 등 표시값 변경 | 확률 입력과 분리, 과거 결과 snapshot 유지 |
| 같은 회차 N·특수 ID·규칙/시뮬레이터 정책 버전 변경 | 이전 기록 보존, 추가 추첨 보류, 새 구성 세션 안내. 세대 혼합 금지 |
| 같은 제목 새 회차 | 새 saleId의 독립 세션. 잔여 풀 자동 이관 금지 |
| 종료 UTC·공식 종료 확인 | 검증된 종료 팩 체험 섹션으로 이동, 같은 세션/잔여/기록 유지, 새 세션·추가 추첨 허용 |
| 종료 시각만 수정 | 판매 섹션과 배지만 재분류. 풀·진행·가상 비용을 재생성하지 않음 |
| API 오류·로그인 만료·신선도 불충족 | 기록 유지, 새 추첨 보류·재시도. 빈 응답을 종료 근거로 삼지 않음 |
| 저장 손상·이전 schema 미지원 | 원자료 보존, 오류 안내·새 세션 선택 |

카탈로그 갱신과 세션 저장소를 분리한다. 팩 자격은 command 직전과 탭 복귀 시 확인한다. 판매 종료는 체험 모드 전환이며 중단/리셋 사유가 아니다. 구성·규칙이 유효할 때 원자적으로 확정된 batch는 연출 중 종료되어도 취소하지 않는다. 브라우저 시각은 개인 시뮬레이션 안내용이며 서버의 강제 계정 검증으로 표현하지 않는다.

## 7. 화면과 2D 연출

기존 /simulator?pack=<saleId>와 선수·팩 상세의 진입 링크를 재사용한다. 팩을 바꾸면 저장된 해당 팩 진행을 복원한다.

| 화면 영역 | 제공 내용 |
| --- | --- |
| 팩 선택 | 판매 중인 선수팩 / 판매 종료 팩 체험을 독립 섹션으로 표시하고 각 섹션 안 Epic/Show Time 우선·그룹별 최신순, 준비 상태·지원 모드 유지 |
| 진행 요약 | 초기/잔여 전체·특수·일반, 회차 번호·현재/누적 추첨 수·가상 코인 사용량. 단일100/10회900의 확정 사용량을 회차/누적으로 구분 |
| 조작 | 확인된 단일/묶음 버튼만 생성,구입확인창생략·저장중잠금·실행불가이유 |
| 결과 | 단일중앙1장/정확히10장반응형그리드·익명일반고정카드·계속하기,모션중건너뛰기는동일batch |
| 잔여 명단 | 특수카드개별표시·현재회차획득ID만dim·일반잔여수만집계. 일반정보에공통그림1장/잔여수·각일반결과에공통이미지표시·실제일반이름/ID생성금지 |
| 획득 내역 | 라운드·묶음별 순서, 완료/중간 수동 리셋 구분, 기록 이어보기·팩 리셋 |

페이지 상태는 준비/확인 중 → 추첨 가능 → 저장 중 → 개봉 연출 → 결과 확인이다. 구성 변경·저장 실패는 별도 실행 불가 상태로 둔다. 종료 팩 체험은 실행 가능한 별도 판매 상태이며, 소진 후에는 완료 결과와 다음 회차 준비를 함께 표시한다. 버튼에는 개발용 해시를 섞지 않고 출처·버전·로컬 저장 범위는 보조 정보에서 확인하게 한다.

2D renderer는 확정 batch만 입력받아 팩 등장·카드 공개·묶음 결과를 재생한다. 특수/일반 모두 결과에 맞게 표시한다. 기존 Portrait로 OVR·포지션·영문 이름과 카드 가림을 유지한다. 익명 일반은 별도 결과 타입과 T044의 고정 StandardCard로 표시하고 Player API 엔티티로 위장하지 않는다.170588은 이미지출처ID이며 일반선수실체나팩포함ID로사용하지않는다.

최신C084~C087과첨부9장의정지화면으로2D계약을확정했다. 짧은자체2D장면의시간은앱연출선택이며실제3D개봉시간을측정했다고주장하지않는다. 구입확인창은생략하고단일중앙1/10명반응형그리드와계속을제공한다. 영상미재생은등급별3D/skip도착화면미관찰로기록하며2D계약을다시막는게이트로사용하지않는다. 3D 시각 장면 자체는 T018로 남긴다. 건너뛰기·동작 줄이기는 즉시 결과를 보여준다. 키보드·초점 이동·스크린리더 결과 안내·색상 이외 구분을 지원한다. v1 기본은 무음이며 후속 음향에는 음소거를 제공한다. 이미지/연출 실패는 정적 카드·텍스트로 전환하고 결과·인원을 바꾸지 않는다.

## 8. 모듈과 작업 순서

아래는T017모듈책임과실행순서다. 구현중인파일은FILE_SYNC에등록하며검사·배포성공은WORKPLAN의실제결과를따른다. 별도규칙레지스트리를만들어API옵션/가격을중복정의하지않는다.

| 제안 경로: services/efsimulator-app/ 아래 | 책임·우선순위 |
| --- | --- |
| lib/simulator/session.mjs의policyVersion/검증snapshot | API옵션100/900과사용자균등비복원·리셋정책을구분해고정;실제게임보장형미지원, P0 |
| lib/simulator/prepare.mjs | T044의동일snapshot·N/S/A·전량명단/9필드·현행옵션data-ready, P0 |
| lib/simulator/engine.mjs, random.mjs | 순수 전이·편향 없는 난수, P0 |
| lib/simulator/session.mjs, storage.mjs | schema·migration·원자적 command·복구, P0 |
| app/components/simulator-page.tsx | 선택·요약·추첨·기록 UI, P1 |
| app/components/simulator-results.tsx | 확정 결과·2D·건너뛰기·접근성, P1 |
| tests/simulator-*.test.mjs | 규칙·엔진·저장·경계·통합 회귀, P0 |

| 순서 | 산출물 | 다음 단계로 넘어갈 기준 |
| --- | --- | --- |
| T017-A 규칙·계약 | 한 팩 이상 근거 레지스트리·준비/신선도 정책·세션 schema·화면 상태 | 지원 모드와 미확인 범위 명시·입력 재현 가능 |
| T017-B 엔진 | 준비 검증·익명 일반·검증된 단일/다회·난수 | 불변식·경계·분포 점검 기준 통과 |
| T017-C 저장 | IndexedDB·revision·commandId·라운드·미확인 결과 복구 | 새로고침·전체 이동·다중 탭·실패 검증 |
| T017-D 기본 화면 | 판매 중/종료 체험 섹션·추첨·잔여 풀·획득 기록·수동/소진 리셋 | 한 팩 전체 흐름·기존 조회/카드 회귀 확인 |
| T017-E 2D·접근성 | 개봉·건너뛰기·정적 대체·동작 줄이기 | 연출 전후 결과 불변·모바일/키보드 확인 |
| T017-F 검토 배포 | 현재public인동일실제앱audience유지·직접UIQA·문서/근거·GitHub | 배포 소스 일치·실제 흐름과 복구 결과 기록 |

작업 묶음은 순서·검증 단위이며 시간 추정이나 완료 약속이 아니다. 한 팩의 기능을 먼저 검토한 뒤 검증된 다른 모드를 확장한다. 매 묶음은 관련 파일 검토·필요 검사 → 같은 api-server-setup 정상 커밋/push → 원격 내용·실제 CI 확인까지 수행한다. GitHub 반영과 Sites 배포는 별개다.

## 9. 검증과 완료 기준

잔여11명에서10회 후1명만 남는 경우, 잔여10명의 정확한 소진/새 회차 준비, 잔여9명/1명의10회 거절·단일 소진을 경계 검증에 포함한다.

고정 난수로 N=1·전부 일반·전부 특수·A=0·잔여0·범위 초과·음수/분수·중복 ID·unknown·새 회차를 재현한다. 작은 풀은 모든 인덱스를 확인하고 rejection sampling 경계도 검사한다. 분포 점검은 결정적 검증과 분리한다. 예시 기준은 N=10/S=2의 독립 초기 풀 100,000회에서 특수 비율0.20의 5표준편차이며 실제 채택한 표본·오차·결과를 기록한다. 표본 통과를 모든 확률의 증명으로 부르거나 실패를 숨기려 재실행하지 않는다.

| 검증 축 | 수용 기준 |
| --- | --- |
| 확률·풀 | 인원 불변식·비복원 특수 중복0·음수0·일반 가중·정렬 영향 없음 |
| 원자성 | 추첨/리셋 command 중복 반영0·다회 중간 부분 차감0·오래된 revision 거절·마지막 batch와 다음 회차를 같은 전이로 보존 |
| 복구 | 새로고침·전체 이동·탭 종료·건너뛰기 후 결과/잔여 동일 |
| 갱신 | 무관한 publication 변경은 진행 유지·같은 팩 변경은 세대 혼합 금지 |
| 종료·장애 | 정확한 종료 경계에서 섹션 이동/진행 유지·검증된 종료 체험 허용·last-good 보존·저장/근거/로그인 오류 구분 |
| 화면 | 판매 중/종료 체험을 명확히 구분·코인 잔액 제한 없음·기존 검색/필터·상세 링크·정렬·카드 유지, 360px 모바일·PC·키보드·동작 줄이기 |
| 성능 | 추첨 시 원출처 요청0·매 draw 전량 재조회0·일반 실명 객체 생성0·관련 세션만 읽기 |
| 전달 | 관리/기존 회귀·타입/Worker 빌드·현재public인동일실제앱배포·원격소스/조회·직접UI확인 |

snapshot 기반 브라우저 QA와 로그인한 실제 hosted UI 클릭 검증은 구분한다. 실제 접근이 막히면 그 항목을 미수행으로 남긴다. 최소 한 검증 팩에서 선택 → 추첨 → 결과 → 잔여/기록 → 새로고침 복원까지 확인해야 검토판 완료다.

## 10. T018과 이번 작업의 경계

T018의 현재 실행은 C099~C100으로 확보한 IPA의 개봉 관련 네이티브 코드·모델·텍스처·애니메이션·음향과 분리 데이터 의존성의 정적 분석이다. efootxi 수정 구성과 기존 게임 코드/자산의 관계를 구분하고 PAK·IoStore·CPK의 정확한 형식·압축/암호화와 도구 지원을 확인한다. 확인/추정/미확인과 포함·판독·표본 추출·변환·실제 재생 가능을 결과별로 기록한다. 이 단계의 첫 산출물은 구성/컨테이너 식별표·개봉 함수/참조 자산 지도·추가 자료 목록이며 웹3D 구현/배포는 이번 승인의 범위가 아니다.

C102는 위 T018에 선수별 ID/3D 모델·모션 대응·추출·대표 결합 검증·대상 확대 계획을 추가했고 C103/C104 계속 지시로 실제 분석/표본 추출과독립기술결합을진행했다. 상세 기준과 현재 P1~P3부분진행/P4진단증거추가·native완성미확인/P5미착수는 상단의 선수별 추출 계획 P1~P5를 따른다. 기존 일반적인 개봉 자산 분석이나 PSA 표본 성공을 선수별 완성 모델/고유 모션 확보 완료로 바꾸지 않는다.

후속 구현은 분석 결과에 따라 같은 확정 결과·세션을 받아 3D renderer를 추가한다. 3D 실패로 다시 추첨하지 않는다. 자체 제작/허용 라이선스 자산의 작은 시제품부터 모델/텍스처 압축·공유·지연 로딩·LOD·해제를 검증한다. 저사양 모바일 프레임·메모리·다운로드·첫 결과·발열을 측정하고 WebGL 미지원·컨텍스트 손실·느린 연결·동작 줄이기는 2D/텍스트로 전환한다. 자산 출처·사용 범위·크기·해시는 실제 제작 때 등록한다. 호스팅 이전은 실측 한도·비용을 대조한 뒤 판단한다. 이들 후속 구현·성능/재생 검증은 현재 미수행이다.

기준 문서는 [데이터 계약](CATALOG_DATA_CONTRACT.md), [작업 계획](WORKPLAN.md), [로드맵](ROADMAP.md), [배포 절차](DEPLOYMENT.md), [자동 갱신 운영](AUTOMATION.md)이다. T037은 최초 계획을 작성했다. T038은 사용자 결정·API 필드 감사·공식 근거·영상 조사 한계를 계획/관리 문서에 반영한다. T038 당시 제품 코드·운영 데이터·예약·사이트 배포는 변경하지 않았다. T040의 가공/API 옵션 반영·배포는 WORKPLAN의 실제 검증 결과를 따르며 추첨 엔진/저장/개봉 연출 구현 완료와 구분한다. 영상 직접 분석과 보장 조건 근거는 미완료다. 기본 코인 가격은 T042 사용자 결정으로 단일100/10회900이며 할인은 적용하지 않는다.
