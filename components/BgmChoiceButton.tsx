"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BgmDetailsDialog } from "@/components/BgmDetailsDialog";
import { useEscapeClose } from "@/lib/use-escape-close";

type Props = {
  title: string;
  disabled: boolean;
  selected?: boolean;
  onChoose: (customTitle?: string) => Promise<void>;
};

export function BgmChoiceButton({ title, disabled, selected, onChoose }: Props) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  function closeMenu() { setMenu(null); trigger.current?.focus(); }
  useEscapeClose(closeMenu, !menu);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  return <>
    <button ref={trigger} className="button" type="button" disabled={disabled} aria-pressed={selected}
      title="클릭: 바로 연결 · 우클릭: 이름 바꿔서 연결" aria-haspopup="menu" aria-expanded={Boolean(menu)}
      onClick={() => { setMenu(null); void onChoose(); }}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); if (!disabled) setMenu({ x: event.clientX, y: event.clientY }); }}
      onKeyDown={(event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu({ x: rect.left, y: rect.bottom });
        }
      }}>{title}</button>
    {menu && typeof document !== "undefined" && createPortal(<div className="entry-context-menu" role="menu" aria-label={`${title} 연결 옵션`}
      style={{ zIndex: 110, left: Math.max(8, Math.min(menu.x, window.innerWidth - 198)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 60)) }}
      onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()} onKeyDown={(event) => { if (event.key === "Tab") closeMenu(); }}>
      <button type="button" role="menuitem" autoFocus onClick={() => { setMenu(null); setRenaming(true); }}>이름 바꿔서 연결</button>
    </div>, document.body)}
    {renaming && <BgmDetailsDialog heading="이름 바꿔서 BGM 연결" initialTitle={title}
      description="이 위치에서 표시할 이름을 입력하세요. 기존 음원과 보관함 이름은 그대로 유지됩니다."
      onSave={({ title: customTitle }) => onChoose(customTitle)} onClose={() => { setRenaming(false); trigger.current?.focus(); }} />}
  </>;
}
