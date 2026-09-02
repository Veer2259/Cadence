import { requireAuth } from "@/lib/auth";
import { AppNav } from "@/components/app-nav";
import { ChatRail } from "@/components/chat/chat-rail";
import { loadChatHistory } from "@/lib/ai/modes/chat";


/**
 * Server Actions inherit maxDuration from the PAGE segment they are invoked
 * from, not from the file they live in (Next.js route-segment config). The chat rail lives in THIS layout, so a compose or
 * rebalance confirmed from the assistant can fire on any page in the group —
 * the ceiling has to be here, not only on /today.
 * 
 * 300s is the Fluid compute ceiling on Vercel's Hobby plan. It is a ceiling,
 * not a reservation — a fast call still costs only what it uses.
 */
export const maxDuration = 300;
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuth();
  const history = await loadChatHistory();

  return (
    <div className="flex min-h-full flex-col">
      <AppNav />
      {/* isolate: page-level z-indexes (the ribbon's) stay contained in their
          own stacking context, below the header's z-40 */}
      <main className="isolate mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        {children}
      </main>
      <ChatRail
        initial={history
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
            createdAt: m.createdAt.toISOString(),
            pending:
              (m.toolCalls as { pending?: { kind: "compose" | "rebalance"; params: Record<string, unknown> } } | null)
                ?.pending ?? null,
          }))}
      />
    </div>
  );
}
