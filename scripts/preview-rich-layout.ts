// Anonymized regression preview; never loads user logs or connects to the DB.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Roll20V2Renderer } from "../components/logs/Roll20V2Renderer";
import { importRoll20HtmlV2 } from "../lib/logs/roll20/import-v2";

const source = '<div class="message desc" data-messageid="offset"> <a style="font-size:7pt;position:absolute;width:100%;top:10px;left:0;display:block">Small heading</a><a style="position:relative;padding-top:12px;display:inline-block">Body text</a></div><div class="message desc" data-messageid="break"><div style="display:block;text-align:center"><br>First<br><br>Second<br></div></div>';
const documents = importRoll20HtmlV2(source).documents;
const content = documents.map(document => renderToStaticMarkup(createElement(Roll20V2Renderer, { document }))).join("");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
createServer((request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  if (request.url === "/fonts") {
    response.end(`<!doctype html><html><head><style>${css}</style></head><body style="--system-font-family:GowoonDodum,sans-serif"><div class="workspace-shell" style="--system-font-family:GowoonDodum,sans-serif"><main class="workspace-content" data-font="ridi-batang"><span class="live-status">시스템 상태</span><input class="page-title-input" aria-label="글 제목" value="글 제목 폰트"><button class="button">시스템 버튼</button><div class="page-overview">글 개요</div><article class="log-entry"><div class="r20-message__content-flow">글 내용 <span style="font-family:monospace">사용자 CSS</span></div><time class="r20-message__timestamp">날짜</time><button>편집 저장</button></article></main></div><section class="modal-card"><h2>포털 메뉴</h2><button>포털 버튼</button></section></body></html>`);
    return;
  }
  response.end(`<!doctype html><html><head><style>${css}</style></head><body><main style="padding:40px;max-width:700px"><h2>Corrected</h2><section id="corrected">${content}</section><h2>Previous anchor</h2><section id="previous"><style>#previous .r20-message__content-flow{position:static}#previous .r20-rich-context--block{position:relative}</style>${content}</section></main></body></html>`);
}).listen(3015, "127.0.0.1", () => console.log("Rich regression preview: http://127.0.0.1:3015"));
