"use client";

import { useEffect, useRef } from "react";
import type { LogEntryDocument } from "@/lib/logs/model/types";
import { applyEditableTextChanges, editableTextSegments } from "@/lib/logs/model/user-edit";
import { Roll20V2Renderer } from "@/components/logs/Roll20V2Renderer";

type Props = {
  document: LogEntryDocument;
  saving: boolean;
  onChange: (document: LogEntryDocument) => void;
  onSave: () => void;
  onCancel: () => void;
};

export function InlineContentEditor({ document, saving, onChange, onSave, onCancel }: Props) {
  const rootRef = useRef<HTMLElement>(null);
  const hasText = editableTextSegments(document).length > 0;

  useEffect(() => {
    const editable = rootRef.current?.querySelector<HTMLElement>(".r20-editable-text");
    editable?.focus();
  }, []);

  return (
    <article className="log-entry log-entry-v2 inline-content-editor" ref={rootRef} onKeyDown={(event) => {
      if (event.key === "Escape") onCancel();
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") onSave();
    }}>
      <Roll20V2Renderer document={document} textEditor={{ onChange: (id, text) => onChange(applyEditableTextChanges(document, [{ id, text }])) }} />
      {!hasText && <p className="inline-content-editor__empty">이 메시지에는 바로 수정할 텍스트가 없습니다.</p>}
      <div className="inline-content-editor__actions">
        <button type="button" className="button button-primary" onClick={onSave} disabled={saving || !hasText}>{saving ? "저장 중…" : "저장"}</button>
        <button type="button" className="button" onClick={onCancel} disabled={saving}>취소</button>
      </div>
    </article>
  );
}
