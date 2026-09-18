# 계정 아이디 변경·비밀번호 복구·보안 이력

작업 브랜치: `feat/account-security-recovery`. 기존 로그/Workspace/공유/보관함 UUID와 데이터는 유지한다. 사용자 비밀번호 최소 4자 유지, 변경·복구의 새 비밀번호 입력 최대 200자. 기존에 더 긴 비밀번호를 사용한 계정의 현재 비밀번호 확인은 계속 허용한다. 기존 비밀번호 저장 알고리즘은 변경하지 않는다. 새 외부 인증 서비스/이메일/휴대폰 인증은 도입하지 않는다.

## 사용법

1. 설정 → 계정 → 아이디: 현재 비밀번호와 새 아이디 입력. 소문자 정규화·중복/과거 아이디 예약 검사. 내부 계정 UUID/닉네임/리소스/활성 공유는 유지. 이전 아이디는 본인 포함 재사용 불가. 이전 아이디 대상 미수락 초대만 취소(기존 UUID 공유는 유지).
2. 설정 → 계정 → 비밀번호: 현재 비밀번호 확인 후 변경. 기존 세션의 서비스 접근 차단 및 현재 브라우저 로그아웃. 새 비밀번호로 재로그인.
3. 설정 → 계정 → 복구 코드: 현재 비밀번호 확인 후 개인 일회용 코드를 발급. 사용자에게 한 번만 표시하며 분실 시 재발급. 재발급은 이전 코드 무효화. 서버 DB에는 SHA-256 해시만 저장. 사이트 관리자 본인도 반드시 코드 별도 보관 권장.
4. 로그인 → 비밀번호를 잊었나요?: 관리자 복구 링크를 열거나 보관한 코드를 입력해 새 비밀번호 설정. 자동 로그인하지 않음.
5. 관리 → 계정 → 보안 이력 / 복구: 평소 지인 연락 채널에서 본인 확인 후 관리자 비밀번호를 재확인하여 링크 발급. 30분·1회 사용, 재발급 시 이전 링크 취소. 링크 원문은 발급 화면에서만 보이며 재조회 불가. 발급·사용·취소·만료 상태와 이력을 확인하고 취소 가능. 자기 계정의 링크 발급은 막고 개인 복구 코드 사용 안내.

비밀번호 변경/재설정 뒤에는 사용 중이던 복구 링크·코드를 모두 무효화한다. 로그인 후 새 개인 복구 코드를 발급해야 한다. 코드를 가진 사람은 본인인증 없이 재설정할 수 있으므로 비밀번호와 같이 취급하며 관리자에게도 코드를 보내지 않는다.

## 서버·DB 책임

- 승인 계정 및 사이트 관리자 검증. 계정 변경 대상 UUID는 검증된 세션에서 가져오며, 클라이언트가 다른 사용자 UUID를 제출할 수 없음. 관리자만 별도의 대상 계정 API 사용 가능.
- 현재 비밀번호 확인은 별도 Supabase Auth 클라이언트로 실행하고 임시 검증 세션만 종료. 브라우저 로그인 세션을 재인증 과정에서 바꾸지 않음. 서버 전용 service-role 비밀번호 변경 API 사용, application DB에서 Auth 비밀번호를 직접 갱신하지 않음.
- 비밀번호는 기존 `deriveAuthPassword`를 거쳐 Supabase Auth로 전달. 비밀번호/중간 유도값/복구 bearer 토큰 원문은 이력이나 application 테이블에 저장하지 않음.
- 32-byte 암호학적 난수 복구 토큰. 서버 저장은 domain-separated SHA-256 해시. 링크 토큰은 URL fragment로 전달해 서버 access URL에 포함되지 않게 하고 복구 화면 진입 후 fragment 제거. 요청 body에만 전송. 복구 페이지 no-referrer/no-store/noindex, 제3자 스크립트 추가 없음.
- `account_security_state`는 비밀번호 처리의 durable 작업 ID와 세션 유효 시작 시각을 저장. profile → security state → token 순서로 row lock. 링크 claim/사용 처리를 Auth 변경 전에 저장하여 동시 사용/재발급과 직렬화. 단일 토큰은 사용 후 다시 활성화하지 않음.
- 성공한 비밀번호 변경은 세션 cutoff 갱신 및 작업 해제와 변경 이력을 DB 트랜잭션에 기록. 기존 JWT를 refresh해도 원래 `auth.sessions.created_at`이 cutoff보다 이전이면 불허. `is_account_approved`와 기존 `get_personal_session_context` RPC 모두에 검증 적용. Workspace 렌더링·승인 API·기존 RLS/권한 함수의 현재 actor 접근에 적용. 타인의 공유 리소스 이용에는 영향 없음. 새 로그인 세션만 허용.
- 코드/토큰/작업 상태 테이블은 RLS + public/anon/authenticated 직접 접근 철회. 서버 mutation RPC는 service-role 전용이며 검증된 route에서만 호출. 조회 RPC는 자신의 이력 또는 사이트 관리자에게 대상 계정 이력만 반환하며 토큰 해시·내부 작업 ID는 반환하지 않음.
- 기존 로그인 IP 제한에 추가로 아이디별 독립 제한(10회/5분, 15분 차단). 계정 변경·코드 발급·관리자 복구는 계정별 5회/15분, 30분 차단. 공개 복구는 IP별 5회/15분. 계정별 키도 HMAC으로 저장; 원시 IP를 추가 저장하지 않음. 모든 로그인 시도를 제한하므로 잦은 정상 시도도 잠시 제한될 수 있고, 특정 아이디에 대한 공격은 일시적 잠금 유발 가능(이메일 없이 짧은 비밀번호를 허용하는 운영상 tradeoff).

## 기록과 보관

`account_security_events`: 대상 UUID, 수행자 UUID(복구 사용/실패 로그인은 미인증이므로 null), 동작, 아이디 변경 전·후, 시각. 현재 비밀번호 확인 실패·알려진 계정의 로그인 실패·인증 계정 변경 API 429 제한도 기록. 공개 복구의 미인증 실패/알 수 없는 로그인 ID에는 계정 이력을 임의 부여하지 않는다. 성공 로그인 전체, 원시 IP, 기기 fingerprint나 위치 추적은 이번 작업에 추가하지 않았다.

UI 최근 100건, 보관 90일. 기존 보호된 daily purge에 service-role cleanup 연결. 90일 지난 used/revoked/expired 토큰도 정리하고 활성 개인 backup 코드는 유지. 이전 아이디 예약은 영구 유지(다른 계정으로 재사용 방지).

테이블: `account_security_state`, `account_username_history`, `account_security_events`, `account_recovery_tokens`. 비밀번호 원본을 저장하는 새 테이블은 없음.

## 실패·운영 복구

Auth API 쓰기와 application DB는 별개 트랜잭션이다. 이를 하나의 원자적 DB 변경처럼 주장하지 않는다. Auth 응답 실패/통신 오류/함수 종료/최종 이력 저장 실패 시 durable pending 상태를 유지하고 접근을 fail-closed 차단한다. 늦게 도착한 Auth 쓰기와 기존 비밀번호 로그인이 경쟁해 접근이 다시 열리는 것을 막기 위함이다. 사용된 복구 토큰은 재사용 불가.

일반 계정: 서버 요청이 끝났는지 확인 후 관리자가 보안 화면에서 15분 이상 중단된 작업을 명시적으로 해제하고 새 링크 발급. 자체 관리자 계정이 잠긴 예외 상황: Supabase 운영자가 서버 요청 종료를 확인한 뒤 `supabase/maintenance/unlock_site_admin_password_operation.sql` 실행(15분 제한, 계정 비밀번호 직접 변경하지 않으며 이력 기록). Auth가 실제 수락한 비밀번호로 재로그인하거나 보관한 코드가 없으면 운영자 측 개별 복구가 필요. **개인 코드와 Supabase 운영 계정 접근 둘 다 잃으면 인증 없는 복구 경로는 제공하지 않는다.** 운영 계정 2FA/복구 수단은 별도 관리.

## 적용·검증·남은 확인

- 신규 SQL `202609180003_account_security.sql` 한 개를 먼저 적용해야 한다. 기존 계정은 cutoff가 없어 적용만으로 로그아웃되지 않음. 기존 API/서버 세션 context 반환 schema 유지. schema.sql bootstrap에 동일 내용 포함. main/배포 승격은 SQL 적용 후 진행.
- Supabase Auth 비밀번호 설정에서 **Require current password when changing password**를 켜야 한다. 앱 route의 현재 비밀번호 확인만으로는 Supabase 공개 Auth API의 직접 password update까지 막는 것이 아니다. 이 옵션은 직접 Auth 변경에도 현재 비밀번호를 요구하여 탈취한 로그인 토큰만으로 변경하는 우회 경로를 막는다. 이메일 nonce를 보내는 별도 **Require reauthentication when changing password** 옵션과 혼동하지 않는다. 앱의 관리자/복구 변경은 서버 전용 admin API를 사용한다. 비밀번호 최소 4자 정책은 그대로 유지한다.
- application 보안 이력/세션 cutoff는 이번 앱 API를 통한 변경에 적용된다. Supabase Auth API를 직접 호출한 변경은 앱 이력에 자동 포함되지 않으며 Supabase Auth 자체 감사 로그에서 별도로 확인해야 한다. Auth 관리 테이블에 임의의 password trigger를 추가하거나 모든 provider 변경이 앱 이력에 수집된다고 주장하지 않는다. 운영 적용 후 위 설정의 직접 API 거부 동작과 admin API 복구 동작을 실제 테스트 계정으로 추가 확인해야 한다.
- 격리 PostgreSQL(PGlite): SQL 반복 실행, 아이디 중복/예약/가입 시 trigger, UUID 공유 유지, 미수락 초대 취소, token expiry/revoke/reissue/consume, 권한/RLS 직접 조회 차단, 구 세션 refresh 차단/새 세션 허용/Workspace context 차단, Auth 실패 pending 보호/15분 후 운영 해제, 90일 cleanup 실행 검증.
- 실제 Supabase JS Auth SDK 요청을 mocked fetch로 검증: 별도 클라이언트 비밀번호 확인, 원문 대신 derive 전달, 반환 계정 UUID 확인, 임시 세션 local sign-out. 실제 Auth 서버 통신은 아니다.
- orchestration mock: claim 실패 시 Auth 미호출, 성공/실패의 최종 처리 순서 및 비밀번호 이력 미포함, 최종 저장 실패 시 성공 응답 불허.
- 최종 전체 테스트/빌드/린트 결과는 작업 완료 보고 참조. 실제 Supabase SQL Editor 적용 및 실제 Auth 세션/브라우저 클릭/복구 링크 재생성은 이 세션에서 확인하지 못함(로컬 env와 브라우저 조작 도구 없음). 사용자 계정/비밀번호를 테스트용으로 변경하지 않았음. 실제 동시 다중 DB connection race는 PGlite 단일 연결 테스트로 대체했다고 주장하지 않는다.

최종 자동 검증: 전체 테스트 212개 통과, production build 및 ESLint 통과. 비상 운영 SQL도 격리 DB에서 15분 전 실행 거부·15분 후 작업 해제·코드 재사용 거부·이력 기록을 검증했다.
원격 main의 후속 4개 커밋(`9a3a145`까지: 투명 BGM 버튼/채워진 재생 아이콘/가져오기 화면 X 제거)을 작업 브랜치에 병합하여 보존했다. 이전 BGM 회색 배경을 강제하던 CSS 회귀 assertion은 최신 main의 투명 배경 요구로 갱신했다.

근거: [OWASP 복구 권고](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [Supabase sessions/session_id](https://supabase.com/docs/guides/auth/sessions), [공식 Auth session 모델](https://github.com/supabase/auth/blob/master/internal/models/sessions.go), [서버 전용 updateUserById](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid), [Supabase password security/current password 설정](https://supabase.com/docs/guides/auth/password-security).
