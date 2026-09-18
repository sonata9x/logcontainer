# Roll20 복사 로그 공백 및 메시지 BGM 위치 교정

## 실제 원인 및 조치

첨부 원본(약 1.26MB)을 로컬에서 read-only 분석했다. 예시 강조 문구 메시지와 판정 요청 메시지 모두 CSS 내용 뒤에 탭 9개 + `div.flyout#menu…`가 붙어 있었다. flyout은 Roll20 메시지 메뉴 UI인데 이전 파서가 canonical Rich에 클래스 없는 빈 div로 저장했다. 이 div가 inline 콘텐츠를 block-flow로 바꾸고, 후미 탭이 경계 whitespace trim을 통과하지 못해 `white-space: pre-wrap`에서 공백/줄바꿈 공간을 만들었다.

- 원본 DOM header/UI 제거 selector에 `.flyout` 추가. semantic 비교 및 block parsing에 동일하게 적용.
- 직접 Rich 파싱에서도 flyout 메뉴 전체를 제거하여 메뉴 버튼 글자가 본문으로 유입되지 않도록 함.
- flyout이 있고 사용자 CSS가 있는 rendered 메시지의 마지막 root-level 순수 whitespace text node 중 탭이 포함된 것만 제거. 일반 텍스트/요소 내부의 tab·pre·br·스타일 지정 spacer는 보존. 사용자 CSS는 재작성하지 않음.
- 기존 저장된 v2 데이터는 renderer에서 root-level 빈 unstyled div의 무내용 shell을 제외한 뒤 경계 whitespace를 정리하여 표시. canonical/original snapshot/revision을 수정하지 않으며 기존 저장 노드 ID를 유지. 원본 archive도 변경 없음. 새 import에서는 불필요한 flyout/tabs 자체가 저장되지 않음.

실제 원본 메시지 DOM 1,619개 → 기존 hidden filter 제거 648개 → logical message 971개로 수정 전후 동일. 구조적 중복 0개. 두 문제 예시의 실제 canonical/render 결과: trailing tabs 없음, 빈 flyout div 없음, 불필요한 block-flow 없음. 판정 요청 Rich root nodes 5→3, 강조 문구 3→1. 사용자 전문 로그/외부 이미지 주소는 fixture나 repo에 복사하지 않고 최소 익명 재현 케이스만 테스트로 추가했다.

## 연결된 재생 버튼

고정 top 13px 대신 `top: 50%; transform: translateY(-50%)` 적용. `EntryPlaybackAnchor`가 해당 메시지와 버튼만 감싸므로 추가 메시지 form·손님 편집 버튼 영역은 중앙 계산에서 제외된다. 이미지 로딩/내용 변경 시 CSS가 실제 메시지 높이 기준으로 자동 재정렬. entry_id 귀속/재정렬 동작 유지. paint containment는 본문에만 적용해 외부 버튼이 잘리지 않음.

좁은 편집 화면의 숨김 규칙 유지. 좁은 게시 화면에서는 버튼을 숨기지 않고 메시지 왼쪽 34px gutter에 표시하여 중앙 정렬과 비겹침을 유지한다(기존 상단 버튼 줄 대체). 가로 폭을 이미지와 본문 사이에서 어떻게 정렬할지는 아바타 처리에 관한 사용자 확인을 기다리는 별도 항목이며 이번 패치로 임의 변경하지 않았다.

## 검증 및 남은 확인

전체 테스트 224개, production build, ESLint 통과. parser UI/tabs 제거·CSS/break/pre 보존·immutable legacy 렌더 호환·3개 화면의 공통 BGM anchor·게시 mobile gutter·편집 숨김 규칙을 검증했다. 첨부 실제 HTML 전체도 로컬 parser 및 서버 렌더로 재검증했다.

실제 로그인 화면에서의 픽셀 비교·모바일 터치 확인은 미실시. 서버 렌더 결과가 정상이라는 사실을 모든 시각적 문제 해결로 확대하지 않는다. 기존 로그의 immutable original snapshot을 깨끗한 데이터로 덮어쓰거나 서버에서 재가져오기를 실행하지 않았다. 저장된 canonical도 정리하려면 Owner 재가져오기를 별도로 선택해야 하지만 현재 두 예시의 표시 호환에는 필수가 아니다. 신규 SQL 불필요.

이번 원본에서 기존 style sanitizer의 box-shadow 제외 및 일부 invalid CSS 경고도 확인했으나 공백 문제와 별개이므로 해당 CSS 허용 정책은 변경하지 않았다.
