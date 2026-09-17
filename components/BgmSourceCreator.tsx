"use client";

import { Plus, Upload } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { BgmUploadDialog } from "@/components/BgmUploadDialog";

export function BgmSourceCreator({ onCreated }: { onCreated: () => void | Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  async function addYoutube(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    setPending(true);
    try {
      const response = await fetch("/api/bgm/library", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: form.get("title"), youtubeUrl: form.get("youtubeUrl") }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "YouTube BGM을 추가하지 못했습니다.");
      element.reset(); await onCreated();
    } catch (error) { window.alert(error instanceof Error ? error.message : "BGM을 저장하지 못했습니다."); }
    finally { setPending(false); }
  }
  async function uploadFile(file: File, title: string) {
    if (!/\.mp3$/i.test(file.name) || file.size <= 0 || file.size > 25_000_000) throw new Error("25MB 이하 MP3 파일만 사용할 수 있습니다.");
    setPending(true);
    try {
      const prepare = await fetch("/api/bgm/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, mimeType: "audio/mpeg", byteSize: file.size }) });
      const target = await prepare.json().catch(() => ({})); if (!prepare.ok) throw new Error(target.error ?? "업로드를 준비하지 못했습니다.");
      const { error } = await createSupabaseBrowserClient().storage.from("bgm-audio").uploadToSignedUrl(target.path, target.token, file, { contentType: "audio/mpeg" });
      if (error) throw new Error("MP3를 업로드하지 못했습니다.");
      const confirm = await fetch("/api/bgm/upload", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetId: target.assetId }) });
      const result = await confirm.json().catch(() => ({})); if (!confirm.ok) throw new Error(result.error ?? "업로드를 확정하지 못했습니다.");
      await onCreated();
      setSelectedFile(null);
    } finally { setPending(false); }
  }
  return <div className="bgm-source-creator"><button className="button" onClick={() => input.current?.click()} disabled={pending}><Upload size={14} />새 MP3</button><input ref={input} className="visually-hidden" type="file" accept="audio/mpeg,.mp3" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) setSelectedFile(file); }} /><form className="bgm-youtube-form" onSubmit={addYoutube}><input name="title" placeholder="YouTube BGM 제목" maxLength={200} required /><input name="youtubeUrl" placeholder="YouTube 주소" required /><button className="button" disabled={pending}><Plus size={14} />추가</button></form>{selectedFile && <BgmUploadDialog key={selectedFile.name + selectedFile.lastModified} file={selectedFile} pending={pending} onUpload={(title) => uploadFile(selectedFile, title)} onClose={() => setSelectedFile(null)} />}</div>;
}
