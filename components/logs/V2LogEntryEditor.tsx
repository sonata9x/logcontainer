"use client";

import type { LogBlock, LogEntryDocument, RichNode, RollTemplateField } from "@/lib/logs/model/types";
import { appendBlock, duplicateBlock, editorNodeId, editorTextToStyle, moveBlock, removeBlock, replaceBlock, replaceRichNode, styleToEditorText, type EditableBlockType } from "@/lib/logs/model/editor";

type Props = {
  document: LogEntryDocument;
  saving: boolean;
  onChange: (document: LogEntryDocument) => void;
  onSave: () => void;
  onCancel: () => void;
};

const BLOCK_LABELS: Record<EditableBlockType, string> = {
  text: "텍스트", rich: "꾸민 텍스트", image: "이미지", "inline-roll": "인라인 주사위", "roll-template": "판정표"
};

function nullable(value: string) { return value.trim() ? value : null; }

function SpeakerQuickEdit({ document, onChange }: Pick<Props, "document" | "onChange">) {
  return <label className="v2-editor__speaker">화자<input value={document.speaker?.name ?? ""} onChange={(event) => onChange({
    ...document,
    speaker: event.target.value || document.speaker ? { name: nullable(event.target.value), color: document.speaker?.color ?? null, avatarUrl: document.speaker?.avatarUrl ?? null } : null
  })} placeholder="화자명(선택)" /></label>;
}

function InlineRollFields({ block, onChange }: { block: Extract<LogBlock, { type: "inline-roll" }>; onChange: (block: Extract<LogBlock, { type: "inline-roll" }>) => void }) {
  return <div className="v2-editor-grid">
    <label>값<input value={block.value} onChange={(event) => onChange({ ...block, value: event.target.value })} /></label>
    <label>수식<input value={block.expression ?? ""} onChange={(event) => onChange({ ...block, expression: nullable(event.target.value) })} /></label>
    <label>상태<select value={block.state ?? "normal"} onChange={(event) => onChange({ ...block, state: event.target.value as typeof block.state })}><option value="normal">보통</option><option value="critical">대성공</option><option value="important">중요</option><option value="fumble">대실패</option></select></label>
    <label className="v2-editor-grid__wide">도움말<input value={block.tooltip ?? ""} onChange={(event) => onChange({ ...block, tooltip: nullable(event.target.value) })} /></label>
    {block.rawFormula && <label className="v2-editor-grid__wide">원본 수식<input value={block.rawFormula} readOnly /></label>}
  </div>;
}

function RichNodeEditor({ node, onChange, onDelete }: { node: RichNode; onChange: (node: RichNode) => void; onDelete: () => void }) {
  if (node.type === "text") return <div className="v2-rich-node"><label>텍스트<textarea value={node.text} onChange={(event) => onChange({ ...node, text: event.target.value })} /></label><button type="button" className="button button-danger" onClick={onDelete}>요소 삭제</button></div>;
  if (node.type === "break") return <div className="v2-rich-node v2-rich-node--compact"><span>줄바꿈</span><button type="button" className="button button-danger" onClick={onDelete}>삭제</button></div>;
  if (node.type === "inline-roll") return <div className="v2-rich-node"><strong>꾸민 내용 안의 인라인 주사위</strong><InlineRollFields block={node.roll} onChange={(roll) => onChange({ ...node, roll })} /><button type="button" className="button button-danger" onClick={onDelete}>요소 삭제</button></div>;
  if (node.type === "image") return <div className="v2-rich-node"><strong>꾸민 내용 안의 이미지</strong><div className="v2-editor-grid"><label className="v2-editor-grid__wide">이미지 주소<input value={node.src} onChange={(event) => onChange({ ...node, src: event.target.value })} /></label><label>링크<input value={node.href ?? ""} onChange={(event) => onChange({ ...node, href: nullable(event.target.value) })} /></label><label>대체 텍스트<input value={node.alt ?? ""} onChange={(event) => onChange({ ...node, alt: nullable(event.target.value) })} /></label><label className="v2-editor-grid__wide">고급 CSS<textarea value={styleToEditorText(node.style)} onChange={(event) => onChange({ ...node, style: editorTextToStyle(event.target.value) })} /></label></div><button type="button" className="button button-danger" onClick={onDelete}>요소 삭제</button></div>;
  return <details className="v2-rich-node" open>
    <summary>꾸민 요소 · {node.tag}</summary>
    <div className="v2-editor-grid">
      <label>요소 종류<select value={node.tag} onChange={(event) => onChange({ ...node, tag: event.target.value as typeof node.tag })}>{["span", "div", "p", "strong", "em", "small", "u", "s", "blockquote", "code", "pre", "a"].map((tag) => <option key={tag}>{tag}</option>)}</select></label>
      <label>링크<input value={node.href ?? ""} onChange={(event) => onChange({ ...node, href: nullable(event.target.value) })} /></label>
      <label className="v2-editor-grid__wide">설명<input value={node.title ?? ""} onChange={(event) => onChange({ ...node, title: nullable(event.target.value) })} /></label>
      <label className="v2-editor-grid__wide">고급 CSS<textarea value={styleToEditorText(node.style)} onChange={(event) => onChange({ ...node, style: editorTextToStyle(event.target.value) })} placeholder="color: #fff;\nbackground-color: #c2200e;" /></label>
    </div>
    <div className="v2-rich-children">{node.children.map((child) => <RichNodeEditor key={child.id} node={child} onChange={(replacement) => onChange({ ...node, children: replaceRichNode(node.children, child.id, replacement) })} onDelete={() => onChange({ ...node, children: replaceRichNode(node.children, child.id, null) })} />)}</div>
    <div className="v2-rich-add"><button type="button" className="button" onClick={() => onChange({ ...node, children: [...node.children, { id: editorNodeId("richtext"), type: "text", text: "" }] })}>+ 텍스트 요소</button><button type="button" className="button button-danger" onClick={onDelete}>꾸민 요소 삭제</button></div>
  </details>;
}

function RollTemplateEditor({ block, onChange }: { block: Extract<LogBlock, { type: "roll-template" }>; onChange: (block: Extract<LogBlock, { type: "roll-template" }>) => void }) {
  function updateField(index: number, patch: Partial<RollTemplateField>) {
    const fields = block.fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field);
    onChange({ ...block, fields });
  }
  return <div className="v2-template-editor">
    <div className="v2-editor-grid"><label className="v2-editor-grid__wide">제목<input value={block.title ?? ""} onChange={(event) => onChange({ ...block, title: nullable(event.target.value) })} /></label><label>결과 상태<select value={block.resultLevel ?? ""} onChange={(event) => onChange({ ...block, resultLevel: nullable(event.target.value) as typeof block.resultLevel })}><option value="">없음</option><option value="critical">대성공</option><option value="extreme">극단적 성공</option><option value="hard">어려운 성공</option><option value="success">성공</option><option value="failure">실패</option><option value="fumble">대실패</option></select></label><label>표시 결과<input value={block.resultLabel ?? ""} onChange={(event) => onChange({ ...block, resultLabel: nullable(event.target.value) })} /></label></div>
    <div className="v2-template-fields">{block.fields.map((field, index) => <div className="v2-template-field" key={field.id}><input aria-label="항목 이름" value={field.label} onChange={(event) => updateField(index, { label: event.target.value })} /><input aria-label="항목 값" value={field.value} onChange={(event) => updateField(index, { value: event.target.value, content: [{ id: field.content[0]?.id ?? editorNodeId("text"), type: "text", text: event.target.value }] })} /><button type="button" className="button button-danger" onClick={() => onChange({ ...block, fields: block.fields.filter((_item, itemIndex) => itemIndex !== index) })}>삭제</button></div>)}</div>
    <button type="button" className="button" onClick={() => onChange({ ...block, fields: [...block.fields, { id: editorNodeId("field"), key: `field-${block.fields.length + 1}`, label: "항목", value: "", content: [] }] })}>+ 판정 항목</button>
  </div>;
}

function BlockEditor({ block, onChange }: { block: LogBlock; onChange: (block: LogBlock) => void }) {
  if (block.type === "text") return <label>텍스트<textarea value={block.text} onChange={(event) => onChange({ ...block, text: event.target.value })} /></label>;
  if (block.type === "inline-roll") return <InlineRollFields block={block} onChange={onChange} />;
  if (block.type === "image") return <div className="v2-editor-grid"><label className="v2-editor-grid__wide">이미지 주소<input value={block.src} onChange={(event) => onChange({ ...block, src: event.target.value })} /></label><label>링크<input value={block.href ?? ""} onChange={(event) => onChange({ ...block, href: nullable(event.target.value) })} /></label><label>대체 텍스트<input value={block.alt ?? ""} onChange={(event) => onChange({ ...block, alt: nullable(event.target.value) })} /></label><label>캡션<input value={block.caption ?? ""} onChange={(event) => onChange({ ...block, caption: nullable(event.target.value) })} /></label><label>너비<input value={block.display?.width ?? ""} onChange={(event) => onChange({ ...block, display: { ...block.display, width: nullable(event.target.value) } })} /></label><label>높이<input value={block.display?.height ?? ""} onChange={(event) => onChange({ ...block, display: { ...block.display, height: nullable(event.target.value) } })} /></label><label>최대 너비<input value={block.display?.maxWidth ?? ""} onChange={(event) => onChange({ ...block, display: { ...block.display, maxWidth: nullable(event.target.value) } })} /></label><label>정렬<select value={block.display?.align ?? "left"} onChange={(event) => onChange({ ...block, display: { ...block.display, align: event.target.value as "left" | "center" | "right" } })}><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option></select></label></div>;
  if (block.type === "roll-template") return <RollTemplateEditor block={block} onChange={onChange} />;
  return <div className="v2-rich-editor">{block.nodes.map((node) => <RichNodeEditor key={node.id} node={node} onChange={(replacement) => onChange({ ...block, nodes: replaceRichNode(block.nodes, node.id, replacement) })} onDelete={() => onChange({ ...block, nodes: replaceRichNode(block.nodes, node.id, null) })} />)}<button type="button" className="button" onClick={() => onChange({ ...block, nodes: [...block.nodes, { id: editorNodeId("richtext"), type: "text", text: "" }] })}>+ 텍스트 요소</button></div>;
}

function MetadataEditor({ document, onChange }: Pick<Props, "document" | "onChange">) {
  const speaker = document.speaker ?? { name: null, color: null, avatarUrl: null };
  const presentation = document.presentation ?? { speakerExplicit: Boolean(speaker.name), avatarExplicit: Boolean(speaker.avatarUrl), timestampExplicit: Boolean(document.timestamp.raw), continuation: false };
  return <details className="v2-metadata-editor"><summary>메시지 정보</summary><div className="v2-editor-grid"><label>종류<select value={document.kind} onChange={(event) => onChange({ ...document, kind: event.target.value as LogEntryDocument["kind"] })}><option value="dialogue">대화</option><option value="description">지문</option><option value="system">시스템</option></select></label><label>화자 색<input value={speaker.color ?? ""} onChange={(event) => onChange({ ...document, speaker: { ...speaker, color: nullable(event.target.value) } })} /></label><label className="v2-editor-grid__wide">아바타 URL<input value={speaker.avatarUrl ?? ""} onChange={(event) => onChange({ ...document, speaker: { ...speaker, avatarUrl: nullable(event.target.value) } })} /></label><label>시간 표시<input value={document.timestamp.raw ?? ""} onChange={(event) => onChange({ ...document, timestamp: { ...document.timestamp, raw: nullable(event.target.value) } })} /></label><label>ISO 시간<input value={document.timestamp.iso ?? ""} onChange={(event) => onChange({ ...document, timestamp: { ...document.timestamp, iso: nullable(event.target.value) } })} /></label></div><div className="v2-presentation-options"><label><input type="checkbox" checked={presentation.speakerExplicit} onChange={(event) => onChange({ ...document, presentation: { ...presentation, speakerExplicit: event.target.checked } })} /> 화자 표시</label><label><input type="checkbox" checked={presentation.avatarExplicit} onChange={(event) => onChange({ ...document, presentation: { ...presentation, avatarExplicit: event.target.checked } })} /> 아바타 표시</label><label><input type="checkbox" checked={presentation.timestampExplicit} onChange={(event) => onChange({ ...document, presentation: { ...presentation, timestampExplicit: event.target.checked } })} /> 시간 표시</label><label><input type="checkbox" checked={presentation.continuation} onChange={(event) => onChange({ ...document, presentation: { ...presentation, continuation: event.target.checked } })} /> 연속 메시지</label></div></details>;
}

export function V2LogEntryEditor({ document, saving, onChange, onSave, onCancel }: Props) {
  const simple = document.blocks.length === 1 && document.blocks[0].type === "text";
  return <article className="log-entry v2-entry-editor">
    <SpeakerQuickEdit document={document} onChange={onChange} />
    <MetadataEditor document={document} onChange={onChange} />
    {simple ? <label className="v2-simple-content">내용<textarea autoFocus value={(document.blocks[0] as Extract<LogBlock, { type: "text" }>).text} onChange={(event) => onChange(replaceBlock(document, 0, { ...document.blocks[0] as Extract<LogBlock, { type: "text" }>, text: event.target.value }))} /></label> : <div className="v2-block-list">{document.blocks.map((block, index) => <section className="v2-block-editor" key={block.id}><header><strong>{BLOCK_LABELS[block.type]}</strong><span><button type="button" onClick={() => onChange(moveBlock(document, index, -1))} disabled={index === 0}>위로</button><button type="button" onClick={() => onChange(moveBlock(document, index, 1))} disabled={index === document.blocks.length - 1}>아래로</button><button type="button" onClick={() => onChange(duplicateBlock(document, index))}>복제</button><button type="button" onClick={() => onChange(removeBlock(document, index))}>삭제</button></span></header><BlockEditor block={block} onChange={(replacement) => onChange(replaceBlock(document, index, replacement))} /></section>)}</div>}
    <div className="v2-add-block"><span>현재 메시지에 블록 추가</span>{(["text", "rich", "image", "inline-roll", "roll-template"] as EditableBlockType[]).map((type) => <button type="button" className="button" key={type} onClick={() => onChange(appendBlock(document, type))}>+ {BLOCK_LABELS[type]}</button>)}</div>
    <div className="v2-editor-actions"><button type="button" className="button button-primary" onClick={onSave} disabled={saving}>{saving ? "저장 중…" : "저장"}</button><button type="button" className="button" onClick={onCancel} disabled={saving}>취소</button></div>
  </article>;
}
