import type { ExternalLogExportManifest } from "@/lib/external-export/types";
import type { ExternalExportEntry } from "@/lib/external-export/types";

export function inlineExportAvatarSources(entries: ExternalExportEntry[], sources: ReadonlyMap<string, string>) {
  if (!sources.size) return entries;
  return entries.map((entry) => {
    let html = entry.html;
    for (const [path, dataUrl] of sources) html = html.split(path).join(dataUrl);
    return html === entry.html ? entry : { ...entry, html };
  });
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function jsonForScript(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function playButton(placementKey: string, title: string, className = "") {
  return `<button class="bgm-play-button ${className}" type="button" data-bgm-placement="${escapeHtml(placementKey)}" aria-label="${escapeHtml(title)} 재생" title="${escapeHtml(title)} 재생">▶</button>`;
}

export function buildExternalIndexHtml(manifest: ExternalLogExportManifest) {
  const entryPlacement = new Map(manifest.bgm.filter((item) => item.role === "entry" && item.entryKey).map((item) => [item.entryKey!, item]));
  const waiting = manifest.bgm.filter((item) => item.role === "waiting");
  const entries = manifest.entries.map((entry) => {
    const placement = entryPlacement.get(entry.key);
    return `<div class="entry-wrap" data-entry-key="${escapeHtml(entry.key)}" data-stream="${entry.stream}" data-compact-spacing="${entry.compactSpacing}"${entry.stream === "casual" ? " hidden" : ""}><div class="entry-playback-anchor">${placement ? playButton(placement.key, placement.title, "entry-bgm-button") : ""}${entry.html}</div></div>`;
  }).join("");
  const waitingHtml = waiting.length ? `<div class="waiting-bgm"><span>대기 BGM</span>${waiting.map((item) => `<span>${playButton(item.key, item.title)}${escapeHtml(item.title)}</span>`).join("")}</div>` : "";
  const handoutButton = manifest.handouts.length ? `<button type="button" class="toolbar-button" id="handout-open">핸드아웃 <span>${manifest.handouts.length}</span></button>` : "";
  const overview = manifest.page.overview ? `<div class="page-overview">${escapeHtml(manifest.page.overview)}</div>` : "";
  const streamTabs = manifest.entries.some((entry) => entry.stream === "casual") ? `<nav class="log-stream-tabs" aria-label="로그 채널"><button type="button" class="active" data-stream-tab="main">메인</button><button type="button" data-stream-tab="casual">사담</button></nav>` : "";
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="generator" content="LogContainer external export v${manifest.version}">
  <title>${escapeHtml(manifest.page.title)}</title>
  <link rel="stylesheet" href="./assets/styles.css">
</head>
<body data-font="${escapeHtml(manifest.page.fontFamily)}">
  <header class="viewer-toolbar"><strong>${escapeHtml(manifest.page.title)}</strong>${handoutButton}</header>
  <main class="public-log">
    <h1>${escapeHtml(manifest.page.title)}</h1>
    <section class="page-extras">${overview}${waitingHtml}</section>
    ${streamTabs}<section class="log-timeline">${entries}</section>
  </main>
  <dialog id="handout-dialog"><button type="button" class="dialog-close" aria-label="닫기">×</button><div id="handout-content"></div></dialog>
  <aside class="global-bgm-player" id="bgm-player" hidden><span aria-hidden="true">♪</span><strong id="bgm-title"></strong><button type="button" id="bgm-toggle" aria-label="일시정지">Ⅱ</button><label>음량 <input id="bgm-volume" type="range" min="0" max="100" value="70"></label><button type="button" id="bgm-close" aria-label="닫기">×</button></aside>
  <script type="application/json" id="logcontainer-export">${jsonForScript(manifest)}</script>
  <script src="./assets/viewer.js" defer></script>
</body>
</html>`;
}

export const EXTERNAL_VIEWER_CSS = `
@import url("https://fonts.googleapis.com/earlyaccess/nanummyeongjo.css");
@font-face{font-family:GowoonDodum;src:url("https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2108@1.1/GowunDodum-Regular.woff") format("woff");font-display:swap}
@font-face{font-family:GounBatang;src:url("https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2108@1.1/GowunBatang-Regular.woff") format("woff");font-display:swap}
@font-face{font-family:Ridibatang;src:url("https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_twelve@1.0/RIDIBatang.woff") format("woff");font-display:swap}
@font-face{font-family:NaturalSans;src:url("https://cdn.jsdelivr.net/gh/Project-Noonnu/2607201621@jayeonsans-medium/jayeonsans-medium/JayeonSans-Regular.woff2") format("woff2");font-display:swap}
@font-face{font-family:IbmPlexSans;src:url("https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_20-07@1.0/IBMPlexSansKR-Regular.woff") format("woff");font-display:swap}
:root{color-scheme:light;--canvas:#fff;--line:#e8e8e5;--text:#2f2f2f;--muted:#787774;--hover:#efefed;--log-column-width:680px}
*{box-sizing:border-box}html,body{min-height:100%;margin:0}body{background:var(--canvas);color:var(--text);font:14px Pretendard,Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
[data-font="pretendard"]{--log-font-family:Pretendard,Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}[data-font="gowoon-dodum"]{--log-font-family:GowoonDodum,sans-serif}[data-font="goun-batang"]{--log-font-family:GounBatang,serif}[data-font="ridi-batang"]{--log-font-family:Ridibatang,"Nanum Myeongjo",serif}[data-font="nanum-myeongjo"]{--log-font-family:"Nanum Myeongjo",serif}[data-font="natural-sans"]{--log-font-family:NaturalSans,Pretendard,sans-serif}[data-font="ibm-plex-sans"]{--log-font-family:IbmPlexSans,sans-serif}
button,input{font:inherit}.viewer-toolbar{position:sticky;z-index:30;top:0;display:flex;align-items:center;justify-content:space-between;min-height:48px;padding:0 max(20px,calc((100% - var(--log-column-width))/2));border-bottom:1px solid var(--line);background:rgb(255 255 255/92%);backdrop-filter:blur(10px)}.viewer-toolbar strong{overflow:hidden;color:var(--muted);font-size:13px;text-overflow:ellipsis;white-space:nowrap}.toolbar-button{border:0;border-radius:6px;padding:7px 10px;background:transparent;color:var(--text);cursor:pointer}.toolbar-button:hover{background:var(--hover)}.toolbar-button span{color:var(--muted)}
.public-log{width:min(var(--log-column-width),calc(100% - 40px));margin:0 auto;padding:0 0 120px}.public-log>h1{margin:64px 0 42px;font-family:var(--log-font-family);font-size:clamp(30px,6vw,46px);letter-spacing:-.035em}.page-extras{display:grid;gap:18px;margin:20px 0 34px}.page-overview{padding:16px 18px;border:1px solid var(--line);border-radius:6px;font-family:var(--log-font-family);line-height:1.75;white-space:pre-wrap}.waiting-bgm{display:flex;flex-wrap:wrap;align-items:center;gap:8px;color:var(--muted);font-size:13px}.waiting-bgm>span{display:inline-flex;align-items:center;gap:5px}
.log-entry{position:relative;margin:8px 0;padding:10px 0;border-radius:7px;font-family:var(--log-font-family)}.log-entry-speaker{margin-bottom:5px;font-weight:700}.log-entry-content{line-height:1.72;white-space:pre-wrap}.log-entry .message{line-height:1.7}.log-entry .message .by{display:inline-block;margin-right:7px;font-weight:700}.log-entry .message.desc,.log-entry .message.emote{color:var(--muted);font-style:italic}.log-entry .inlinerollresult{display:inline-block;padding:0 4px;border:1px solid #d3c776;border-radius:3px;background:#fffbd8}.log-entry img{max-width:100%;height:auto}.log-entry table{max-width:100%;border-collapse:collapse}.entry-wrap,.entry-playback-anchor{position:relative;display:flow-root}.log-entry-v2{margin:0;padding:0;overflow:visible;border:0;border-radius:0;background:#fff}
.log-stream-tabs{display:flex;gap:4px;margin:0 0 26px;border-bottom:1px solid var(--line)}.log-stream-tabs button{border:0;border-bottom:2px solid transparent;padding:8px 12px;background:transparent;color:var(--muted);cursor:pointer}.log-stream-tabs button.active{border-bottom-color:#62625f;color:var(--text);font-weight:700}.entry-wrap[hidden]{display:none}
.r20-message{display:block;width:100%;min-height:36px;padding:5px 9px;line-height:1.55;background:#fff}.r20-message--dialogue{display:grid;grid-template-columns:32px minmax(0,1fr);column-gap:9px;align-items:start}.log-timeline>*+*{margin-block-start:12px}.log-timeline>[data-compact-spacing="true"]{margin-block-start:0}.log-timeline>[data-compact-spacing="true"]:has(.r20-message__avatar){margin-block-start:12px}.log-timeline>[data-compact-spacing="true"] .r20-message{min-height:0;padding-top:1px;padding-bottom:1px}.log-timeline>[data-compact-spacing="true"] .r20-message__avatar-slot:empty{height:0}.log-timeline .log-entry,.log-timeline .r20-message{margin-block:0}.r20-message__content-flow>:is(.r20-template,.r20-image-block):first-child{margin-top:0}.r20-message__content-flow>:is(.r20-template,.r20-image-block):last-child{margin-bottom:0}.r20-message--system{color:#7c493b}.r20-message__avatar-slot{width:32px;min-width:32px;height:32px}.r20-message__avatar{display:block;width:32px;height:32px;object-fit:cover}.r20-message__body{min-width:0}.r20-message__content-flow{position:relative;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}.r20-message__content-flow--speaker-template,.r20-message__content-flow--speaker-image{display:flex;align-items:flex-start;gap:6px;white-space:normal}.r20-message__content-flow--speaker-image .r20-image-block{flex:1 1 auto;min-width:0;margin:0}.r20-message__speaker{margin-right:6px;color:#000;font-weight:750}.r20-message--description .r20-message__content-flow{text-align:center}.r20-message--description .r20-text{color:#77736c;font-style:italic}.r20-message__timestamp{display:block;width:fit-content;margin:0 0 1px;color:#777;font:10px/1.25 Pretendard,sans-serif}.r20-inline-roll{display:inline-block;margin:0 2px;padding:0 4px;background:#fff9c7;line-height:1.35}.r20-image-block{display:block;margin:7px 0 3px}.r20-image-block--center{text-align:center}.r20-image-block--right{text-align:right}.r20-message--description .r20-image-block--default{text-align:center}.r20-image{display:inline-block;max-width:min(100%,680px);height:auto;border-radius:3px}.r20-image-block figcaption{margin-top:3px;color:var(--muted);font-size:12px}.log-rich-context{position:relative;box-sizing:border-box;isolation:isolate;color:var(--text);font-style:normal;text-align:inherit}.log-rich-context *,.log-rich-context *::before,.log-rich-context *::after{box-sizing:border-box}.r20-rich-context--inline{display:inline}.r20-rich-context--block{position:static;display:block;margin:0}.r20-rich-context--block>.r20-rich-root--centered{margin-right:auto;margin-left:auto}.r20-rich-image{max-width:100%;height:auto}
.r20-template{display:block;width:min(100%,430px);margin:7px 0;color:#000;font-style:normal}.r20-template--speaker-inline{flex:0 1 430px;min-width:0;margin:0}.r20-template__table{width:100%;border:1px solid #000;border-collapse:collapse;background:#fff;color:#000}.r20-template__table caption{padding:2px;border:1px solid #000;background:#000;color:#fff;font-weight:700;text-align:center}.r20-template__field td{padding:2px 4px;border-bottom:1px solid #000}.r20-template__field:last-child td{border-bottom:0}.r20-template__label{width:34%;font-weight:700}.r20-template__value{text-align:center}.r20-template__field--result .r20-template__value{background:#bebebe;font-weight:700}.r20-template__value--critical,.r20-template__value--extreme{background:lightgreen!important}.r20-template__value--hard{background:green!important;color:#fff}.r20-template__value--success{background:darkgreen!important;color:#fff}.r20-template__value--failure,.r20-template__value--fumble{background:crimson!important;color:#fff}.r20-template .r20-inline-roll{min-width:1.5em;border:2px solid #000;background:#bebebe;text-align:center}
.bgm-play-button{display:grid;width:25px;height:25px;padding:0;place-items:center;border:0;border-radius:5px;background:#efefed;color:#787774;cursor:pointer}.entry-bgm-button{position:absolute;z-index:2;top:50%;left:-34px;transform:translateY(-50%)}.global-bgm-player{position:fixed;z-index:80;right:16px;bottom:16px;display:flex;align-items:center;gap:9px;max-width:min(520px,calc(100vw - 32px));padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:#fff;box-shadow:0 8px 26px rgb(0 0 0/16%)}.global-bgm-player[hidden]{display:none}.global-bgm-player strong{overflow:hidden;flex:1;text-overflow:ellipsis;white-space:nowrap}.global-bgm-player button{border:0;background:transparent;cursor:pointer}.global-bgm-player label{display:flex;align-items:center;gap:5px;color:var(--muted);font-size:11px}
dialog{width:min(620px,calc(100% - 28px));max-height:calc(100dvh - 40px);overflow:auto;border:0;border-radius:10px;padding:22px;background:#fff;box-shadow:0 18px 60px rgb(0 0 0/22%)}dialog::backdrop{background:rgb(0 0 0/34%)}.dialog-close{position:absolute;top:10px;right:10px;border:0;background:transparent;font-size:22px;cursor:pointer}.handout-list{display:grid;gap:5px;margin:12px 0}.handout-list button{padding:9px;border:0;border-radius:6px;background:transparent;text-align:left;cursor:pointer}.handout-list button:hover{background:var(--hover)}.handout-body{font-family:var(--log-font-family);line-height:1.85;white-space:pre-wrap}.handout-images{display:grid;gap:10px;margin-top:20px}.handout-images img{display:block;max-width:100%;max-height:72vh;margin:auto}
@media(max-width:760px){.public-log{width:min(100% - 24px,var(--log-column-width))}.entry-bgm-button{position:static;float:right;margin:5px 2px 4px 8px;transform:none}.global-bgm-player{right:8px;bottom:8px;left:8px}.global-bgm-player label{display:none}.r20-message{padding-right:3px;padding-left:3px}}
`;

export const EXTERNAL_VIEWER_JS = `
(() => {
  const manifestNode = document.getElementById("logcontainer-export");
  if (!manifestNode) return;
  const manifest = JSON.parse(manifestNode.textContent || "{}");
  const tracks = new Map((manifest.tracks || []).map((track) => [track.key, track]));
  const placements = new Map((manifest.bgm || []).map((item) => [item.key, item]));
  const player = document.getElementById("bgm-player");
  const title = document.getElementById("bgm-title");
  const toggle = document.getElementById("bgm-toggle");
  const volume = document.getElementById("bgm-volume");
  let currentKey = null;
  let media = null;
  function stop() {
    if (media instanceof HTMLAudioElement) { media.pause(); media.remove(); }
    if (media instanceof HTMLIFrameElement) media.remove();
    media = null; currentKey = null; player.hidden = true;
    document.querySelectorAll("[data-bgm-placement]").forEach((button) => { button.textContent = "▶"; });
  }
  function play(placementKey) {
    const placement = placements.get(placementKey); const track = placement && tracks.get(placement.trackKey);
    if (!track) return;
    if (currentKey === placementKey) {
      if (media instanceof HTMLAudioElement && media.paused) { media.play(); toggle.textContent = "Ⅱ"; return; }
      stop(); return;
    }
    stop(); currentKey = placementKey; title.textContent = placement.title; player.hidden = false;
    if (track.source.type === "upload") {
      const audio = new Audio("./" + track.source.file); audio.volume = Number(volume.value) / 100; audio.addEventListener("ended", stop); media = audio; audio.play().catch(stop);
    } else {
      const iframe = document.createElement("iframe"); iframe.hidden = true; iframe.allow = "autoplay"; iframe.src = "https://www.youtube.com/embed/" + encodeURIComponent(track.source.videoId) + "?autoplay=1&playsinline=1"; document.body.appendChild(iframe); media = iframe;
    }
    document.querySelectorAll("[data-bgm-placement]").forEach((button) => { button.textContent = button.dataset.bgmPlacement === placementKey ? "Ⅱ" : "▶"; });
  }
  document.addEventListener("click", (event) => { const button = event.target.closest("[data-bgm-placement]"); if (button) play(button.dataset.bgmPlacement); });
  document.getElementById("bgm-close")?.addEventListener("click", stop);
  toggle?.addEventListener("click", () => { if (currentKey) play(currentKey); });
  volume?.addEventListener("input", () => { if (media instanceof HTMLAudioElement) media.volume = Number(volume.value) / 100; });
  document.querySelectorAll("[data-stream-tab]").forEach((tab) => tab.addEventListener("click", () => {
    const stream = tab.dataset.streamTab; document.querySelectorAll("[data-stream-tab]").forEach((item) => item.classList.toggle("active", item === tab));
    document.querySelectorAll("[data-stream]").forEach((entry) => { entry.hidden = entry.dataset.stream !== stream; });
  }));
  document.querySelectorAll('[data-stream="casual"]').forEach((entry) => { entry.hidden = true; });

  const dialog = document.getElementById("handout-dialog"); const content = document.getElementById("handout-content");
  function showHandoutList() {
    content.replaceChildren(); const heading = document.createElement("h2"); heading.textContent = "핸드아웃"; content.appendChild(heading);
    const list = document.createElement("div"); list.className = "handout-list";
    for (const handout of manifest.handouts || []) { const button = document.createElement("button"); button.textContent = handout.title; button.addEventListener("click", () => showHandout(handout)); list.appendChild(button); }
    content.appendChild(list);
  }
  function showHandout(handout) {
    content.replaceChildren(); const back = document.createElement("button"); back.className = "toolbar-button"; back.textContent = "← 목록"; back.addEventListener("click", showHandoutList); content.appendChild(back);
    const heading = document.createElement("h2"); heading.textContent = handout.title; content.appendChild(heading);
    const body = document.createElement("p"); body.className = "handout-body"; body.textContent = handout.content; content.appendChild(body);
    const images = document.createElement("div"); images.className = "handout-images"; for (const image of handout.images || []) { const node = document.createElement("img"); node.src = "./" + image.file; node.alt = image.originalName || ""; images.appendChild(node); } content.appendChild(images);
  }
  document.getElementById("handout-open")?.addEventListener("click", () => { showHandoutList(); dialog.showModal(); });
  dialog?.querySelector(".dialog-close")?.addEventListener("click", () => dialog.close());
  dialog?.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
})();
`;
