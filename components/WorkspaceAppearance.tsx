"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { fontFamilyStack } from "@/lib/fonts";
import { normalizeHexColor } from "@/lib/color";
import type { LogFontFamily } from "@/lib/types";

const AppearanceContext = createContext<{
  systemFont: LogFontFamily; setSystemFont: (font: LogFontFamily) => void;
  accentColor: string; setAccentColor: (color: string) => void;
} | null>(null);

export function WorkspaceAppearance({ initialSystemFont, initialAccentColor, children }: {
  initialSystemFont: LogFontFamily; initialAccentColor: string; children: ReactNode;
}) {
  const [systemFont, setSystemFont] = useState(initialSystemFont);
  const [accentColor, setAccentColor] = useState(initialAccentColor);
  useEffect(() => setSystemFont(initialSystemFont), [initialSystemFont]);
  useEffect(() => setAccentColor(initialAccentColor), [initialAccentColor]);
  useEffect(() => {
    const color = normalizeHexColor(accentColor) ?? "#4F6BED";
    const shell = document.querySelector<HTMLElement>(".workspace-shell");
    const oldBodyAccent = document.body.style.getPropertyValue("--accent");
    const oldShellAccent = shell?.style.getPropertyValue("--accent") ?? "";
    document.body.style.setProperty("--accent", color);
    shell?.style.setProperty("--accent", color);
    return () => {
      if (oldBodyAccent) document.body.style.setProperty("--accent", oldBodyAccent);
      else document.body.style.removeProperty("--accent");
      if (oldShellAccent) shell?.style.setProperty("--accent", oldShellAccent);
      else shell?.style.removeProperty("--accent");
    };
  }, [accentColor]);
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
  return <AppearanceContext.Provider value={{ systemFont, setSystemFont, accentColor, setAccentColor }}>{children}</AppearanceContext.Provider>;
}

export function useWorkspaceAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("WorkspaceAppearance is required");
  return value;
}
