"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useEscapeClose } from "@/lib/use-escape-close";

export function BgmUploadDialog({ file, pending, onUpload, onClose }: {
  file: File; pending: boolean; onUpload: (title: string) => Promise<void>; onClose: () => void;
}) {
  const [title, setTitle] = useState(file.name.replace(/\.mp3$/i, "").slice(0, 200));
  const [error, setError] = useState<string | null>(null);
  useEscapeClose(() => { if (!pending) onClose(); });
  async function submit() {
    setError(null);
    try { await onUpload(title.trim()); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "BGM을 업로드하지 못했습니다."); }
  }
  return typeof document === "undefined" ? null : createPortal(
    <div className="modal-backdrop" onMouseDown={() => !pending && onClose()}>
      <form className="modal-card" role="dialog" aria-modal="true" aria-label="MP3 업로드" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); if (!pending && title.trim()) void submit(); }}>
        <button className="modal-close" type="button" aria-label="MP3 업로드 닫기" onClick={onClose} disabled={pending}><X size={18} /></button>
        <h2>MP3 업로드</h2>
        <p className="muted">{file.name}</p>
        <label className="field">BGM 제목<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required autoFocus disabled={pending} /></label>
        {error && <p role="alert">{error}</p>}
        <div className="modal-actions"><button className="button" type="button" onClick={onClose} disabled={pending}>취소</button><button className="button button-primary" disabled={pending || !title.trim()}>{pending ? "업로드 중…" : "업로드"}</button></div>
      </form>
    </div>, document.body
  );
}
