"use client";

import { useState } from "react";
import { Archive, X } from "lucide-react";
import { useEscapeClose } from "@/lib/use-escape-close";
import { createStoredZip, type StoredZipFile } from "@/lib/external-export/zip";
import { buildExternalIndexHtml, EXTERNAL_VIEWER_CSS, EXTERNAL_VIEWER_JS } from "@/lib/external-export/viewer";
import type { ExternalExportPayload } from "@/lib/external-export/types";

function formatBytes(value: number) {
  if (value < 1_000_000) return `${Math.max(1, Math.round(value / 1_000)).toLocaleString("ko-KR")} KB`;
  return `${(value / 1_000_000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })} MB`;
}

async function loadBatch(pageId: string, offset: number) {
  const response = await fetch(`/api/pages/${pageId}/external-export?offset=${offset}`, { cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? "외부용 로그 정보를 불러오지 못했습니다.");
  return result as ExternalExportPayload;
}

export function ExternalExportDialog({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("내보내기 준비됨");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  useEscapeClose(onClose, pending);

  async function download() {
    if (pending) return;
    setPending(true); setError(""); setProgress(0); setStatus("로그 정보를 준비하는 중…");
    try {
      const first = await loadBatch(pageId, 0);
      const entries = [...first.manifest.entries];
      const assets = new Map(first.assets.map((asset) => [asset.path, asset]));
      let nextOffset = first.nextOffset;
      while (nextOffset !== null) {
        setStatus(`로그 메시지 불러오는 중… ${entries.length.toLocaleString("ko-KR")} / ${first.totalEntries.toLocaleString("ko-KR")}`);
        const batch = await loadBatch(pageId, nextOffset);
        entries.push(...batch.manifest.entries);
        for (const asset of batch.assets) assets.set(asset.path, asset);
        nextOffset = batch.nextOffset;
        setProgress(first.totalEntries ? Math.min(35, Math.round(entries.length / first.totalEntries * 35)) : 35);
      }
      const manifest = { ...first.manifest, entries };
      const exportAssets = [...assets.values()];
      const assetFiles: StoredZipFile[] = [];
      let downloadedBytes = 0;
      for (let index = 0; index < exportAssets.length; index += 1) {
        const asset = exportAssets[index];
        setStatus(`BGM·이미지 받는 중… ${index + 1} / ${exportAssets.length}`);
        const response = await fetch(asset.url, { cache: "no-store" });
        if (!response.ok) throw new Error(`파일을 포함하지 못했습니다: ${asset.path}`);
        const blob = await response.blob();
        downloadedBytes += blob.size;
        assetFiles.push({ path: asset.path, data: blob });
        setProgress(35 + Math.round((index + 1) / Math.max(1, exportAssets.length) * 40));
      }
      const manifestJson = JSON.stringify(manifest, null, 2);
      const files: StoredZipFile[] = [
        { path: "index.html", data: buildExternalIndexHtml(manifest) },
        { path: "manifest.json", data: manifestJson },
        { path: "assets/styles.css", data: EXTERNAL_VIEWER_CSS },
        { path: "assets/viewer.js", data: EXTERNAL_VIEWER_JS },
        { path: "README.txt", data: "LogContainer 읽기 전용 세션 로그 백업입니다. 그누보드 importer는 manifest.json의 format과 version을 확인한 뒤 파일을 처리해야 합니다. index.html은 압축을 푼 뒤 직접 열어 확인할 수 있습니다.\r\n" },
        ...assetFiles
      ];
      setStatus(`ZIP 만드는 중… 포함 파일 ${files.length.toLocaleString("ko-KR")}개 · ${formatBytes(downloadedBytes)}`);
      const zip = await createStoredZip(files, (completed, total) => setProgress(75 + Math.round(completed / total * 25)));
      const objectUrl = URL.createObjectURL(zip);
      const anchor = document.createElement("a");
      anchor.href = objectUrl; anchor.download = first.filename; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
      setProgress(100); setStatus(`완료 · ${formatBytes(zip.size)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ZIP을 만들지 못했습니다.");
      setStatus("내보내기 실패");
    } finally {
      setPending(false);
    }
  }

  return <div className="modal-backdrop" onMouseDown={pending ? undefined : onClose}>
    <section className="modal-card external-export-modal" onMouseDown={(event) => event.stopPropagation()}>
      <button className="modal-close" onClick={onClose} disabled={pending}><X size={17} /></button>
      <h2>외부 사이트용 로그 백업</h2>
      <p>현재 표시 상태의 읽기 전용 로그와 대기·블록 BGM을 하나의 ZIP으로 만듭니다. 핸드아웃의 텍스트·이미지와 현재 로그에 표시되는 아바타 이미지만 함께 포함하며, 세션 카드 이미지는 제외합니다.</p>
      <p className="muted">YouTube BGM은 영상 ID로 저장되며 재생할 때 인터넷 연결이 필요합니다. 원본 사이트의 수정 이력과 로그인 정보는 포함하지 않습니다.</p>
      <div className="external-export-progress" aria-live="polite"><progress max="100" value={progress} /><span>{status}</span></div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions"><button className="button" onClick={onClose} disabled={pending}>닫기</button><button className="button button-primary" onClick={() => void download()} disabled={pending}><Archive size={15} />{pending ? "백업 만드는 중…" : "ZIP 다운로드"}</button></div>
    </section>
  </div>;
}
