"use client";

import { useEffect } from "react";

export function useEscapeClose(onClose: () => void, disabled = false) {
  useEffect(() => {
    if (disabled) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [disabled, onClose]);
}
