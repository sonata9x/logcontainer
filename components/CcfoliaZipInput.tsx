"use client";

import { useEffect, useRef, useState } from "react";
import { extractCcfoliaZipTabs, listCcfoliaZipTabs, MAX_CCFOLIA_ZIP_SIZE, type CcfoliaZipTab } from "@/lib/logs/ccfolia/zip";

export function CcfoliaZipInput({ disabled, onReady }: { disabled: boolean; onReady: (file: File | null) => void }) {
  const [tabs, setTabs] = useState<CcfoliaZipTab[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const archive = useRef<Uint8Array | null>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);

  async function open(file: File | undefined) {
    const current = ++generation.current;
    archive.current = null;
    zipInput.current?.setCustomValidity(file ? "표시할 HTML 탭을 하나 이상 선택해주세요." : "");
    onReady(null); setTabs([]); setSelected([]); setError(""); setReading(false);
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

  function choose(paths: string[]) {
    onReady(null); setSelected(paths); setError("");
    zipInput.current?.setCustomValidity("표시할 HTML 탭을 하나 이상 선택해주세요.");
    if (!paths.length || !archive.current) return;
    try {
      const source = extractCcfoliaZipTabs(archive.current, paths);
      onReady(new File([source], "ccfolia-tabs.json", { type: "application/json" }));
      zipInput.current?.setCustomValidity("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "선택한 HTML을 읽지 못했습니다."); }
  }

  return <>
    <label className="field">코코포리아 로그 ZIP (최대 50MB)<input ref={zipInput} type="file" accept=".zip,application/zip" disabled={disabled} onChange={(event) => void open(event.target.files?.[0])} /></label>
    {reading && <p role="status">ZIP의 HTML 탭을 확인하는 중…</p>}
    {tabs.length > 0 && <fieldset className="import-options ccfolia-tab-options" disabled={disabled || reading}><legend>표시할 HTML 탭 (여러 개 선택 가능)</legend>{tabs.map((tab) => <label key={tab.path}><input type="checkbox" checked={selected.includes(tab.path)} onChange={(event) => choose(event.target.checked ? [...selected, tab.path] : selected.filter((path) => path !== tab.path))} /><span>{tab.label} <small className="muted">({(tab.size / 1024 / 1024).toFixed(2)}MB)</small></span></label>)}<span className="muted">선택한 {selected.length}개 탭을 각각 나누어 표시합니다. 선택한 HTML의 업로드 합계는 최대 12MB입니다. 전체 탭은 다른 탭의 메시지도 포함합니다.</span></fieldset>}
    {error && <p className="error" role="alert">{error}</p>}
  </>;
}
