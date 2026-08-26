import * as cheerio from "cheerio";
import type { AnyNode, Text } from "domhandler";
import sanitizeHtml from "sanitize-html";

function collectTextNodes(node: AnyNode, nodes: Text[] = []) {
  if (node.type === "text") {
    if ((node.data ?? "").trim()) nodes.push(node);
    return nodes;
  }
  if ("children" in node && node.children) {
    node.children.forEach((child) => collectTextNodes(child, nodes));
  }
  return nodes;
}

export function replaceTextPreservingMarkup(rawHtml: string | null, nextText: string) {
  if (!rawHtml) return null;
  const $ = cheerio.load(rawHtml, { xml: false });
  const roots = $("body").contents().toArray();
  const textNodes = roots.flatMap((node) => collectTextNodes(node));
  if (!textNodes.length) return rawHtml;
  textNodes[textNodes.length - 1].data = nextText;
  return $("body").html();
}

function escapeHtmlText(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character] ?? character);
}

export function buildNewEntryHtml(entryType: string, speakerName: string, content: string) {
  const speaker = speakerName.trim();
  const typeClass = entryType === "system" ? "desc" : "general";
  return `<div class="message ${typeClass}">${speaker ? `<strong class="by">${escapeHtmlText(speaker)}:</strong> ` : ""}<span class="content">${escapeHtmlText(content).replace(/\n/g, "<br>")}</span></div>`;
}

export function sanitizeLogHtml(rawHtml: string) {
  return sanitizeHtml(rawHtml, {
    allowedTags: [
      "div", "span", "p", "br", "strong", "b", "em", "i", "u", "s", "small",
      "blockquote", "pre", "code", "ul", "ol", "li", "table", "thead", "tbody",
      "tfoot", "tr", "th", "td", "caption", "figure", "figcaption", "dl", "dt", "dd", "img", "a"
    ],
    allowedAttributes: {
      "*": ["class", "style", "title", "aria-label", "data-result-type", "data-orig-result"],
      a: ["href", "title"],
      img: ["src", "alt", "title", "width", "height"]
    },
    allowedStyles: {
      "*": {
        color: [/^(?:#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]+)$/i],
        "background-color": [/^(?:#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|[a-z]+)$/i],
        "font-size": [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/],
        "font-weight": [/^(?:normal|bold|[1-9]00)$/],
        "font-style": [/^(?:normal|italic|oblique)$/],
        "text-align": [/^(?:left|right|center|justify)$/],
        "text-decoration": [/^(?:none|underline|line-through)$/],
        "white-space": [/^(?:normal|nowrap|pre|pre-wrap|pre-line)$/],
        display: [/^(?:block|inline|inline-block|table|table-row|table-cell|flex|grid|none)$/],
        width: [/^(?:auto|\d+(?:\.\d+)?(?:px|em|rem|%))$/],
        height: [/^(?:auto|\d+(?:\.\d+)?(?:px|em|rem|%))$/],
        "max-width": [/^(?:none|\d+(?:\.\d+)?(?:px|em|rem|%))$/],
        margin: [/^[\d\s.%-]+(?:px|em|rem|%)?$/],
        padding: [/^[\d\s.%-]+(?:px|em|rem|%)?$/],
        border: [/^[\d\s.a-z#(),%-]+$/i],
        "border-radius": [/^[\d\s.%-]+(?:px|em|rem|%)?$/]
      }
    },
    allowedSchemes: ["http", "https"],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attribs) => ({
        tagName: "a",
        attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" }
      })
    }
  });
}
