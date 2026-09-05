import { eq } from "drizzle-orm";
import { db } from "@/db";
import { buckets as bucketsTable } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { BottomChrome } from "@/components/chrome/bottom-chrome";
import { loadChatHistory } from "@/lib/ai/modes/chat";


/**
 * Server Actions inherit maxDuration from the PAGE segment they are invoked
 * from, not from the file they live in (Next.js route-segment config). The chat rail lives in THIS layout, so a compose or
 * rebalance confirmed from the assistant can fire on any page in the group —
 * the ceiling has to be here, not only on /today. The capture sheet is mounted
 * here too, for the same reason.
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
  const [history, buckets] = await Promise.all([
    loadChatHistory(),
    db
      .select({ id: bucketsTable.id, name: bucketsTable.name })
      .from(bucketsTable)
      .where(eq(bucketsTable.active, true))
      .orderBy(bucketsTable.name),
  ]);

  return (
    <div className="flex min-h-full flex-col">
      {/* isolate: page-level z-indexes (the ribbon's) stay contained in their
          own stacking context, below the chrome */}
      {/* pb clears the fixed bottom chrome: 34px handle + 56px tab track +
          26px home-indicator gap, plus a little air. */}
      <main
        className="isolate mx-auto w-full max-w-3xl flex-1 px-5"
        style={{
          paddingTop: "46px",
          paddingBottom: "calc(132px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        {children}
      </main>
      <BottomChrome
        buckets={buckets}
        history={history
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
            createdAt: m.createdAt.toISOString(),
            pending:
              (m.toolCalls as { pending?: { kind: "compose" | "drop_block"; params: Record<string, unknown> } } | null)
                ?.pending ?? null,
          }))}
      />
    </div>
  );
}
