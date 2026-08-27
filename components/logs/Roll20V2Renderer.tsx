/* eslint-disable @next/next/no-img-element -- imported Roll20 URLs are arbitrary HTTPS resources and cannot use a fixed Next image allowlist */
import React, { type CSSProperties, type ReactNode } from "react";
import type { InlineRollBlock, LogBlock, LogEntryDocument, RichNode, RichStyle, RollTemplateBlock, RollTemplateField } from "@/lib/logs/model/types";

type TextEditor = { onChange: (id: string, text: string) => void };

function localizedResultLabel(level: RollTemplateBlock["resultLevel"]) {
  return level ? ({ critical: "대성공", extreme: "극단적 성공", hard: "어려운 성공", success: "성공", failure: "실패", fumble: "대실패" } as const)[level] : null;
}

function reactProperty(property: string) {
  return property.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function styleObject(style: RichStyle) {
  const result: Record<string, string> = {};
  for (const declaration of style) {
    const property = reactProperty(declaration.property);
    if (property in result) delete result[property];
    result[property] = declaration.value;
  }
  return result as CSSProperties;
}

function Roll20InlineRoll({ roll }: { roll: InlineRollBlock }) {
  return <span className={`r20-inline-roll r20-inline-roll--${roll.state ?? "normal"}`} title={roll.tooltip ?? roll.expression ?? undefined}>{roll.value}</span>;
}

function EditableText({ id, text, editor }: { id: string; text: string; editor?: TextEditor }): ReactNode {
  if (!editor) return text;
  return <span className="r20-editable-text" contentEditable suppressContentEditableWarning onInput={(event) => editor.onChange(id, event.currentTarget.innerText)}>{text}</span>;
}

function RichNodeView({ node, editor }: { node: RichNode; editor?: TextEditor }): ReactNode {
  if (node.type === "text") return <EditableText id={node.id} text={node.text} editor={editor} />;
  if (node.type === "break") return <br />;
  if (node.type === "image") {
    const image = <img className="r20-rich-image" src={node.src} alt={node.alt ?? ""} style={styleObject(node.style)} loading="lazy" />;
    return node.href ? <a href={node.href} target="_blank" rel="noopener noreferrer">{image}</a> : image;
  }
  if (node.type === "inline-roll") return <Roll20InlineRoll roll={node.roll} />;
  const children = node.children.map((child) => <RichNodeView key={child.id} node={child} editor={editor} />);
  const props = { style: styleObject(node.style), title: node.title ?? undefined };
  if (!editor && node.tag === "a" && node.href) return <a {...props} href={node.href} target="_blank" rel="noopener noreferrer">{children}</a>;
  const Tag = node.tag === "a" ? "span" : node.tag;
  return <Tag {...props}>{children}</Tag>;
}

function richNeedsBlockFlow(nodes: RichNode[]): boolean {
  return nodes.some((node) => node.type === "element" && (["div", "p", "blockquote", "pre"].includes(node.tag) || richNeedsBlockFlow(node.children)));
}

function RichBlockView({ block, editor }: { block: Extract<LogBlock, { type: "rich" }>; editor?: TextEditor }) {
  const blockFlow = richNeedsBlockFlow(block.nodes);
  const Tag = blockFlow ? "div" : "span";
  return <Tag className={`log-rich-context r20-rich-context ${blockFlow ? "r20-rich-context--block" : "r20-rich-context--inline"}`}>{block.nodes.map((node) => <RichNodeView key={node.id} node={node} editor={editor} />)}</Tag>;
}

function fieldValue(field: RollTemplateField) {
  return field.content.length ? field.content.map((part) => part.type === "text" ? <span key={part.id}>{part.text}</span> : <Roll20InlineRoll key={part.id} roll={part} />) : field.value;
}

function templateRows(block: RollTemplateBlock) {
  if (block.system !== "coc7") return block.fields.map((field) => ({ key: field.id, label: field.label, value: fieldValue(field), result: field.key === "result" }));
  const semantic = Object.fromEntries(block.fields.map((field) => [field.key, field]));
  const consumed = new Set(["target", "hard", "extreme", "rolled", "result"]);
  const rows: Array<{ key: string; label: string; value: ReactNode; result?: boolean }> = [];
  if (semantic.target || semantic.hard || semantic.extreme) rows.push({ key: "thresholds", label: "기준치", value: [semantic.target?.value, semantic.hard?.value, semantic.extreme?.value].filter(Boolean).join(" / ") });
  if (semantic.rolled) rows.push({ key: "rolled", label: "굴림", value: fieldValue(semantic.rolled) });
  const resultLabel = block.resultLabel || semantic.result?.value || localizedResultLabel(block.resultLevel);
  if (resultLabel) rows.push({ key: "result", label: "판정결과", value: resultLabel, result: true });
  for (const field of block.fields) if (!consumed.has(field.key)) rows.push({ key: field.id, label: field.label, value: fieldValue(field) });
  return rows;
}

function BlockView({ block, editor }: { block: LogBlock; editor?: TextEditor }) {
  if (block.type === "text") return <span className="r20-text"><EditableText id={block.id} text={block.text} editor={editor} /></span>;
  if (block.type === "inline-roll") return <Roll20InlineRoll roll={block} />;
  if (block.type === "image") {
    const style: CSSProperties = { width: block.display?.width ?? undefined, height: block.display?.height ?? undefined, minWidth: block.display?.minWidth ?? undefined, maxWidth: block.display?.maxWidth ?? undefined };
    const image = <img className="r20-image" src={block.src} alt={block.alt ?? ""} style={style} loading="lazy" />;
    return <figure className={`r20-image-block r20-image-block--${block.display?.align ?? "default"}`}>{block.href ? <a href={block.href} target="_blank" rel="noopener noreferrer">{image}</a> : image}{block.caption && <figcaption>{block.caption}</figcaption>}</figure>;
  }
  if (block.type === "rich") return <RichBlockView block={block} editor={editor} />;
  const rows = templateRows(block);
  const resultLabel = block.resultLabel || localizedResultLabel(block.resultLevel);
  return (
    <section className={`r20-template r20-template--${block.resultLevel ?? "normal"}`}>
      <table className="r20-template__table">
        {block.title && <caption>{block.title}</caption>}
        <tbody>{rows.map((row) => <tr className={`r20-template__field${row.result ? " r20-template__field--result" : ""}`} key={row.key}><td className="r20-template__label">{row.label}{/[：:]$/.test(row.label) ? "" : ":"}</td><td className={`r20-template__value${row.result && block.resultLevel ? ` r20-template__value--${block.resultLevel}` : ""}`}>{row.value}</td></tr>)}</tbody>
      </table>
      {!rows.some((row) => row.result) && resultLabel && <div className="r20-template__result">{resultLabel}</div>}
    </section>
  );
}

export function Roll20V2Renderer({ document, textEditor }: { document: LogEntryDocument; textEditor?: TextEditor }) {
  const presentation = document.presentation ?? {
    speakerExplicit: Boolean(document.speaker?.name),
    avatarExplicit: Boolean(document.speaker?.avatarUrl),
    timestampExplicit: Boolean(document.timestamp.raw),
    continuation: false
  };
  const showSpeaker = document.kind === "dialogue" && presentation.speakerExplicit && Boolean(document.speaker?.name);
  const showAvatar = document.kind === "dialogue" && presentation.avatarExplicit && Boolean(document.speaker?.avatarUrl);
  const showTimestamp = presentation.timestampExplicit && Boolean(document.timestamp.raw);
  return (
    <article className={`r20-message r20-message--${document.kind}${presentation.continuation ? " r20-message--continuation" : ""}`}>
      {document.kind === "dialogue" && <div className="r20-message__avatar-slot">{showAvatar && <img className="r20-message__avatar" src={document.speaker!.avatarUrl!} alt="" loading="lazy" />}</div>}
      <div className="r20-message__body">
        {showTimestamp && <time className="r20-message__timestamp" dateTime={document.timestamp.iso ?? undefined}>{document.timestamp.raw}</time>}
        <div className="r20-message__content-flow">
          {showSpeaker && <strong className="r20-message__speaker" style={{ color: document.speaker?.color ?? undefined }}>{document.speaker!.name}:</strong>}
          {document.blocks.map((block) => <BlockView key={block.id} block={block} editor={textEditor} />)}
        </div>
      </div>
    </article>
  );
}
