"use client";

import { Archive, ChevronDown, ChevronRight, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, LogOut, Plus, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { PageType, WorkspacePage } from "@/lib/types";

type CreatePage = (pageType: PageType, parentId?: string | null) => Promise<void>;
type WorkspaceMember = { user_id: string; role: "owner" | "editor"; profile: { username: string; display_name: string | null } | null };

export function WorkspaceSidebar({ workspaceId, workspaceName, pages, canInvite }: { workspaceId: string; workspaceName: string; pages: WorkspacePage[]; canInvite: boolean }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [invitePending, setInvitePending] = useState(false);
  const [inviteMessage, setInviteMessage] = useState("");
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const roots = useMemo(() => pages.filter((page) => !page.parent_id), [pages]);

  async function createPage(pageType: PageType, parentId: string | null = null) {
    setCreating(true);
    const response = await fetch("/api/pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, pageType, parentId })
    });
    const result = await response.json();
    setCreating(false);
    if (!response.ok) return window.alert(result.error ?? "페이지를 만들지 못했습니다.");
    if (pageType === "log") router.push(`/workspace/pages/${result.id}`);
    router.refresh();
  }

  async function logout() {
    await createSupabaseBrowserClient().auth.signOut();
    window.location.assign("/login");
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInvitePending(true);
    setInviteMessage("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId, username: data.get("username"), password: data.get("password") })
    });
    const result = await response.json();
    setInvitePending(false);
    setInviteMessage(response.ok ? "편집자 계정을 추가했습니다." : result.error ?? "계정을 추가하지 못했습니다.");
    if (response.ok) { event.currentTarget.reset(); await loadMembers(); }
  }

  async function loadMembers() {
    const response = await fetch(`/api/members?workspaceId=${encodeURIComponent(workspaceId)}`);
    const result = await response.json();
    if (response.ok) setMembers(result.members ?? []);
  }

  async function openInvite() {
    setShowInvite(true);
    await loadMembers();
  }

  async function removeMember(userId: string) {
    if (!window.confirm("이 편집자를 워크스페이스에서 내보낼까요?")) return;
    const response = await fetch("/api/members", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, userId }) });
    const result = await response.json();
    if (!response.ok) return window.alert(result.error ?? "멤버를 내보내지 못했습니다.");
    setMembers((current) => current.filter((member) => member.user_id !== userId));
  }

  return (
    <aside className="workspace-sidebar">
      <div className="workspace-title">{workspaceName}</div>
      <div className="sidebar-create-actions">
        <button className="sidebar-action" onClick={() => createPage("log")} disabled={creating}><Plus size={16} />새 로그</button>
        <button className="sidebar-action" onClick={() => createPage("folder")} disabled={creating}><FolderPlus size={15} />새 폴더</button>
      </div>
      <nav className="page-tree" aria-label="페이지">
        {roots.map((page) => <PageNode key={page.id} page={page} pages={pages} depth={0} createPage={createPage} />)}
        {!roots.length && <p className="sidebar-empty">아직 페이지가 없습니다.</p>}
      </nav>
      <div className="sidebar-footer">
        <ArchivePanel workspaceId={workspaceId} />
        {canInvite && <button className="sidebar-action" onClick={openInvite}><UserPlus size={15} />멤버 관리</button>}
        <button className="sidebar-action" onClick={logout}><LogOut size={15} />로그아웃</button>
      </div>
      {showInvite && <div className="modal-backdrop" onMouseDown={() => setShowInvite(false)}><section className="modal-card" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowInvite(false)} aria-label="닫기"><X size={17} /></button><h2>멤버 관리</h2><p>편집자는 이 워크스페이스의 모든 로그를 보고 수정할 수 있습니다. 새 아이디와 전달할 임시 비밀번호를 정해주세요.</p><form onSubmit={invite}><label className="field">편집자 아이디<input name="username" minLength={2} maxLength={40} required /></label><label className="field">임시 비밀번호<input name="password" type="password" minLength={4} required /></label><button className="button button-primary" disabled={invitePending}>{invitePending ? "추가 중…" : "편집자 추가"}</button></form>{inviteMessage && <p>{inviteMessage}</p>}<div className="member-list">{members.map((member) => <div className="member-row" key={member.user_id}><div><strong>{member.profile?.display_name || member.profile?.username || "사용자"}</strong><small>@{member.profile?.username} · {member.role}</small></div>{member.role === "editor" && <button className="button button-danger" onClick={() => removeMember(member.user_id)}>내보내기</button>}</div>)}</div></section></div>}
    </aside>
  );
}

function ArchivePanel({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pages, setPages] = useState<WorkspacePage[]>([]);
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    const response = await fetch(`/api/pages?workspaceId=${encodeURIComponent(workspaceId)}&archived=true`);
    const result = await response.json();
    if (!response.ok) return window.alert(result.error ?? "보관함을 불러오지 못했습니다.");
    setPages(result.pages ?? []);
  }
  async function restore(pageId: string) {
    const response = await fetch(`/api/pages/${pageId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ isArchived: false }) });
    if (!response.ok) return window.alert("페이지를 복원하지 못했습니다.");
    setPages((current) => current.filter((page) => page.id !== pageId));
    router.refresh();
  }
  return <div className="sidebar-popover-wrap"><button className="sidebar-action" onClick={toggle}><Archive size={15} />보관함</button>{open && <div className="sidebar-popover">{pages.length ? pages.map((page) => <div className="sidebar-popover-item" key={page.id}><span>{page.title}</span><button className="button" onClick={() => restore(page.id)}>복원</button></div>) : <p>보관한 페이지가 없습니다.</p>}</div>}</div>;
}

function PageNode({ page, pages, depth, createPage }: { page: WorkspacePage; pages: WorkspacePage[]; depth: number; createPage: CreatePage }) {
  const pathname = usePathname();
  const children = pages.filter((candidate) => candidate.parent_id === page.id);
  const [expanded, setExpanded] = useState(true);
  const paddingLeft = 9 + depth * 15;

  if (page.page_type === "folder") {
    return <div className="tree-folder"><div className="page-link tree-row" style={{ paddingLeft }}><button className="tree-toggle" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? "폴더 접기" : "폴더 펼치기"}>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>{expanded ? <FolderOpen size={15} /> : <Folder size={15} />}<span className="tree-title">{page.title}</span><button className="tree-add" onClick={() => createPage("log", page.id)} title="이 폴더에 로그 추가"><FilePlus2 size={14} /></button></div>{expanded && children.map((child) => <PageNode key={child.id} page={child} pages={pages} depth={depth + 1} createPage={createPage} />)}</div>;
  }

  const href = `/workspace/pages/${page.id}`;
  return <Link className={`page-link ${pathname === href ? "active" : ""}`} style={{ paddingLeft: paddingLeft + 18 }} href={href}><span>{page.icon ?? <FileText size={15} />}</span><span className="tree-title">{page.title}</span></Link>;
}
