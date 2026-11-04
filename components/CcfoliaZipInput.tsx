"use client";

import { useEffect, useRef, useState } from "react";
import { extractCcfoliaZipTab, listCcfoliaZipTabs, MAX_CCFOLIA_ZIP_SIZE, type CcfoliaZipTab } from "@/lib/logs/ccfolia/zip";

export function CcfoliaZipInput({ disabled, onReady }: { disabled: boolean; onReady: (file: File | null) => void }) {
  const [tabs, setTabs] = useState<CcfoliaZipTab[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const archive = useRef<Uint8Array | null>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);

  async function open(file: File | undefined) {
    const current = ++generation.current;
    archive.current = null;
    onReady(null); setTabs([]); setSelected(""); setError(""); setReading(false);
    if (!file) return;
    if (file.size > MAX_CCFOLIA_ZIP_SIZE) { setError("ZIP 파일은 최대 50MB까지 선택할 수 있습니다."); return; }
    setReading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (current !== generation.current) return;
      const available = listCcfoliaZipTabs(bytes);
      archive.current = bytes; setTabs(available);
    } catch { if (current === generation.current) setError("ZIP 파일을 읽지 못했습니다. 탭별 HTML이 포함된 올바른 ZIP인지 확인해주세요."); }
    finally { if (current === generation.current) setReading(false); }
  }

  function choose(path: string) {
    onReady(null); setSelected(path); setError("");
    if (!path || !archive.current) return;
    try {
      const payload = extractCcfoliaZipTab(archive.current, path);
      onReady(new File([new Uint8Array(payload).buffer], path.split(/[\\/]/).at(-1)!, { type: "text/html" }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "선택한 HTML을 읽지 못했습니다."); }
  }

  return <>
    <label className="field">코코포리아 로그 ZIP (최대 50MB)<input type="file" accept=".zip,application/zip" disabled={disabled} onChange={(event) => void open(event.target.files?.[0])} /></label>
    {reading && <p role="status">ZIP의 HTML 탭을 확인하는 중…</p>}
    {tabs.length > 0 && <label className="field">표시할 HTML 탭<select value={selected} disabled={disabled || reading} onChange={(event) => choose(event.target.value)} required><option value="" disabled>탭 하나를 선택해주세요</option>{tabs.map((tab) => <option key={tab.path} value={tab.path}>{tab.label} — {tab.path} ({(tab.size / 1024 / 1024).toFixed(2)}MB)</option>)}</select><span className="muted">선택한 HTML 하나만 변환해 업로드합니다. 전체 탭을 고르면 전체 로그가 표시됩니다.</span></label>}
    {error && <p className="error" role="alert">{error}</p>}
  </>;
}
