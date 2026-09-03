"use client";

/**
 * Everything pinned to the bottom of every screen: the assistant handle, the
 * tab bar, and the two sheets they open.
 *
 * Sheet state lives here because two different pieces of chrome open sheets —
 * the tab bar's + and the assistant handle — and only one sheet may be up at a
 * time. Pushing that state down into either component would mean neither could
 * close the other.
 */

import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { AppNav, AssistantHandle } from "@/components/app-nav";
import { ChatPanel } from "@/components/chat/chat-rail";
import { BrainDump } from "@/components/inbox/brain-dump";
import type { ChatMsg } from "@/app/(app)/chat/actions";

type OpenSheet = null | "capture" | "chat";

export function BottomChrome({
  history,
  buckets,
}: {
  history: ChatMsg[];
  buckets: { id: string; name: string }[];
}) {
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const close = () => setSheet(null);

  return (
    <>
      <div className="sticky bottom-0 z-40 shrink-0 bg-paper">
        <AssistantHandle onOpen={() => setSheet("chat")} unread={0} />
        <AppNav onCapture={() => setSheet("capture")} />
      </div>

      <Sheet
        open={sheet === "capture"}
        onClose={close}
        title="Capture"
        maxHeight="82%"
      >
        <div className="px-5 pt-1 pb-8">
          <p className="mb-3 text-[13.5px] font-medium text-ink-muted">
            Type everything on your mind. Cadence splits it into tasks; nothing is
            saved until you confirm.
          </p>
          <BrainDump buckets={buckets} />
        </div>
      </Sheet>

      <Sheet
        open={sheet === "chat"}
        onClose={close}
        title="Ask Cadence"
        maxHeight="86%"
      >
        <ChatPanel initial={history} />
      </Sheet>
    </>
  );
}
