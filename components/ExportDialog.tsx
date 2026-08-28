"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { defaultCorrectionSettings, type CorrectionSettings } from "@/lib/logs/corrections";
import { useEscapeClose } from "@/lib/use-escape-close";

export function ExportDialog({ endpoint, title, usePersonalDefaults, onClose }: { endpoint: string; title: string; usePersonalDefaults: boolean; onClose: () => void }) {
  const [settings, setSettings] = useState<CorrectionSettings>(defaultCorrectionSettings);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEscapeClose(onClose, pending);
  useEffect(() => {
    if (!usePersonalDefaults) return;
    void fetch("/api/account/settings").then((response) => response.json()).then((result) => { if (result.correctionSettings) setSettings(result.correctionSettings); }).catch(() => undefined);
  }, [usePersonalDefaults]);
  const toggles: Array<[keyof CorrectionSettings, string]> = [["remove_html_tags", "HTML 태그 제거"], ["normalize_ellipsis", "말줄임표 통일"], ["normalize_quotes", "큰따옴표 통일"], ["speaker_tab_format", "화자명 뒤에 탭"], ["clean_blank_lines", "빈 줄 정리"], ["mark_handout_position", "이미지·핸드아웃 위치 표시"]];
  async function download() {
    setPending(true); setError("");
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(settings) });
    if (!response.ok) { const result = await response.json().catch(() => ({})); setPending(false); return setError(result.error ?? "TXT를 만들지 못했습니다."); }
    const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${title.replace(/[\\/:*?"<>|]/g, "_") || "log"}.txt`; anchor.click(); URL.revokeObjectURL(url); setPending(false); onClose();
  }
  return <div className="modal-backdrop" onMouseDown={pending ? undefined : onClose}><section className="modal-card correction-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose} disabled={pending}><X size={17} /></button><h2>TXT 내보내기</h2><p>이번 다운로드에만 적용됩니다. 개인 기본값은 계정 설정에서 변경할 수 있습니다.</p><div className="correction-toggles">{toggles.map(([key, label]) => <label key={key}><input type="checkbox" checked={Boolean(settings[key])} onChange={(event) => setSettings((current) => ({ ...current, [key]: event.target.checked }))} disabled={pending} /> {label}</label>)}</div><div className="correction-symbols"><label>여는 따옴표<input value={settings.custom_quote_open} maxLength={8} onChange={(event) => setSettings((current) => ({ ...current, custom_quote_open: event.target.value }))} disabled={pending} /></label><label>닫는 따옴표<input value={settings.custom_quote_close} maxLength={8} onChange={(event) => setSettings((current) => ({ ...current, custom_quote_close: event.target.value }))} disabled={pending} /></label><label>말줄임표<input value={settings.custom_ellipsis} maxLength={8} onChange={(event) => setSettings((current) => ({ ...current, custom_ellipsis: event.target.value }))} disabled={pending} /></label><label>핸드아웃 기호<input value={settings.custom_handout_icon} maxLength={8} onChange={(event) => setSettings((current) => ({ ...current, custom_handout_icon: event.target.value }))} disabled={pending} /></label></div>{error && <p className="error">{error}</p>}<div className="modal-actions"><button className="button" onClick={onClose} disabled={pending}>취소</button><button className="button button-primary" onClick={download} disabled={pending}><Download size={14} />{pending ? "TXT 만드는 중…" : "다운로드"}</button></div></section></div>;
}
