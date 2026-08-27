/* eslint-disable @next/next/no-img-element -- imported Roll20 URLs are arbitrary HTTPS resources and cannot use a fixed Next image allowlist */
import React, { type CSSProperties, type ReactNode } from "react";
import type { InlineRollBlock, LogBlock, LogEntryDocument, RichNode, RichStyle } from "@/lib/logs/model/types";

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

function RichNodeView({ node }: { node: RichNode }): ReactNode {
  if (node.type === "text") return node.text;
  if (node.type === "break") return <br />;
  if (node.type === "image") {
    const image = <img className="r20-rich-image" src={node.src} alt={node.alt ?? ""} style={styleObject(node.style)} loading="lazy" />;
    return node.href ? <a href={node.href} target="_blank" rel="noopener noreferrer">{image}</a> : image;
  }
  if (node.type === "inline-roll") return <Roll20InlineRoll roll={node.roll} />;
  const children = node.children.map((child) => <RichNodeView key={child.id} node={child} />);
  const props = { style: styleObject(node.style), title: node.title ?? undefined };
  if (node.tag === "a" && node.href) return <a {...props} href={node.href} target="_blank" rel="noopener noreferrer">{children}</a>;
  const Tag = node.tag === "a" ? "span" : node.tag;
  return <Tag {...props}>{children}</Tag>;
}

function BlockView({ block }: { block: LogBlock }) {
  if (block.type === "text") return <span className="r20-text">{block.text}</span>;
  if (block.type === "inline-roll") return <Roll20InlineRoll roll={block} />;
  if (block.type === "image") {
    const style: CSSProperties = { width: block.display?.width ?? undefined, height: block.display?.height ?? undefined, minWidth: block.display?.minWidth ?? undefined, maxWidth: block.display?.maxWidth ?? undefined };
    const image = <img className="r20-image" src={block.src} alt={block.alt ?? ""} style={style} loading="lazy" />;
    return <figure className={`r20-image-block r20-image-block--${block.display?.align ?? "left"}`}>{block.href ? <a href={block.href} target="_blank" rel="noopener noreferrer">{image}</a> : image}{block.alt && <figcaption>{block.alt}</figcaption>}</figure>;
  }
  if (block.type === "rich") return <div className="log-rich-context r20-rich-context">{block.nodes.map((node) => <RichNodeView key={node.id} node={node} />)}</div>;
  return (
    <section className={`r20-template r20-template--${block.resultLevel ?? "normal"}`}>
      {block.template && <div className="r20-template__kind">{block.template}</div>}
      {block.title && <h3 className="r20-template__title">{block.title}</h3>}
      <table className="r20-template__table"><tbody>{block.fields.map((field) => <tr className="r20-template__field" key={field.id}><th>{field.label}</th><td>{field.content.length ? field.content.map((part) => part.type === "text" ? <span key={part.id}>{part.text}</span> : <Roll20InlineRoll key={part.id} roll={part} />) : field.value}</td></tr>)}</tbody></table>
      {block.resultLevel && <div className="r20-template__result">{block.resultLevel}</div>}
    </section>
  );
}

export function Roll20V2Renderer({ document }: { document: LogEntryDocument }) {
  return (
    <article className={`r20-message r20-message--${document.kind}`}>
      {document.speaker?.avatarUrl && <img className="r20-message__avatar" src={document.speaker.avatarUrl} alt="" loading="lazy" />}
      <div className="r20-message__body">
        <div className="r20-message__line">
          {document.speaker?.name && <strong className="r20-message__speaker" style={{ color: document.speaker.color ?? undefined }}>{document.speaker.name}:</strong>}
          <div className="r20-message__content">{document.blocks.map((block) => <BlockView key={block.id} block={block} />)}</div>
        </div>
        {document.timestamp.raw && <time className="r20-message__timestamp" dateTime={document.timestamp.iso ?? undefined}>{document.timestamp.raw}</time>}
      </div>
    </article>
  );
}
