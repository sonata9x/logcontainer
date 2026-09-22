"use client";

import { sanitizeLogHtml } from "@/lib/logs/html";
import type { LogEntry, SpeakerAvatarBundle } from "@/lib/types";
import { isStoredLogEntryDocumentV2 } from "@/lib/logs/model/validate";
import { Roll20V2Renderer } from "@/components/logs/Roll20V2Renderer";
import { createContext, useContext, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { resolveEntryAvatar } from "@/lib/speaker-avatars";

const SpeakerAvatarRenderContext = createContext<{ avatars: SpeakerAvatarBundle | null; onAvatarContextMenu?: (entry: LogEntry, event: ReactMouseEvent<HTMLImageElement>) => void }>({ avatars: null });

export function SpeakerAvatarProvider({ avatars, onAvatarContextMenu, children }: { avatars: SpeakerAvatarBundle | null; onAvatarContextMenu?: (entry: LogEntry, event: ReactMouseEvent<HTMLImageElement>) => void; children: ReactNode }) {
  return <SpeakerAvatarRenderContext.Provider value={{ avatars, onAvatarContextMenu }}>{children}</SpeakerAvatarRenderContext.Provider>;
}

export function LogEntryBlock({ entry, avatar, onAvatarContextMenu }: { entry: LogEntry; avatar?: { candidates: string[]; managed: boolean }; onAvatarContextMenu?: (event: ReactMouseEvent<HTMLImageElement>) => void }) {
  const avatarContext = useContext(SpeakerAvatarRenderContext);
  const inheritedAvatar = resolveEntryAvatar(entry, avatarContext.avatars);
  const effectiveAvatar = avatar ?? inheritedAvatar;
  if (entry.document_version === 2 && isStoredLogEntryDocumentV2(entry.document)) {
    return <div className="log-entry log-entry-v2"><Roll20V2Renderer document={entry.document} avatarCandidates={effectiveAvatar.candidates} managedAvatar={effectiveAvatar.managed} onAvatarContextMenu={onAvatarContextMenu ?? (avatarContext.onAvatarContextMenu ? (event) => avatarContext.onAvatarContextMenu!(entry, event) : undefined)} /></div>;
  }
  if (entry.raw_html) {
    return <div className="log-entry" dangerouslySetInnerHTML={{ __html: sanitizeLogHtml(entry.raw_html) }} />;
  }
  return (
    <article className={`log-entry entry-${entry.entry_type}`}>
      {entry.speaker_name && <div className="log-entry-speaker" style={{ color: entry.speaker_color ?? undefined }}>{entry.speaker_name}</div>}
      <div className="log-entry-content">{entry.content}</div>
    </article>
  );
}
