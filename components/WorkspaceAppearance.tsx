"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { fontFamilyStack } from "@/lib/fonts";
import type { LogFontFamily } from "@/lib/types";

const AppearanceContext = createContext<{
  systemFont: LogFontFamily; setSystemFont: (font: LogFontFamily) => void;
} | null>(null);

export function WorkspaceAppearance({ initialSystemFont, children }: {
  initialSystemFont: LogFontFamily; children: ReactNode;
}) {
  const [systemFont, setSystemFont] = useState(initialSystemFont);
  useEffect(() => setSystemFont(initialSystemFont), [initialSystemFont]);
  useEffect(() => {
    // Portals live under body, outside workspace-shell. Keep their UI font in sync.
    const shell = document.querySelector<HTMLElement>(".workspace-shell");
    const oldBodyFont = document.body.style.getPropertyValue("--system-font-family");
    const oldShellFont = shell?.style.getPropertyValue("--system-font-family") ?? "";
    const stack = fontFamilyStack(systemFont);
    document.body.style.setProperty("--system-font-family", stack);
    shell?.style.setProperty("--system-font-family", stack);
    return () => {
      if (oldBodyFont) document.body.style.setProperty("--system-font-family", oldBodyFont);
      else document.body.style.removeProperty("--system-font-family");
      if (oldShellFont) shell?.style.setProperty("--system-font-family", oldShellFont);
      else shell?.style.removeProperty("--system-font-family");
    };
  }, [systemFont]);
  return <AppearanceContext.Provider value={{ systemFont, setSystemFont }}>{children}</AppearanceContext.Provider>;
}

export function useWorkspaceAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("WorkspaceAppearance is required");
  return value;
}
