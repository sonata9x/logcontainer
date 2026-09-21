"use client";

import { Check, CircleAlert, LoaderCircle, X } from "lucide-react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeClose } from "@/lib/use-escape-close";

type UploadState = "ready" | "uploading" | "done" | "error";
type UploadRow = { file: File; title: string; state: UploadState; error?: string };

export function BgmUploadDialog({ files, onUpload, onChanged, onClose }: {
  files: File[];
  onUpload: (file: File, title: string) => Promise<void>;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<UploadRow[]>(() => files.map((file) => ({ file, title: file.name.replace(/\.mp3$/i, "").slice(0, 200), state: "ready" })));
  const [pending, setPending] = useState(false);
  const [batchError, setBatchError] = useState("");
  const remaining = useMemo(() => rows.filter((row) => row.state !== "done").length, [rows]);
  const done = rows.length - remaining;
  useEscapeClose(() => { if (!pending) onClose(); });

  async function submit() {
    if (pending || !remaining || rows.some((row) => row.state !== "done" && !row.title.trim())) return;
    setPending(true);
    setBatchError("");
    let changed = false;
    try {
      for (let index = 0; index < rows.length; index += 1) {
        if (rows[index].state === "done") continue;
        setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, state: "uploading", error: undefined } : row));
        try {
          await onUpload(rows[index].file, rows[index].title.trim());
          changed = true;
          setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, state: "done", error: undefined } : row));
        } catch (failure) {
          setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, state: "error", error: failure instanceof Error ? failure.message : "업로드하지 못했습니다." } : row));
        }
      }
      if (changed) await onChanged();
    } catch (failure) { setBatchError(failure instanceof Error ? failure.message : "업로드 목록을 새로고침하지 못했습니다."); }
    finally { setPending(false); }
  }

  if (typeof document === "undefined") return null;
  return createPortal(<div className="modal-backdrop" onMouseDown={() => !pending && onClose()}>
    <form className="modal-card bgm-upload-dialog" role="dialog" aria-modal="true" aria-label="MP3 일괄 업로드" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <button className="modal-close" type="button" aria-label="MP3 업로드 닫기" onClick={onClose} disabled={pending}><X size={18} /></button>
      <h2>MP3 업로드</h2><p className="muted">선택한 {rows.length}곡을 차례로 업로드합니다. 각 제목은 지금 한 번에 정리할 수 있습니다.</p>
      <div className="bgm-upload-list">{rows.map((row, index) => <label key={`${row.file.name}-${row.file.lastModified}-${index}`}>
        <span title={row.file.name}>{row.file.name}</span>
        <input aria-label={`${row.file.name} BGM 제목`} value={row.title} onChange={(event) => setRows((current) => current.map((item, rowIndex) => rowIndex === index ? { ...item, title: event.target.value, state: item.state === "error" ? "ready" : item.state } : item))} maxLength={200} required disabled={pending || row.state === "done"} />
        {row.state === "error" ? <small className="bgm-upload-state is-error" role="alert"><CircleAlert size={13} />{row.error}</small> : <small className={`bgm-upload-state is-${row.state}`}>{row.state === "uploading" ? <><LoaderCircle size={13} className="spin" />업로드 중</> : row.state === "done" ? <><Check size={13} />완료</> : `${Math.ceil(row.file.size / 1024 / 1024)}MB`}</small>}
      </label>)}</div>
      {batchError && <p className="error" role="alert">{batchError}</p>}
      <div className="modal-actions"><span className="bgm-upload-progress" aria-live="polite">{done}/{rows.length}곡 완료</span><button className="button" type="button" onClick={onClose} disabled={pending}>{remaining ? "취소" : "닫기"}</button>{Boolean(remaining) && <button className="button button-primary" disabled={pending || rows.some((row) => row.state !== "done" && !row.title.trim())}>{pending ? "업로드 중…" : done ? "실패한 곡 재시도" : `${remaining}곡 업로드`}</button>}</div>
    </form>
  </div>, document.body);
}
