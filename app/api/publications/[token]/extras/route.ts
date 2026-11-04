import { NextRequest, NextResponse } from "next/server";
import { getPageBgmItems } from "@/lib/bgm";
import { getPublicationAccess, PUBLICATION_SESSION_COOKIE } from "@/lib/publication-auth";
import { serializePageExtras } from "@/lib/page-extras";
import { parseLogStreams } from "@/lib/logs/streams";
import { getSpeakerAvatarBundle } from "@/lib/speaker-avatars";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const context = await getPublicationAccess(token, request.cookies.get(PUBLICATION_SESSION_COOKIE)?.value);
  if (!context?.authorized) return NextResponse.json({ error: "게시 로그 열람 권한이 없습니다." }, { status: 403 });
  const { data: page } = await context.admin.from("pages").select("overview, font_family, session_card_path, session_card_mime, session_card_size").eq("id", context.page.id).single();
  try {
    const [extras, bgmItems, avatars] = await Promise.all([serializePageExtras(context.admin, page), getPageBgmItems(context.admin, context.page.id), getSpeakerAvatarBundle(context.admin, context.page.id)]);
    const { data: log } = await context.admin.from("logs").select("import_report").eq("page_id", context.page.id).maybeSingle();
    return NextResponse.json({ pageId: context.page.id, extras, bgmItems, avatars, streams: parseLogStreams(log?.import_report?.streams) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "페이지 부가 정보를 불러오지 못했습니다." }, { status: 500 });
  }
}
