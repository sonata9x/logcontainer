"use client";

import { X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useEscapeClose } from "@/lib/use-escape-close";
import { parseYouTubeVideoId } from "@/lib/bgm";

export function BgmDetailsDialog({ heading, initialTitle = "", initialUrl, canEditUrl = true, description, onSave, onClose }: {
  heading: string; initialTitle?: string; initialUrl?: string; canEditUrl?: boolean; description?: string;
  onSave: (values: { title: string; youtubeUrl?: string }) => Promise<void>; onClose: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [url, setUrl] = useState(initialUrl ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEscapeClose(() => { if (!pending) onClose(); });
  const invalidUrl = initialUrl !== undefined && canEditUrl && !parseYouTubeVideoId(url);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending || !title.trim() || invalidUrl) return;
    setPending(true); setError("");
    try { await onSave({ title: title.trim(), ...(initialUrl !== undefined && canEditUrl ? { youtubeUrl: url.trim() } : {}) }); onClose(); }
    catch (error) { setError(error instanceof Error ? error.message : "저장하지 못했습니다."); }
    finally { setPending(false); }
  }
  return createPortal(<div className="modal-backdrop" onMouseDown={() => !pending && onClose()}><form className="modal-card" role="dialog" aria-modal="true" aria-label={heading} onMouseDown={(event) => event.stopPropagation()} onSubmit={submit}><button className="modal-close" type="button" aria-label="닫기" onClick={onClose} disabled={pending}><X size={17} /></button><h2>{heading}</h2>{description && <p className="muted">{description}</p>}<label className="field">이름<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required disabled={pending} /></label>{initialUrl !== undefined && <label className="field">YouTube 링크<input value={url} onChange={(event) => setUrl(event.target.value)} required readOnly={!canEditUrl} disabled={pending} aria-invalid={Boolean(invalidUrl)} placeholder="https://www.youtube.com/watch?v=…" />{!canEditUrl && <small>링크는 최초 등록자 또는 사이트 관리자만 수정할 수 있습니다.</small>}{invalidUrl && <small className="field-error">올바른 YouTube 링크를 입력해주세요.</small>}</label>}{error && <p className="error" role="alert">{error}</p>}<div className="modal-actions"><button className="button" type="button" onClick={onClose} disabled={pending}>취소</button><button className="button button-primary" disabled={pending || !title.trim() || invalidUrl}>{pending ? "저장 중…" : "저장"}</button></div></form></div>, document.body);
}

export function BgmTrackPickerDialog({ title, items, onSave, onClose }: { title: string; items: Array<{ id: string; title: string; source: string; alreadyAdded: boolean }>; onSave: (ids: string[]) => Promise<{ addedCount?: number; existingCount?: number } | void>; onClose: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEscapeClose(() => { if (!pending) onClose(); });
  const available = items.filter((item) => !item.alreadyAdded);
  function toggle(id: string) { setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); }
  return createPortal(<div className="modal-backdrop" onMouseDown={() => !pending && onClose()}><form className="modal-card bgm-track-picker-dialog" role="dialog" aria-modal="true" aria-label="플레이리스트에 곡 추가" onMouseDown={(event) => event.stopPropagation()} onSubmit={async (event) => { event.preventDefault(); if (!selected.length || pending) return; setPending(true); setError(""); try { await onSave(selected); onClose(); } catch (error) { setError(error instanceof Error ? error.message : "추가하지 못했습니다."); } finally { setPending(false); } }}><button className="modal-close" type="button" aria-label="닫기" onClick={onClose} disabled={pending}><X size={17} /></button><h2>플레이리스트에 곡 추가</h2><p><strong>{title}</strong>에 보관함 곡을 여러 개 한 번에 추가합니다.</p>
    <div className="bgm-picker-actions"><button className="button" type="button" disabled={pending || !available.length} onClick={() => setSelected(available.map((item) => item.id))}>전체 선택</button><button className="button" type="button" disabled={pending || !selected.length} onClick={() => setSelected([])}>선택 해제</button><small>{selected.length}곡 선택</small></div>
    <div className="bgm-track-checklist">{items.map((item) => <label key={item.id} className={item.alreadyAdded ? "is-added" : ""}><input type="checkbox" checked={item.alreadyAdded || selected.includes(item.id)} disabled={pending || item.alreadyAdded} onChange={() => toggle(item.id)} /><span>{item.title}<small>{item.source}{item.alreadyAdded ? " · 이미 추가됨" : ""}</small></span></label>)}{!items.length && <p>보관함에 추가할 BGM이 없습니다.</p>}</div>
    {error && <p className="error" role="alert">{error}</p>}<div className="modal-actions"><button className="button" type="button" onClick={onClose} disabled={pending}>취소</button><button className="button button-primary" disabled={!selected.length || pending}>{pending ? "추가 중…" : `${selected.length}곡 추가`}</button></div></form></div>, document.body);
}
