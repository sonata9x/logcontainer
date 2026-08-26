import Link from "next/link";
import { requireWorkspaceSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function WorkspacePage() {
  const session = await requireWorkspaceSession();
  const supabase = await createSupabaseServerClient();
  const { data: firstPage } = await supabase.from("pages").select("id")
    .eq("workspace_id", session.workspace.id).eq("is_archived", false)
    .order("order_index").limit(1).maybeSingle();

  return (
    <section className="empty-state">
      <h1>{firstPage ? "작업할 로그를 선택하세요" : "첫 로그를 만들어보세요"}</h1>
      <p>{firstPage ? "왼쪽 페이지 목록에서 로그를 열 수 있습니다." : "왼쪽의 ‘새 로그’를 누르면 빈 로그 페이지가 만들어집니다."}</p>
      {firstPage && <Link className="button" href={`/workspace/pages/${firstPage.id}`}>첫 로그 열기</Link>}
    </section>
  );
}
