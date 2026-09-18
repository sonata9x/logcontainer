export type AccountSecurityEvent = { id: number; action: string; actor: string | null; previousUsername: string | null; nextUsername: string | null; createdAt: string };
export type RecoveryLinkInfo = { id: string; createdAt: string; expiresAt: string; usedAt: string | null; revokedAt: string | null };
export type AccountSecurityOverview = { username: string | null; pendingSince: string | null; hasBackup: boolean; links: RecoveryLinkInfo[]; events: AccountSecurityEvent[] };
export const SECURITY_ACTION_LABELS: Record<string, string> = {
  id_changed: "아이디 변경", password_changed: "비밀번호 변경", password_reset: "비밀번호 재설정",
  password_update_failed: "비밀번호 처리 실패", reauth_failed: "현재 비밀번호 확인 실패",
  login_failed: "로그인 비밀번호 확인 실패", request_limited: "반복 요청 제한",
  recovery_issued: "복구 링크 발급", recovery_revoked: "복구 링크 취소", recovery_used: "복구 정보 사용",
  backup_issued: "개인 복구 코드 발급", operation_aborted: "중단된 비밀번호 처리 해제"
};
