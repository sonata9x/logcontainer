const EXACT_GENERATED_CLASSES = new Set([
  "message", "general", "desc", "emote", "you", "spacer", "hidden-message", "avatar", "character-avatar",
  "tstamp", "timestamp", "by", "speaker", "author", "username", "message-sender", "byline", "inlinerollresult",
  "showtip", "tipsy-n-right", "importantroll", "fullcrit", "fullfail", "formula", "dicegrouping", "diceroll",
  "critsuccess", "critfail", "dicon", "didroll", "backing", "basicroll", "rolltype", "sheet-template_label",
  "sheet-template_value"
]);

export function roll20ClassNames(value: string | undefined) {
  return String(value ?? "").split(/\s+/).filter(Boolean);
}

export function isRoll20GeneratedClass(name: string) {
  return EXACT_GENERATED_CLASSES.has(name) || name.startsWith("sheet-rolltemplate-") || /^d\d+$/.test(name);
}

export function isRoll20GeneratedSubtree(classValue: string | undefined) {
  return roll20ClassNames(classValue).some(isRoll20GeneratedClass);
}

export function isRollTemplateClass(classValue: string | undefined) {
  return roll20ClassNames(classValue).some((name) => name.startsWith("sheet-rolltemplate-"));
}

export const ROLL20_HEADER_SELECTOR = ".avatar, .character-avatar, .tstamp, .timestamp, time, .by, .speaker, .author, .username, .message-sender, .byline, .spacer, [aria-hidden='true'], [hidden]";
