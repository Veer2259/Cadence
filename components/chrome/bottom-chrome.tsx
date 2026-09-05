"use client";

/**
 * Everything pinned to the bottom of every screen: the assistant handle, the
 * tab bar, and the one sheet they open.
 *
 * There used to be two sheets — a capture sheet on the tab bar's + and a chat
 * sheet on the handle — which meant deciding, before typing, which kind of
 * thing you were about to say. They are now ONE conversation: the + opens the
 * assistant already in brain-dump mode, the handle opens it normally, and the
 * assistant works out which it is either way.
 */

import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { AppNav, AssistantHandle } from "@/components/app-nav";
import { ChatPanel } from "@/components/chat/chat-rail";
import type { ChatMsg } from "@/app/(app)/chat/actions";

export function BottomChrome({
  history,
  buckets,
}: {
  history: ChatMsg[];
  /** kept for the capture prompt's bucket hints */
  buckets: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  /** true when the sheet was opened by the + — start in brain-dump mode. */
  const [dumpMode, setDumpMode] = useState(false);

  function openChat(dump: boolean) {
    setDumpMode(dump);
    setOpen(true);
  }

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-3xl bg-paper">
        <AssistantHandle onOpen={() => openChat(false)} unread={0} />
        <AppNav onCapture={() => openChat(true)} />
      </div>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Ask Cadence"
        maxHeight="86%"
      >
        <ChatPanel
          initial={history}
          startInDumpMode={dumpMode}
          bucketNames={buckets.map((b) => b.name)}
        />
      </Sheet>
    </>
  );
}
