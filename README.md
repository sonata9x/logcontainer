# TRPG Workspace

노션식 워크스페이스에서 TRPG 로그를 백업하고 공동 편집한 뒤, 선택한 로그 한 페이지만 독립 링크로 게시하는 웹 앱입니다.

기존 `trpghome`, `logedit`, `lninnawari`는 참조 구현으로 유지하며 이 디렉터리는 새 코드베이스로 동작합니다.

기존 `trpghome`의 Supabase와는 테이블 이름이 겹치므로 실제 연결 시에는 새 Supabase 프로젝트를 사용합니다.

## 로컬 실행

1. `.env.example`을 `.env.local`로 복사하고 Supabase 값을 입력합니다.
2. 새 Supabase 프로젝트는 SQL Editor에서 `supabase/schema.sql`을 실행합니다. 기존 프로젝트는 `supabase/migrations`의 미적용 migration을 순서대로 적용합니다.
3. `/setup`에서 최초 사이트 관리자 계정을 만듭니다. 첫 계정은 자동 승인되고 개인 Workspace가 생성되며, 사용자가 한 명이라도 생기면 이 화면은 자동으로 닫힙니다.
4. `npm install`, `npm run dev`를 실행합니다.

## URL 구조

- `/login`: 로그인
- `/workspace`: 인증된 워크스페이스
- `/workspace/pages/:id`: 로그 백업·편집
- `/p/:token`: 게시된 단일 로그 읽기 화면

공개 경로는 워크스페이스 탐색 기능을 포함하지 않으며, 토큰에 연결된 로그 외의 데이터를 조회하지 않습니다.

## 현재 구현

- Roll20 `msgdata` 및 렌더링 HTML 가져오기
- 선택적 hidden message 제거와 항상 적용되는 구조·고신뢰 오류 중복 정규화
- inline roll, 시트 템플릿, 이미지 링크 렌더링
- private Storage의 gzip 원본 HTML archive와 권한 검사 다운로드
- 원문을 바꾸지 않는 TXT 교정 설정과 내보내기
- 원본 디자인을 보존한 블록 편집
- 블록 추가, 휴지통, 복원, 수정 이력, 이전 내용 복구
- 동시 수정 충돌 방지와 entry 단위 lightweight Realtime 갱신
- 중첩 폴더와 로그 페이지 트리
- 이메일 없는 아이디 로그인과 4자 이상 비밀번호
- 자유 가입 신청, 사이트 관리자 승인/거절, 승인 계정별 개인 Workspace
- Page/Folder 단위 공유, 공유 Folder 권한 상속, 사용자별 Workspace 배치
- 초대 권한 위임 제한, 공유 self-remove/revoke/reshare, original owner의 30일 휴지통
- 12자 난수 링크를 사용하는 단일 로그 게시·게시 중단·링크 재발급
- 200개 cursor pagination, sparse sort key, copy-on-write 원본과 compact revision

## 기존 로그 데이터 최적화

`202608270004_log_performance.sql` 적용 후에는 신규 import부터 PostgreSQL에 원본 HTML과 중복 canonical snapshot을 저장하지 않습니다. 기존 데이터는 먼저 dry-run으로 확인한 뒤 명시적으로 이전합니다.

```powershell
npm run backfill:log-storage
npm run backfill:log-storage -- --apply
```

이 작업은 `SUPABASE_SERVICE_ROLE_KEY`가 필요하며 raw HTML과 이전 generation을 private Storage로 옮긴 뒤에만 legacy DB payload를 비웁니다.

사용자는 실제 이메일을 입력하거나 인증하지 않습니다. Supabase Auth 호환을 위한 임의 내부 주소와 파생 비밀번호는 서버에서만 처리하며 화면과 프로필에는 노출하지 않습니다.

게시 링크는 제목과 로그 본문만 렌더링합니다. 워크스페이스·페이지 목록·멤버 정보는 공개 경로에서 조회하지 않으며 검색 엔진 색인과 리퍼러 전송도 차단합니다.
