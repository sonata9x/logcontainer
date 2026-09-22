/* eslint-disable @next/next/no-img-element -- private signed URLs are short-lived */
"use client";

import { ImagePlus, Images, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { SPEAKER_AVATAR_MAX_BYTES, SPEAKER_AVATAR_TYPES } from "@/lib/speaker-avatars";
import type { SpeakerAvatarBundle, SpeakerAvatarProfile } from "@/lib/types";

export function SpeakerAvatarManager({ pageId, avatars, onChange }: { pageId: string; avatars: SpeakerAvatarBundle | null; onChange: (next: SpeakerAvatarBundle) => void }) {
  const [pending, setPending] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  if (!avatars?.enabled) return <section className="speaker-avatar-manager"><h3>화자 아바타</h3><p className="muted">Roll20과 타코야키 박스 로그에서 사용할 수 있습니다.</p></section>;

  async function upload(profile: SpeakerAvatarProfile, file: File, isDefault: boolean) {
    const variantName = isDefault ? "기본" : names[profile.speakerKey]?.trim() ?? "";
    if (!isDefault && !variantName) return window.alert("표정 이름을 입력해주세요.");
    if (!SPEAKER_AVATAR_TYPES.has(file.type) || file.size <= 0 || file.size > SPEAKER_AVATAR_MAX_BYTES) return window.alert("5MB 이하 PNG, JPG, GIF, WebP 이미지만 사용할 수 있습니다.");
    setPending(true);
    try {
      const prepare = await fetch(`/api/pages/${pageId}/speaker-avatars`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ speakerName: profile.speakerName, mimeType: file.type, byteSize: file.size }) });
      const target = await prepare.json().catch(() => ({}));
      if (!prepare.ok) throw new Error(target.error ?? "아바타 업로드를 준비하지 못했습니다.");
      const { error } = await createSupabaseBrowserClient().storage.from("speaker-avatars").uploadToSignedUrl(target.path, target.token, file, { contentType: file.type });
      if (error) throw new Error("아바타 이미지를 업로드하지 못했습니다.");
      const confirm = await fetch(`/api/pages/${pageId}/speaker-avatars`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ speakerName: profile.speakerName, variantName, isDefault, path: target.path, mimeType: file.type, byteSize: file.size, originalFilename: file.name }) });
      const result = await confirm.json().catch(() => ({}));
      if (!confirm.ok || !result.avatars) throw new Error(result.error ?? "아바타를 저장하지 못했습니다.");
      onChange(result.avatars);
      if (!isDefault) setNames((current) => ({ ...current, [profile.speakerKey]: "" }));
    } catch (error) { window.alert(error instanceof Error ? error.message : "아바타를 저장하지 못했습니다."); }
    finally { setPending(false); }
  }

  async function remove(variantId: string) {
    if (!window.confirm("이 아바타를 삭제할까요? 해당 표정을 사용하던 메시지는 기본 아바타로 돌아갑니다.")) return;
    setPending(true);
    try {
      const response = await fetch(`/api/pages/${pageId}/speaker-avatars?variantId=${encodeURIComponent(variantId)}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.avatars) throw new Error(result.error ?? "아바타를 삭제하지 못했습니다.");
      onChange(result.avatars);
    } catch (error) { window.alert(error instanceof Error ? error.message : "아바타를 삭제하지 못했습니다."); }
    finally { setPending(false); }
  }

  return <section className="speaker-avatar-manager"><h3>화자 아바타</h3><p className="muted">기본 아바타는 해당 화자의 모든 일반 표시에 적용됩니다. 표정은 아바타를 우클릭해 메시지별로 선택합니다.</p><div className="speaker-avatar-list">{avatars.profiles.map((profile) => { const defaultAvatar = profile.variants.find((variant) => variant.isDefault); const expressions = profile.variants.filter((variant) => !variant.isDefault); return <details key={profile.speakerKey}><summary><strong>{profile.speakerName}</strong><small>{profile.messageCount.toLocaleString()}개 메시지</small></summary><div className="speaker-avatar-profile"><div className="speaker-avatar-default">{defaultAvatar ? <img src={defaultAvatar.imageUrl} alt="" /> : <span className="speaker-avatar-placeholder" />}<label className="button"><ImagePlus size={14} />기본 {defaultAvatar ? "교체" : "등록"}<input className="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp" disabled={pending} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(profile, file, true); }} /></label>{defaultAvatar && <button className="icon-button-plain danger" aria-label={`${profile.speakerName} 기본 아바타 삭제`} disabled={pending} onClick={() => void remove(defaultAvatar.id)}><Trash2 size={15} /></button>}</div><div className="speaker-expression-create"><input value={names[profile.speakerKey] ?? ""} maxLength={80} placeholder="표정 이름 (예: 기쁨)" onChange={(event) => setNames((current) => ({ ...current, [profile.speakerKey]: event.target.value }))} /><label className="button"><ImagePlus size={14} />표정 추가<input className="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp" disabled={pending} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(profile, file, false); }} /></label></div>{expressions.length > 0 && <div className="speaker-expression-list">{expressions.map((variant) => <div key={variant.id}><img src={variant.imageUrl} alt="" /><span>{variant.name}</span><button className="icon-button-plain danger" aria-label={`${variant.name} 표정 삭제`} disabled={pending} onClick={() => void remove(variant.id)}><Trash2 size={14} /></button></div>)}</div>}</div></details>; })}</div></section>;
}

export function SpeakerAvatarDialog({ pageId, avatars, onChange }: { pageId: string; avatars: SpeakerAvatarBundle | null; onChange: (next: SpeakerAvatarBundle) => void }) {
  const [open, setOpen] = useState(false);
  if (!avatars?.enabled) return null;
  return <><button className="button" onClick={() => setOpen(true)}><Images size={14} />화자 아바타</button>{open && typeof document !== "undefined" && createPortal(<div className="modal-backdrop" onMouseDown={() => setOpen(false)}><section className="modal-card page-extras-editor" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" aria-label="화자 아바타 닫기" onClick={() => setOpen(false)}><X size={18} /></button><h2>화자 아바타</h2><SpeakerAvatarManager pageId={pageId} avatars={avatars} onChange={onChange} /></section></div>, document.body)}</>;
}

export type AvatarMenuState = { x: number; y: number; entryId: string; profile: SpeakerAvatarProfile; selectedVariantId: string | null };

export function SpeakerExpressionMenu({ menu, pending, onChoose, onClose }: { menu: AvatarMenuState; pending: boolean; onChoose: (variantId: string | null) => void; onClose: () => void }) {
  useEffect(() => { const close = () => onClose(); window.addEventListener("resize", close); window.addEventListener("scroll", close, true); return () => { window.removeEventListener("resize", close); window.removeEventListener("scroll", close, true); }; }, [onClose]);
  if (typeof document === "undefined") return null;
  const expressions = menu.profile.variants.filter((variant) => !variant.isDefault);
  return createPortal(<><button className="avatar-menu-scrim" aria-label="표정 메뉴 닫기" onClick={onClose} /><div className="avatar-expression-menu" role="menu" style={{ left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - Math.min(320, 44 * (expressions.length + 1))) }}><div className="avatar-expression-menu__title">{menu.profile.speakerName} · 표정 변경</div><button role="menuitemradio" aria-checked={!menu.selectedVariantId} disabled={pending} onClick={() => onChoose(null)}>기본</button>{expressions.map((variant) => <button role="menuitemradio" aria-checked={menu.selectedVariantId === variant.id} disabled={pending} key={variant.id} onClick={() => onChoose(variant.id)}><img src={variant.imageUrl} alt="" />{variant.name}</button>)}{!expressions.length && <p>등록된 표정이 없습니다.</p>}<button className="avatar-expression-menu__close" onClick={onClose} aria-label="닫기"><X size={13} /></button></div></>, document.body);
}
