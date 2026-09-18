# 로그 메시지 간격 통일

- 편집·게시·손님 화면의 `log-timeline`에서 인접 메시지 바깥 간격을 기본 12px로 통일한다.
- 앞뒤가 모두 동일한 이름의 일반 대화이면 바깥 간격 0px. v2는 dialogue + Text/InlineRoll/inline-only Rich(색상·배지 포함)에 해당하며, legacy는 raw HTML 없는 dialogue에만 적용한다. 화자 없는 메시지, 설명, 주사위 표, 이미지, block-flow Rich CSS 패널은 기본 간격 유지.
- 후속 스크린샷의 간격 원인: 아바타가 없어도 32px 슬롯 높이 + 위아래 padding 10px + 바깥 간격 4px로 한 줄 메시지가 최소 46px 차지했다. compact v2 대화에만 빈 아바타 슬롯 높이 0, 메시지 min-height 0, 위아래 padding 각각 1px 적용. 왼쪽 32px 화자 열과 실제 아바타 크기는 유지하며 다른 블록 높이/간격은 변경하지 않음.
- 판정 표 뒤에 같은 화자 대화가 있어도 12px 유지. 서비스가 넣던 판정 표/이미지의 시작·끝 경계 margin은 제거해 메시지마다 달라지는 중복 여백을 없앰. 내부에 섞인 콘텐츠의 경계 아닌 margin은 그대로.
- 기존 CSS 블록 전용 6px margin 및 원본 continuation 전용 padding 차이를 제거. canonical document와 원본 presentation은 변경하지 않고 화자/아바타/날짜 표시 규칙도 유지.
- 현재 보이는 스트림에서 실제 이전 메시지를 비교한다. 드래그 재정렬, 내용 변경, 다음 페이지 로드 시 재계산하므로 원본 import 순서의 continuation 값을 간격 판단에 사용하지 않는다.
- 사용자 Rich CSS 내부 padding/margin/top/bottom/line-height/명시적 줄바꿈 등은 변경하지 않음. 따라서 바깥 메시지 간격은 통일되지만 작성자가 콘텐츠 내부에 준 공백이나 normal flow 밖으로 옮긴 요소까지 동일한 시각적 거리로 강제하지 않는다. 이 부분은 원본 디자인 보존 범위다.

검증: 후속 compact 높이 교정 포함 전체 테스트 219개·production build·ESLint 통과. fixture 기반 카드/CSS/이미지의 기본 간격, inline 색상 대화의 compact 적용, 이름/상태/스트림 경계/재정렬 기준, 3개 화면의 공통 규칙 및 compact에서만 빈 아바타 높이 제거를 검증했다. 실제 로그인 화면의 픽셀 단위 시각 비교는 수행하지 않았다. DB 변경 및 로그 재가져오기 불필요.
