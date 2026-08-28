import { NextResponse } from "next/server";
import { getAuthenticatedApiContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";

export async function PATCH(request: Request) {
  const context = await getAuthenticatedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const workspaceName = typeof body.workspaceName === "string" ? body.workspaceName.trim() : "";
  const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
  if (!workspaceName || workspaceName.length > 100) {
    return NextResponse.json({ error: "워크스페이스 이름은 1~100자로 입력해주세요." }, { status: 400 });
  }
  if (!nickname || nickname.length > 80) {
    return NextResponse.json({ error: "닉네임은 1~80자로 입력해주세요." }, { status: 400 });
  }

  const { data, error } = await context.supabase.rpc("update_personal_settings", {
    next_workspace_name: workspaceName,
    next_nickname: nickname
  });
  return error
    ? databaseErrorResponse(error, "개인 설정을 저장하지 못했습니다.")
    : NextResponse.json(data);
}
