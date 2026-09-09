/* eslint-disable @next/next/no-img-element -- private signed image URLs are generated dynamically */
"use client";

import { BookOpen, ImagePlus, Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { HANDOUT_IMAGE_MAX_BYTES, HANDOUT_IMAGE_TYPES } from "@/lib/handouts";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { Handout } from "@/lib/types";
import { useEscapeClose } from "@/lib/use-escape-close";

type Props = { mode: "editor"; pageId: string; canEdit: boolean } | { mode: "public"; token: string };
type PendingImage = { file: File; preview: string };

function apiBase(props: Props) {
  return props.mode === "editor" ? `/api/pages/${props.pageId}/handouts` : `/api/publications/${encodeURIComponent(props.token)}/handouts`;
}

function cleanFileTitle(name: string) {
  return name.replace(/\.[^.]+$/, "").trim().slice(0, 200) || "이미지 핸드아웃";
}

function acceptedImages(files: File[]) {
  const accepted: File[] = [];
  for (const file of files) {
    if (!HANDOUT_IMAGE_TYPES.has(file.type) || file.size <= 0 || file.size > HANDOUT_IMAGE_MAX_BYTES) {
      window.alert("PNG, JPEG, GIF, WebP 이미지만 파일당 10MB까지 추가할 수 있습니다.");
      continue;
    }
    accepted.push(file);
  }
  return accepted;
}

export function HandoutLibrary(props: Props) {
  const editor = props.mode === "editor";
  const canEdit = editor && props.canEdit;
  const [listOpen, setListOpen] = useState(false);
  const [handouts, setHandouts] = useState<Handout[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<Handout | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [removedImageIds, setRemovedImageIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const imageOnlyInput = useRef<HTMLInputElement>(null);
  const popover = useRef<HTMLDivElement>(null);

  const clearPendingImages = useCallback(() => {
    setPendingImages((current) => { current.forEach((image) => URL.revokeObjectURL(image.preview)); return []; });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(apiBase(props), { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { window.alert(result.error ?? "핸드아웃을 불러오지 못했습니다."); return null; }
      const next = (result.handouts ?? []) as Handout[];
      setHandouts(next);
      setActive((current) => current ? next.find((item) => item.id === current.id) ?? null : current);
      return next;
    } catch {
      window.alert("핸드아웃을 불러오지 못했습니다.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [props]);

  useEffect(() => () => clearPendingImages(), [clearPendingImages]);
  useEffect(() => {
    if (!listOpen) return;
    const close = (event: PointerEvent) => { if (!popover.current?.contains(event.target as Node)) setListOpen(false); };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [listOpen]);
  useEscapeClose(() => { if (!saving) { setActive(null); setEditing(false); clearPendingImages(); } }, saving || (!active && !editing));

  function addFiles(files: File[]) {
    const valid = acceptedImages(files).slice(0, Math.max(0, 20 - pendingImages.length));
    setPendingImages((current) => [...current, ...valid.map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
  }

  function openCreate(files: File[] = []) {
    setActive(null);
    setTitle(files[0] ? cleanFileTitle(files[0].name) : "");
    setContent("");
    setRemovedImageIds([]);
    clearPendingImages();
    setEditing(true);
    setListOpen(false);
    if (files.length) addFiles(files);
  }

  function openEdit(handout: Handout) {
    setActive(handout);
    setTitle(handout.title);
    setContent(handout.content);
    setRemovedImageIds([]);
    clearPendingImages();
    setEditing(true);
  }

  async function uploadImage(handoutId: string, image: PendingImage) {
    if (!editor) return;
    const prepare = await fetch(`/api/pages/${props.pageId}/handouts/${handoutId}/images/upload`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ originalName: image.file.name, mimeType: image.file.type, byteSize: image.file.size }) });
    const target = await prepare.json().catch(() => ({}));
    if (!prepare.ok) throw new Error(target.error ?? "이미지 업로드를 준비하지 못했습니다.");
    try {
      const { error } = await createSupabaseBrowserClient().storage.from("handout-images").uploadToSignedUrl(target.path, target.token, image.file, { contentType: image.file.type });
      if (error) throw new Error("이미지를 업로드하지 못했습니다.");
      const confirm = await fetch(`/api/pages/${props.pageId}/handouts/${handoutId}/images/${target.imageId}`, { method: "PATCH" });
      if (!confirm.ok) throw new Error("업로드한 이미지를 확정하지 못했습니다.");
    } catch (error) {
      await fetch(`/api/pages/${props.pageId}/handouts/${handoutId}/images/${target.imageId}`, { method: "DELETE" });
      throw error;
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || !title.trim()) return;
    setSaving(true);
    try {
      const endpoint = active ? `${apiBase(props)}/${active.id}` : apiBase(props);
      const response = await fetch(endpoint, { method: active ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, content }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "핸드아웃을 저장하지 못했습니다.");
      const handoutId = active?.id ?? result.handout?.id;
      if (!handoutId) throw new Error("저장한 핸드아웃을 확인하지 못했습니다.");
      for (const imageId of removedImageIds) await fetch(`/api/pages/${props.pageId}/handouts/${handoutId}/images/${imageId}`, { method: "DELETE" });
      for (const image of pendingImages) await uploadImage(handoutId, image);
      clearPendingImages();
      setRemovedImageIds([]);
      setEditing(false);
      const refreshed = await load();
      setActive(refreshed?.find((handout) => handout.id === handoutId) ?? result.handout ?? null);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "핸드아웃을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function removeHandout() {
    if (!editor || !active || !window.confirm("이 핸드아웃을 삭제할까요? 이미지도 함께 삭제됩니다.")) return;
    setSaving(true);
    const response = await fetch(`${apiBase(props)}/${active.id}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) return window.alert(result.error ?? "핸드아웃을 삭제하지 못했습니다.");
    setActive(null);
    await load();
  }

  function chooseFiles(event: ChangeEvent<HTMLInputElement>, imageOnly = false) {
    const files = acceptedImages(Array.from(event.target.files ?? []));
    event.target.value = "";
    if (!files.length) return;
    if (imageOnly) openCreate(files); else addFiles(files);
  }

  return <div className="handout-control" ref={popover}>
    <button className="button handout-trigger" onClick={(event) => { event.stopPropagation(); const next = !listOpen; setListOpen(next); if (next) void load(); }} aria-expanded={listOpen}><BookOpen size={15} />핸드아웃</button>
    {listOpen && <div className="handout-list-popover"><div className="handout-list-heading"><strong>핸드아웃</strong>{canEdit && <span><button title="새 핸드아웃" aria-label="새 핸드아웃" onClick={() => openCreate()}><Plus size={15} /></button><button title="이미지로 핸드아웃 추가" aria-label="이미지로 핸드아웃 추가" onClick={() => imageOnlyInput.current?.click()}><ImagePlus size={15} /></button></span>}</div><div className="handout-list">{loading ? <p>불러오는 중…</p> : handouts.length ? handouts.map((handout) => <button key={handout.id} onClick={() => { setActive(handout); setEditing(false); setListOpen(false); }}><strong>{handout.title}</strong><small>{handout.content.trim().slice(0, 60) || `${handout.images.length}개 이미지`}</small></button>) : <p>아직 핸드아웃이 없습니다.</p>}</div></div>}
    {canEdit && <input ref={imageOnlyInput} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple onChange={(event) => chooseFiles(event, true)} />}
    {(active || editing) && typeof document !== "undefined" && createPortal(<div className="modal-backdrop handout-backdrop" onMouseDown={saving ? undefined : () => { setActive(null); setEditing(false); clearPendingImages(); }}><section className="modal-card handout-modal" onMouseDown={(event) => event.stopPropagation()}>{editing ? <form onSubmit={save}><button className="modal-close" type="button" onClick={() => { setEditing(false); if (!active) setActive(null); clearPendingImages(); }} disabled={saving}><X size={18} /></button><h2>{active ? "핸드아웃 수정" : "새 핸드아웃"}</h2><label className="field">제목<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required autoFocus /></label><label className="field">내용<textarea className="handout-content-input" value={content} onChange={(event) => setContent(event.target.value)} onPaste={(event: ClipboardEvent<HTMLTextAreaElement>) => { const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/")); if (images.length) { event.preventDefault(); addFiles(images); } }} maxLength={200000} placeholder="내용을 입력하거나 이미지를 붙여넣으세요." /></label><div className="handout-image-editor">{active?.images.filter((image) => !removedImageIds.includes(image.id)).map((image) => <figure key={image.id}><img src={image.url} alt={image.original_name} /><button type="button" onClick={() => setRemovedImageIds((current) => [...current, image.id])} aria-label={`${image.original_name} 제거`}><X size={14} /></button></figure>)}{pendingImages.map((image) => <figure key={image.preview}><img src={image.preview} alt={image.file.name} /><button type="button" onClick={() => { URL.revokeObjectURL(image.preview); setPendingImages((current) => current.filter((item) => item !== image)); }} aria-label={`${image.file.name} 제거`}><X size={14} /></button></figure>)}</div><input ref={imageInput} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple onChange={(event) => chooseFiles(event)} /><div className="handout-editor-tools"><button className="button" type="button" onClick={() => imageInput.current?.click()} disabled={saving || pendingImages.length >= 20}><ImagePlus size={14} />이미지 추가</button><span>내용 칸에 이미지를 붙여넣을 수도 있습니다.</span></div><div className="modal-actions"><button className="button" type="button" onClick={() => { setEditing(false); if (!active) setActive(null); clearPendingImages(); }} disabled={saving}>취소</button><button className="button button-primary" disabled={saving || !title.trim()}>{saving ? "저장 중…" : "저장"}</button></div></form> : active && <><button className="modal-close" onClick={() => setActive(null)}><X size={18} /></button><div className="handout-view-heading"><h2>{active.title}</h2>{canEdit && <div><button className="button" onClick={() => openEdit(active)}><Pencil size={14} />수정</button><button className="button button-danger" onClick={removeHandout}><Trash2 size={14} />삭제</button></div>}</div>{active.content && <div className="handout-content">{active.content}</div>}<div className="handout-images">{active.images.map((image) => <a key={image.id} href={image.url} target="_blank" rel="noreferrer"><img src={image.url} alt={image.original_name} /></a>)}</div></>}</section></div>, document.body)}
  </div>;
}
