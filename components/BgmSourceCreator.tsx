"use client";

import { Plus, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { BgmUploadDialog } from "@/components/BgmUploadDialog";
import { BgmDetailsDialog } from "@/components/BgmDetailsDialog";

export function BgmSourceCreator({ onCreated }: { onCreated: () => void | Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [youtubeOpen, setYoutubeOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function addYoutube(values: { title: string; youtubeUrl?: string }) {
    setPending(true);
    try {
      const response = await fetch("/api/bgm/library", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "YouTube BGM을 추가하지 못했습니다.");
      await onCreated();
    }
    finally { setPending(false); }
  }
  async function uploadFile(file: File, title: string) {
    if (!/\.mp3$/i.test(file.name) || file.size <= 0 || file.size > 25_000_000) throw new Error("25MB 이하 MP3 파일만 사용할 수 있습니다.");
    setPending(true);
    try {
      const prepare = await fetch("/api/bgm/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, originalFilename: file.name, mimeType: "audio/mpeg", byteSize: file.size }) });
      const target = await prepare.json().catch(() => ({})); if (!prepare.ok) throw new Error(target.error ?? "업로드를 준비하지 못했습니다.");
      const { error } = await createSupabaseBrowserClient().storage.from("bgm-audio").uploadToSignedUrl(target.path, target.token, file, { contentType: "audio/mpeg" });
      if (error) throw new Error("MP3를 업로드하지 못했습니다.");
      const confirm = await fetch("/api/bgm/upload", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetId: target.assetId }) });
      const result = await confirm.json().catch(() => ({})); if (!confirm.ok) throw new Error(result.error ?? "업로드를 확정하지 못했습니다.");
    } finally { setPending(false); }
  }
  return <div className="bgm-source-creator"><button className="button" onClick={() => input.current?.click()} disabled={pending}><Upload size={14} />새 MP3</button><input ref={input} className="visually-hidden" type="file" accept="audio/mpeg,.mp3" multiple onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) setSelectedFiles(files); }} /><button className="button" onClick={() => setYoutubeOpen(true)} disabled={pending}><Plus size={14} />새 YouTube BGM</button>{selectedFiles.length > 0 && <BgmUploadDialog key={selectedFiles.map((file) => file.name + file.lastModified).join("|")} files={selectedFiles} onUpload={uploadFile} onChanged={async () => { await onCreated(); }} onClose={() => setSelectedFiles([])} />}{youtubeOpen && <BgmDetailsDialog heading="YouTube BGM 추가" initialUrl="" onSave={addYoutube} onClose={() => setYoutubeOpen(false)} />}</div>;
}
