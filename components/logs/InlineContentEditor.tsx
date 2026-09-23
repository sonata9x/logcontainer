"use client";

import { useEffect, useRef } from "react";
import type { LogEntryDocument } from "@/lib/logs/model/types";
import { applyEditableImageChanges, applyEditableTextChanges, editableImageTargets, editableTextSegments, type EditableImageChange } from "@/lib/logs/model/user-edit";
import { Roll20V2Renderer } from "@/components/logs/Roll20V2Renderer";

type Props = {
  document: LogEntryDocument;
  imagesOnly?: boolean;
  saving: boolean;
  onChange: (document: LogEntryDocument) => void;
  onSave: () => void;
  onCancel: () => void;
};

export function InlineContentEditor({ document, imagesOnly = false, saving, onChange, onSave, onCancel }: Props) {
  const rootRef = useRef<HTMLElement>(null);
  const hasText = !imagesOnly && editableTextSegments(document).length > 0;
  const images = editableImageTargets(document);

  function changeImage(id: string, values: Partial<EditableImageChange>) {
    const target = images.find((image) => image.id === id);
    if (!target) return;
    onChange(applyEditableImageChanges(document, [{
      id,
      src: values.src ?? target.src,
      href: values.href === undefined ? target.href : values.href,
      alt: values.alt === undefined ? target.alt : values.alt,
      caption: values.caption === undefined ? target.caption : values.caption,
      align: values.align === undefined ? target.align : values.align
    }]));
  }

  useEffect(() => {
    const editable = rootRef.current?.querySelector<HTMLElement>(".r20-editable-text");
    editable?.focus();
  }, []);

  return (
    <article className="log-entry log-entry-v2 inline-content-editor" ref={rootRef} onKeyDown={(event) => {
      if (event.key === "Escape") onCancel();
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") onSave();
    }}>
      <Roll20V2Renderer document={document} textEditor={imagesOnly ? undefined : { onChange: (id, text) => onChange(applyEditableTextChanges(document, [{ id, text }])) }} />
      {images.length > 0 && <div className="inline-image-editor">
        {images.map((image, index) => <fieldset key={image.id}>
          <legend>이미지 {images.length > 1 ? index + 1 : ""}</legend>
          <label className="field">이미지 링크<input type="url" value={image.src} required onChange={(event) => changeImage(image.id, { src: event.target.value })} /></label>
          <label className="field">클릭 링크 (선택)<input type="url" value={image.href ?? ""} onChange={(event) => changeImage(image.id, { href: event.target.value || null })} /></label>
          <label className="field">대체 텍스트 (선택)<input value={image.alt ?? ""} maxLength={500} onChange={(event) => changeImage(image.id, { alt: event.target.value || null })} /></label>
          {image.kind === "block" && <>
            <label className="field">캡션 (선택)<input value={image.caption ?? ""} maxLength={500} onChange={(event) => changeImage(image.id, { caption: event.target.value || null })} /></label>
            <label className="field">정렬<select value={image.align ?? ""} onChange={(event) => changeImage(image.id, { align: (event.target.value || null) as EditableImageChange["align"] })}><option value="">기본</option><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option></select></label>
          </>}
        </fieldset>)}
      </div>}
      {!hasText && !images.length && <p className="inline-content-editor__empty">이 메시지에는 바로 수정할 수 있는 텍스트나 이미지가 없습니다.</p>}
      <div className="inline-content-editor__actions">
        <button type="button" className="button button-primary" onClick={onSave} disabled={saving || (!hasText && !images.length) || images.some((image) => !image.src.trim())}>{saving ? "저장 중…" : "저장"}</button>
        <button type="button" className="button" onClick={onCancel} disabled={saving}>취소</button>
      </div>
    </article>
  );
}
