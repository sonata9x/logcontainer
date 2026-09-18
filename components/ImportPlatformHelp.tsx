"use client";

import { CircleHelp } from "lucide-react";
import { useId, useState } from "react";

export const IMPORT_GUIDES = [
  {
    id: "roll20", title: "Roll20",
    steps: [
      "Roll20에서 해당 게임의 ‘채팅 로그 전체 보기’를 엽니다.",
      "로그가 여러 페이지라면 ‘Show on One Page’를 선택하고, 로그가 모두 표시될 때까지 기다립니다.",
      "F12를 눌러 개발자 도구를 열고 ‘Elements(요소)’ 탭을 선택합니다.",
      "Elements 안에서 Ctrl+F를 누르고 textchatcontainer를 검색합니다. 채팅 전체를 감싸는 <div class=\"textchatcontainer\"> 요소를 선택하세요.",
      "해당 요소를 우클릭한 뒤 ‘Copy → Copy element’를 선택합니다. 브라우저에 따라 ‘Copy outerHTML’로 표시될 수 있습니다.",
      "이 화면의 ‘로그 HTML’ 칸에 붙여넣고, 플랫폼을 Roll20으로 선택한 뒤 ‘가져오기’를 누릅니다."
    ],
    note: "메시지 한 줄이 아니라 전체 채팅 컨테이너를 복사하세요. 붙여넣기는 4MB 이하만 지원합니다. 더 큰 로그는 전체 로그 페이지를 HTML 파일로 저장해 업로드하세요. 개발자 도구 작업은 PC에서 진행합니다."
  },
  { id: "ccfolia", title: "코코포리아", steps: [], note: "아직 가져오기를 지원하지 않습니다. 구현 후 안내를 추가할 예정입니다." },
  { id: "takoyaki-box", title: "타코야키 박스", steps: ["타코야키 박스에서 해당 세션의 로그를 HTML 형식으로 내보냅니다.", "이 화면에서 플랫폼을 ‘Takoyaki Box’로 선택합니다.", "‘백업 HTML 파일’에서 내보낸 .html 파일을 선택한 뒤 ‘가져오기’를 누릅니다."], note: "HTML 파일은 최대 12MB까지 업로드할 수 있습니다. 이미지나 PDF가 아닌 HTML 파일을 선택해주세요." }
] as const;

export function ImportPlatformHelp() {
  const prefix = useId();
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const open = hovered ?? focused ?? pinned;
  return <div className="import-platform-help" aria-label="플랫폼별 로그 가져오기 도움말" onKeyDown={(event) => { if (event.key === "Escape") { setPinned(null); setHovered(null); setFocused(null); event.stopPropagation(); } }}>
    <span className="import-help-caption">가져오는 방법</span>{IMPORT_GUIDES.map((guide) => <div className="import-help-item" key={guide.id} onPointerEnter={(event) => { if (event.pointerType === "mouse") setHovered(guide.id); }} onPointerLeave={() => setHovered(null)}>
      <button type="button" className="import-help-trigger" aria-expanded={open === guide.id} aria-describedby={open === guide.id ? `${prefix}-${guide.id}` : undefined} onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) setFocused(guide.id); }} onBlur={() => setFocused(null)} onClick={() => setPinned((current) => current === guide.id ? null : guide.id)}><span>{guide.title}</span><CircleHelp size={14} /></button>
      {open === guide.id && <div id={`${prefix}-${guide.id}`} className="import-help-panel" role="tooltip"><strong>{guide.title} 로그 가져오기</strong>{guide.steps.length > 0 && <ol>{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol>}<p>{guide.note}</p></div>}
    </div>)}
  </div>;
}
