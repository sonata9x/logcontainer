import { NextResponse } from "next/server";
import { getApprovedApiContext, getAuthenticatedApiContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";
import { defaultCorrectionSettings, parseCorrectionSettings } from "@/lib/logs/corrections";
import { DEFAULT_ACCENT_COLOR, normalizeHexColor } from "@/lib/color";
import { isLogFontFamily, parseLogFontFamily } from "@/lib/fonts";

export async function GET() {
  const context = await getApprovedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { data, error } = await context.supabase.from("user_preferences")
    .select("accent_color, correction_settings, system_font_family").eq("user_id", context.user.id).maybeSingle();
  return error ? databaseErrorResponse(error, "개인 설정을 불러오지 못했습니다.") : NextResponse.json({
    accentColor: data?.accent_color ?? DEFAULT_ACCENT_COLOR,
    systemFont: parseLogFontFamily(data?.system_font_family),
    correctionSettings: parseCorrectionSettings(data?.correction_settings) ?? defaultCorrectionSettings
  });
}

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
  const accentColor = normalizeHexColor(body.accentColor);
  const correctionSettings = parseCorrectionSettings(body.correctionSettings);
  if (!accentColor) return NextResponse.json({ error: "포인트 색상은 #RGB 또는 #RRGGBB 형식이어야 합니다." }, { status: 400 });
  if (!correctionSettings) return NextResponse.json({ error: "TXT 교정 기본값이 올바르지 않습니다." }, { status: 400 });
  if (body.systemFont !== undefined && !isLogFontFamily(body.systemFont)) {
    return NextResponse.json({ error: "시스템 글꼴이 올바르지 않습니다." }, { status: 400 });
  }

  const { data, error } = await context.supabase.rpc("update_personal_settings", {
    next_workspace_name: workspaceName,
    next_nickname: nickname
  });
  if (error) return databaseErrorResponse(error, "개인 설정을 저장하지 못했습니다.");
  const preferenceResult = await context.supabase.rpc("update_user_preferences", {
    next_accent_color: accentColor, next_correction_settings: correctionSettings
  });
  if (preferenceResult.error) return databaseErrorResponse(preferenceResult.error, "개인 표시 설정을 저장하지 못했습니다.");
  if (body.systemFont !== undefined) {
    const { error } = await context.supabase.from("user_preferences")
      .update({ system_font_family: body.systemFont }).eq("user_id", context.user.id)
      .select("system_font_family").single();
    if (error) return databaseErrorResponse(error, "시스템 글꼴을 저장하지 못했습니다.");
  }
  return NextResponse.json({ ...(data as object), ...preferenceResult.data,
    ...(body.systemFont !== undefined ? { systemFont: body.systemFont } : {}) });
}
