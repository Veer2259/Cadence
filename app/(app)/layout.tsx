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
    <div className="flex min-h-full flex-col">
      <AppNav />
      {/* isolate: keep page-level z-indexes (e.g. the ribbon's) from ever
          painting over the sticky header, which sits above at the root level */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 isolate">
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
