# 새로고침 시 글 기본 폰트 선표시 수정

## 원인

LogEditor의 pageExtras와 PublicLog의 extras가 null로 초기화되어 서버 렌더와 최초 hydration에서 `data-font="pretendard"`였다. useEffect가 extras API를 읽고 나서야 저장된 폰트로 변경했다. workspace aggregate RPC와 publication log RPC도 typography가 추가되기 전 명세라 font_family를 포함하지 않았다.

## 변경

- 승인된 workspace SSR에서 기존 aggregate RPC와 font_family 단일 컬럼 RLS SELECT를 병렬 호출. 승인/페이지 접근 검증을 유지하고 최초 page prop에 정상화한 font_family를 포함. DB 오류를 정상 기본 폰트 설정으로 은폐하지 않음. 추가 admin 접근/SQL 변경 없이 구현.
- LogEditor 최초 data-font는 서버에서 받은 page.font_family를 사용. 기존 extras API가 완료되면 현재 설정을 계속 반영.
- publication context의 기존 page SELECT에 font_family 추가. 공개/암호 게시 열람 gate를 통과한 뒤만 PublicLog.initialFontFamily로 전달. 최초 SSR부터 해당 글 폰트를 사용하며 기존 extras/BGM 비동기 조회는 유지. 비인가 페이지에 font preload를 출력하지 않음.
- 서로 다른 페이지/게시 token 이동 시 component key로 상태를 분리하여 이전 글 extras가 새 글의 최초 typography를 덮지 않게 함.
- 기존 CSS에서 직접 파일 주소가 확인되는 고운 돋움/고운 바탕/리디바탕/내추럴 산스 regular face만 선택 폰트 preload. CORS anonymous 및 실제 woff/woff2 MIME 사용. 모든 글 폰트를 일괄 다운로드하지 않고 Google Fonts의 subset URL을 추측하지 않음.
- 손님 화면은 기존부터 extras와 entries를 같은 응답으로 수신한 뒤 내용을 표시하므로 설정값 null → 기본 폰트 선표시 경로 없음. 시스템 폰트/버튼/사용자 Content CSS 지정 font-family는 수정하지 않음.

## 검증/범위

전체 테스트 228개·production build·ESLint 통과. 7종 폰트 각각 실제 PublicLog 서버 렌더 data-font, workspace RLS font 조회/페이지 prop, 공개 gate 후 typography 전달, preload와 실제 CSS asset URL 일치/선택 폰트만 요청을 회귀 검증했다. 실제 로그인 화면 cold-cache refresh/network 타이밍은 아직 미검증.

수정한 것은 **설정값을 늦게 읽어서 기본 폰트를 먼저 선택하는 현상**이다. CDN에서 웹폰트 파일 자체가 아직 로드되지 않은 cold-cache 상황의 font-display:swap 대체 서체 표시는 완전히 없어진다고 주장하지 않는다. preload로 직접 파일 face의 다운로드 시작을 앞당기되 콘텐츠를 숨기거나 전체 시스템 font-display 정책을 변경하지 않는다. CDN 지연/차단 때 읽을 수 있는 fallback도 유지한다. 완전한 무교체 표시가 필요하면 self-hosted font 또는 폰트 로딩 중 본문 비표시 정책을 별도 결정해야 한다.

DB SQL·로그 재가져오기 불필요. 가로 폭 정렬/아바타 외부 배치는 이번 수정에 포함하지 않는다.
