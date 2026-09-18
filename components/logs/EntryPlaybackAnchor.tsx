import type { ReactNode } from "react";
import { BgmPlayButton } from "@/components/BgmPlayer";
import type { PageBgmItem } from "@/lib/types";

// Anchor to the message alone, excluding editor actions and insertion forms.
export function EntryPlaybackAnchor({ item, children }: { item: PageBgmItem | null | undefined; children: ReactNode }) {
  return <div className="entry-playback-anchor">
    {item && <BgmPlayButton item={item} className="entry-bgm-button" />}
    {children}
  </div>;
}
