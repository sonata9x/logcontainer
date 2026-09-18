# 관리 / BGM / 휴지통 및 UI 정리

작업 브랜치: `fix/share-bgm-responsive`. 이전 공유·BGM 반응형 수정 위에 추가하며 main은 아직 병합하지 않음.

## 변경

- 계정 설정 포인트색은 내부 패딩·브라우저 테두리를 제거한 38px 정사각형 컬러칩. HEX 입력 및 검증은 유지.
- 일반 버튼은 inline-flex + 중앙 정렬 + 아이콘 고정 크기. 보조 버튼은 옅은 회색, 툴바는 투명, 주요 실행은 포인트색, 영구 삭제 확인은 위험색. 키보드 포커스 표시 유지.
- 페이지 개요는 배경 없이 전체 회색 1px 테두리 + 6px 모서리. Roll20 유저 Content CSS와 본문 레이아웃은 변경하지 않음.
- 새 로그/다시 가져오기 플랫폼 선택 아래 플랫폼별 도움말. PC pointer hover, 키보드 focus, 모바일 tap 지원. Roll20은 전체 로그 → 한 페이지 표시 → F12/Elements → textchatcontainer 요소 전체 Copy element/outerHTML → 붙여넣기로 안내. 코코포리아 미지원, 타코야키 박스 HTML 내보내기 후 업로드 안내. 안내 문구의 전체 로그/DevTools 절차는 [Roll20 공식 도움말](https://help.roll20.net/hc/en-us/articles/360039675093-Text-Chat), [Roll20 Chat Archive 안내](https://wiki.roll20.net/Chat_Archive), [Chrome DevTools DOM 안내](https://developer.chrome.com/docs/devtools/dom)를 확인했으며 컨테이너 이름은 사용자 제공 원본을 기준으로 함.
- 사이트 관리자에게만 `관리 → 계정 / BGM`. 기존 승인/거절은 계정 화면에 그대로 유지.
- BGM 화면은 사이트 전체 MP3/YouTube 목록, 소유자 표시명, 등록 파일 크기 합계, 제목 검색, 100개 단위 페이지 이동 제공. 원본 파일 경로는 목록 응답에 포함하지 않음.
- 페이지 대기/블록 BGM(휴지통 여부 포함), 플레이리스트/사용자, 보관함/사용자를 표시. 보관함만 남았거나 연결이 없는 자산도 구분.
- 영구 삭제는 제목 입력 확인. 사용 중인 곡도 관리자가 명시적으로 확인하면 모든 사용자의 참조와 실제 Storage 파일을 제거함. 삭제된 곡의 플레이리스트 컨테이너는 유지.
- 발급된 signed upload target 재사용으로 인한 orphan 방지를 위해 MP3는 생성 후 24시간 동안 삭제 보호. YouTube는 이 제한 없음.
- 삭제 준비 RPC가 자산 잠금 → tombstone → 모든 참조 삭제를 단일 트랜잭션으로 수행. 새 참조는 SHARE 잠금 및 live/ready 검사로 막음. Storage 오류 시 tombstone/경로가 남아 재시도 가능. 원본 소유자/파일 경로/생성 시각 불변 및 삭제 자산 재활성화 금지.
- 사이드바 휴지통은 포털 팝업으로 변경, 개별 복원/삭제 및 휴지통 비우기 제공. 소유한 삭제 리소스만 DB에서 삭제하며 다른 소유자의 하위 리소스는 유지.
- 로그 정보의 메시지 휴지통도 팝업으로 변경. 복원은 기존 편집 권한 유지, 영구 비우기는 최초 소유자만 가능. 비우기 시 메시지 revision도 제거하지만 HTML 원본 백업은 유지.
- 페이지 영구 삭제의 private 핸드아웃/세션 카드/원본·세대 아카이브/가져오기 임시 파일은 DB cascade 전에 Storage 정리 대기열에 경로를 보존. 즉시 최대 100개 정리 후 기존 인증된 일일 purge job에서 나머지/실패 건 재시도. 공개 content-addressed 아바타 파일은 공유 가능하므로 이 정리 대상에 포함하지 않음.
- 부모 로그가 cascade 삭제된 경우 change event의 FK 오류가 발생하지 않도록 emitter 보완. 살아 있는 로그의 개별 메시지 삭제 이벤트는 유지.
- 중첩 팝업에서 Escape가 바깥 팝업까지 닫지 않도록 최상위 close handler만 실행.
- 기존 purge의 BGM 참조 조회/Storage 오류를 성공으로 간주하고 DB 경로를 지우지 않도록 수정.

## 적용

기존 Supabase 프로젝트는 `supabase/migrations/202609180001_admin_bgm_and_trash.sql`을 SQL Editor에서 전체 실행. 새 프로젝트는 변경된 schema.sql 사용. 운영 DB에는 이번 세션에서 실행하지 않음.

`CRON_SECRET` 및 기존 Vercel 일일 `/api/internal/purge` 설정 유지. Storage cleanup queue는 authenticated/anon 직접 접근 금지 및 service_role 전용.

## 검증

- 기존 테스트와 신규 로컬 PostgreSQL 테스트 총 188개 실행. PGlite는 dev dependency이며 운영 코드에는 포함하지 않음.
- 실제 PostgreSQL 엔진에서 migration 2회 실행, 관리자/일반 계정/미인증/비활성 계정 권한, 전체 참조 목록, 삭제 준비/재시도/새 참조 차단, 업로드 보호/경로 불변, 다른 소유자 보존, Storage 경로 cascade 보존, 메시지 revision 삭제, 삭제 이벤트, 206곡 페이지 이동, queue 직접 접근 금지 검증.
- Storage helper는 실패 시 queue 행 유지 및 파일 삭제 후 metadata 제거 순서를 mock으로 검증.
- lint/build 및 whitespace 검사 수행.
- 의존성 설치에서 발견한 기존 sharp/js-yaml 보안 경고는 호환 패치 업데이트 후 npm audit 0건 확인.

## 남은 검증

이번 세션에는 GPT 사이드탭 브라우저 제어 도구가 제공되지 않아 실제 브라우저의 컬러칩/폰트/모바일/팝업 디자인은 미검증. 운영 BGM 파일이나 사용자 리소스는 삭제하지 않았으며 실제 Supabase Storage 삭제 통합 검증도 아직 하지 않음. DB migration 적용 후 작업 브랜치 preview에서 더미 자산으로 확인한 다음 main 병합 권장.
