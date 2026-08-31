import { requireAuth } from "@/lib/auth";
import { AppNav } from "@/components/app-nav";
import { ChatRail } from "@/components/chat/chat-rail";
import { loadChatHistory } from "@/lib/ai/modes/chat";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuth();
  const history = await loadChatHistory();

  return (
    // pt-12 clears the fixed header (h-12 in AppNav).
    <div className="flex min-h-full flex-col pt-12">
      <AppNav />
      {/* isolate: page-level z-indexes (the ribbon's) stay in their own stacking
          context, well below the fixed header's z-50 */}
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
