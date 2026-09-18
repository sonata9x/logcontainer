"use client";

import { useEffect, useRef } from "react";

const closeStack: symbol[] = [];

export function useEscapeClose(onClose: () => void, disabled = false) {
  const callback = useRef(onClose);
  useEffect(() => { callback.current = onClose; }, [onClose]);
  useEffect(() => {
    if (disabled) return;
    const token = Symbol("escape-close");
    closeStack.push(token);
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && closeStack.at(-1) === token) {
        event.preventDefault(); event.stopImmediatePropagation(); callback.current();
      }
    };
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("keydown", close); const index = closeStack.indexOf(token); if (index >= 0) closeStack.splice(index, 1); };
  }, [disabled]);
}
