"use client";

import { RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeClose } from "@/lib/use-escape-close";
import type { LogEntry } from "@/lib/types";

type TrashItem = { id: string; title?: string; speaker_name?: string; content?: string; purge_after?: string };

export function TrashDialog({ endpoint, kind, canEmpty = true, onClose, onChanged, onRestore }: {
  endpoint: string; kind: "resources" | "entries"; canEmpty?: boolean; onClose: () => void;
  onChanged?: () => Promise<void>; onRestore?: (entry: LogEntry) => void;
}) {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<TrashItem | "all" | null>(null);
  const [notice, setNotice] = useState("");
  useEscapeClose(() => confirm ? setConfirm(null) : onClose(), pending);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(endpoint, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "휴지통을 불러오지 못했습니다.");
      if (!controller.signal.aborted) setItems(result[kind] ?? []);
    }).catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "조회 오류"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint, kind]);

  async function action(item?: TrashItem, permanent = false) {
    if (pending) return;
    setPending(true); setError("");
    try {
      const response = await fetch(endpoint, { method: item ? "POST" : "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(item ? kind === "resources" ? { resourceId: item.id, permanent } : { entryId: item.id } : { confirm: "EMPTY_TRASH" }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "휴지통 작업을 완료하지 못했습니다.");
      setItems((current) => item ? current.filter((entry) => entry.id !== item.id) : []); setConfirm(null);
      if (result.entry) onRestore?.(result.entry);
      if (permanent || !item) setNotice("영구 삭제했습니다. Storage 정리는 실패 시 대기열에서 재시도됩니다.");
      await onChanged?.();
    } catch (error) { setError(error instanceof Error ? error.message : "작업 오류"); }
    finally { setPending(false); }
  }

  return createPortal(<div className="modal-backdrop" onMouseDown={pending ? undefined : onClose}><section className="modal-card trash-modal" role="dialog" aria-modal="true" aria-labelledby="trash-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" aria-label="닫기" onClick={onClose} disabled={pending}><X size={17} /></button><h2 id="trash-title">{kind === "resources" ? "휴지통" : "로그 휴지통"}</h2><p>{kind === "resources" ? "내가 소유한 삭제된 페이지와 폴더입니다." : "삭제한 메시지를 복원할 수 있습니다."}</p>{error && <p className="error" role="alert">{error}</p>}{notice && <p className="muted" role="status">{notice}</p>}
    {confirm ? <div className="trash-confirm"><h3>{confirm === "all" ? "휴지통을 비울까요?" : "영구 삭제할까요?"}</h3><p>{confirm === "all" ? "현재 휴지통의 모든 항목을 영구 삭제합니다." : confirm.title} 이 작업은 되돌릴 수 없습니다.{kind === "resources" && " 공유자의 접근과 연결된 백업·핸드아웃도 제거됩니다. 다른 소유자의 리소스는 삭제하지 않습니다."}{kind === "entries" && " 수정 이력도 함께 삭제됩니다. 원본 HTML 백업은 유지됩니다."}</p><div className="modal-actions"><button className="button" onClick={() => setConfirm(null)} disabled={pending}>취소</button><button className="button button-danger-solid" onClick={() => void action(confirm === "all" ? undefined : confirm, true)} disabled={pending}>{pending ? "삭제 중…" : "영구 삭제"}</button></div></div> : <><div className="trash-modal-list">{loading ? <p className="muted">불러오는 중…</p> : items.length ? items.map((item) => <div className="trash-item" key={item.id}><span><strong>{item.title ?? `${item.speaker_name ? `${item.speaker_name}: ` : ""}${item.content?.slice(0, 100) ?? ""}`}</strong>{item.purge_after && <small>{Math.max(0, Math.ceil((new Date(item.purge_after).getTime() - Date.now()) / 86400000))}일 후 삭제</small>}</span><div className="row-actions"><button className="button" onClick={() => void action(item)} disabled={pending}><RotateCcw size={14} />복원</button>{kind === "resources" && <button className="button button-danger" aria-label={`${item.title} 영구 삭제`} onClick={() => setConfirm(item)} disabled={pending}><Trash2 size={14} /></button>}</div></div>) : <p className="muted">휴지통이 비어 있습니다.</p>}</div><div className="modal-actions">{canEmpty && <button className="button button-danger" onClick={() => setConfirm("all")} disabled={pending || loading || !items.length}><Trash2 size={14} />휴지통 비우기</button>}<button className="button" onClick={onClose} disabled={pending}>닫기</button></div></>}
  </section></div>, document.body);
}
