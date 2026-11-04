import * as cheerio from "cheerio";
import { parseRichHtml } from "@/lib/logs/roll20/rich";
import { stableRoll20Id } from "@/lib/logs/roll20/id";
import { projectDocumentText } from "@/lib/logs/model/projection";
import { validateLogEntryDocument } from "@/lib/logs/model/validate";
import { safeImageUrl } from "@/lib/logs/model/url";
import type { LogEntryDocument } from "@/lib/logs/model/types";
import type { CanonicalImportResult } from "@/lib/logs/import/types";

export function importCcfoliaHtml(source: string): CanonicalImportResult {
  const $ = cheerio.load(source);
  const messages = $(".message-list > article.message").toArray();
  if (!messages.length) throw new Error("코코포리아 메시지를 찾지 못했습니다.");
  const avatars = new Map<string, string>();
  const css = $("style").text();
  for (const match of css.matchAll(/\.([\w-]+)\s*\{\s*background-image\s*:\s*url\(["']?([^"')]+)["']?\)/g)) {
    const url = safeImageUrl(match[2]);
    if (url) avatars.set(match[1], url);
  }
  const documents = messages.map((element, index): LogEntryDocument => {
    const node = $(element);
    const speaker = node.find(".speaker").first();
    const name = speaker.text().trim() || null;
    const color = speaker.attr("style")?.match(/(?:^|;)\s*(?:--speaker-color|color)\s*:\s*(#[\da-f]{3,8}|rgba?\([^;]+\)|hsla?\([^;]+\))/i)?.[1] ?? null;
    const time = node.find("time.timestamp").first();
    const iso = time.attr("datetime") ?? null;
    const channel = node.find(".channel-name").first().text().trim().replace(/^\[|\]$/g, "");
    const avatar = (node.find(".avatar").attr("class") ?? "").split(/\s+/).map((key) => avatars.get(key)).find(Boolean) ?? null;
    const body = node.find(".message-text, .roll-result").filter((_i, el) => !$(el).parents(".message-text, .roll-result").length).clone();
    body.find(".roll-result").add(body.filter(".roll-result")).each((_i, el) => {
      const roll = $(el);
      const resultColor = roll.is(".success, .critical") ? "#2196f3" : roll.is(".failure, .fumble") ? "#dc004e" : "#888";
      roll.attr("style", `display:block;color:${resultColor};white-space:pre-wrap`);
    });
    const html = body.toArray().map((el) => $.html(el)).join("\n");
    const sourceKey = node.attr("data-message-id") || node.attr("id") || stableRoll20Id("ccfolia", iso, name, channel, index);
    const parsed = parseRichHtml(html, sourceKey);
    const document: LogEntryDocument = {
      version: 2, kind: node.hasClass("system") ? "system" : "dialogue",
      source: { platform: "ccfolia", messageId: sourceKey, sourceKey, sourceOrder: index, stream: { id: "main", name: channel || null }, messageType: node.hasClass("system") ? "system" : "message" },
      speaker: name || avatar ? { name, color, avatarUrl: avatar } : null,
      timestamp: { raw: time.text().trim() || null, iso },
      presentation: { speakerExplicit: Boolean(name), avatarExplicit: Boolean(avatar), timestampExplicit: Boolean(time.length), continuation: false },
      blocks: [{ id: stableRoll20Id("rich", sourceKey), type: "rich", nodes: parsed.nodes }], warnings: parsed.warnings
    };
    const validated = validateLogEntryDocument(document);
    if (!validated.ok) throw new Error(validated.error);
    return validated.document;
  });
  return {
    platform: "ccfolia", documents,
    entries: documents.map((document, index) => ({
      order_index: index, entry_type: document.kind === "dialogue" ? "dialogue" : "system",
      speaker_name: document.speaker?.name ?? null, speaker_color: document.speaker?.color ?? null,
      content: projectDocumentText(document), original_content: null, raw_html: null, document_version: 2,
      document, original_document: null, sort_key: (index + 1) * 1_000_000,
      has_image_content: JSON.stringify(document.blocks).includes('"type":"image"'), metadata: {}
    })),
    report: { provider: "ccfolia", parserVersion: 1, sourceFormat: "exported_html", importedAt: new Date().toISOString(), sourceMessageCount: messages.length, logicalMessageCount: documents.length, warningCount: documents.reduce((sum, doc) => sum + doc.warnings.length, 0) }
  };
}
