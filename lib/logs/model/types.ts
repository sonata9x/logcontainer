export type ParserWarning = {
  code: string;
  message: string;
  sourceMessageId?: string | null;
  path?: string | null;
  detail?: string | null;
};

export type RichStyleDeclaration = {
  property: string;
  value: string;
};

export type RichStyle = RichStyleDeclaration[];

export type InlineRollState = "normal" | "critical" | "fumble" | "important" | null;

export type TextBlock = {
  id: string;
  type: "text";
  text: string;
};

export type InlineRollBlock = {
  id: string;
  type: "inline-roll";
  value: string;
  expression: string | null;
  state: InlineRollState;
  tooltip?: string | null;
  rawFormula?: string | null;
};

export type ImageDisplay = {
  width?: string | null;
  height?: string | null;
  minWidth?: string | null;
  maxWidth?: string | null;
  align?: "left" | "center" | "right" | null;
};

export type ImageBlock = {
  id: string;
  type: "image";
  src: string;
  href: string | null;
  alt: string | null;
  caption?: string | null;
  display?: ImageDisplay;
};

export type RichTextNode = { id: string; type: "text"; text: string };
export type RichBreakNode = { id: string; type: "break" };
export type RichImageNode = {
  id: string;
  type: "image";
  src: string;
  href: string | null;
  alt: string | null;
  style: RichStyle;
};
export type RichInlineRollNode = {
  id: string;
  type: "inline-roll";
  roll: InlineRollBlock;
};
export type RichElementNode = {
  id: string;
  type: "element";
  tag: "span" | "div" | "p" | "strong" | "em" | "small" | "u" | "s" | "blockquote" | "code" | "pre" | "a";
  href: string | null;
  title: string | null;
  style: RichStyle;
  children: RichNode[];
};

export type RichNode = RichTextNode | RichBreakNode | RichImageNode | RichInlineRollNode | RichElementNode;

export type RichBlock = {
  id: string;
  type: "rich";
  nodes: RichNode[];
};

export type RollTemplateField = {
  id: string;
  key: string;
  label: string;
  value: string;
  content: Array<TextBlock | InlineRollBlock>;
};

export type RollTemplateBlock = {
  id: string;
  type: "roll-template";
  template: string | null;
  system: string | null;
  title: string | null;
  fields: RollTemplateField[];
  resultLevel: "critical" | "extreme" | "hard" | "success" | "failure" | "fumble" | null;
  resultLabel?: string | null;
  fallbackText: string;
};

export type LogBlock = TextBlock | RichBlock | ImageBlock | InlineRollBlock | RollTemplateBlock;

export type LogEntryDocument = {
  version: 2;
  kind: "dialogue" | "description" | "system";
  source: {
    platform: "roll20" | "takoyaki-box" | "manual";
    messageId: string | null;
    sourceKey: string | null;
    sourceOrder: number | null;
    stream?: { id: string; name: string | null } | null;
    messageType?: string | null;
  };
  speaker: {
    name: string | null;
    color: string | null;
    avatarUrl: string | null;
  } | null;
  timestamp: {
    raw: string | null;
    iso: string | null;
  };
  presentation?: {
    speakerExplicit: boolean;
    avatarExplicit: boolean;
    timestampExplicit: boolean;
    continuation: boolean;
    selfMessage?: boolean;
    private?: boolean;
  };
  blocks: LogBlock[];
  warnings: ParserWarning[];
};

export type TakoyakiBoxImportReportV1 = {
  provider: "takoyaki-box";
  parserVersion: 1;
  sourceFormat: "exported_html";
  importedAt: string;
  sourceMessageCount: number;
  logicalMessageCount: number;
  streamCount: number;
  warningCount: number;
  warnings: ParserWarning[];
};

export type Roll20ImportReportV2 = {
  provider: "roll20";
  parserVersion: 2;
  sourceFormat: "msgdata" | "rendered_html_fragment";
  importedAt: string;
  sourceMessageCount: number;
  logicalMessageCount: number;
  structuralDuplicateCount: number;
  errorDuplicateCount: number;
  hiddenRemovedCount: number;
  unknownFallbackCount: number;
  sanitizedStyleCount: number;
  droppedStyleCount: number;
  warningCount: number;
  warnings: ParserWarning[];
};
