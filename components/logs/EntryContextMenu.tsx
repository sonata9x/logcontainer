"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

type Props = {
  x: number;
  y: number;
  canEditCss: boolean;
  canEditImage: boolean;
  canRestoreOriginal: boolean;
  onEditImage: () => void;
  onAdd: () => void;
  onAddImage: () => void;
  onEditCss: () => void;
  onHistory: () => void;
  onEditBgm?: () => void;
  onRestoreOriginal: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export function EntryContextMenu({ x, y, canEditCss, canEditImage, canRestoreOriginal, onEditImage, onAdd, onAddImage, onEditCss, onHistory, onEditBgm, onRestoreOriginal, onDelete, onClose }: Props) {
  useEffect(() => {
    const close = () => onClose();
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", keydown);
    };
  }, [onClose]);

  const run = (action: () => void) => { onClose(); action(); };
  const left = typeof window === "undefined" ? x : Math.min(x, window.innerWidth - 190);
  const top = typeof window === "undefined" ? y : Math.min(y, window.innerHeight - 250);
  const menu = <div className="entry-context-menu" role="menu" style={{ left, top }} onPointerDown={(event) => event.stopPropagation()}>
    {canEditImage && <button type="button" role="menuitem" onClick={() => run(onEditImage)}>이미지 수정</button>}
    <button type="button" role="menuitem" onClick={() => run(onAdd)}>아래에 로그 블록 추가</button>
    <button type="button" role="menuitem" onClick={() => run(onAddImage)}>아래에 이미지 블록 추가</button>
    {canEditCss && <button type="button" role="menuitem" onClick={() => run(onEditCss)}>CSS 수정</button>}
    {onEditBgm && <button type="button" role="menuitem" onClick={() => run(onEditBgm)}>BGM 설정</button>}
    <button type="button" role="menuitem" onClick={() => run(onHistory)}>수정 이력</button>
    {canRestoreOriginal && <button type="button" role="menuitem" onClick={() => run(onRestoreOriginal)}>원본 상태로 복원</button>}
    <hr />
    <button type="button" role="menuitem" className="danger" onClick={() => run(onDelete)}>삭제</button>
  </div>;
  return typeof document === "undefined" ? null : createPortal(menu, document.body);
}
