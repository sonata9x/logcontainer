import { requireWorkspaceSession } from "@/lib/auth";

export default async function WorkspacePage() {
  await requireWorkspaceSession();

  return (
    <section className="empty-state">
      <h1>작업할 로그를 선택하세요</h1>
      <p>왼쪽 페이지 목록에서 로그를 열거나 새 로그를 만들 수 있습니다.</p>
    </section>
  );
}
