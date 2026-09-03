import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { buckets as bucketsTable } from "@/db/schema";
import { istToday } from "@/lib/time";
import { weekStartOf, weeklyTargetsFor } from "@/lib/goals";
import { loadTranscript } from "@/lib/ai/modes/breakdown";
import { BreakdownPanel } from "@/components/goals/breakdown-panel";
import { KickoffPanel } from "@/components/goals/kickoff-panel";


/**
 * Server Actions inherit maxDuration from the PAGE segment they are invoked
 * from, not from the file they live in (Next.js route-segment config). Covers breakdown and the weekly kickoff.
 * 
 * 300s is the Fluid compute ceiling on Vercel's Hobby plan. It is a ceiling,
 * not a reservation — a fast call still costs only what it uses.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-line pt-5">
      <h2 className="text-sm font-medium tracking-wide text-ink uppercase">{title}</h2>
      {description ? (
        <p className="mt-1 mb-3 text-xs text-ink-muted">{description}</p>
      ) : (
        <div className="mb-3" />
      )}
      {children}
    </section>
  );
}

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const wanted = typeof sp.bucket === "string" ? sp.bucket : undefined;

  const allBuckets = await db
    .select({ id: bucketsTable.id, name: bucketsTable.name })
    .from(bucketsTable)
    .where(eq(bucketsTable.active, true))
    .orderBy(asc(bucketsTable.name));

  const bucketId = wanted ?? allBuckets[0]?.id ?? null;
  const transcript = bucketId
    ? await loadTranscript(bucketId)
    : { messages: [], proposal: null };

  const thisWeek = weekStartOf(istToday());
  const targets = await weeklyTargetsFor(thisWeek);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[30px] leading-none font-extrabold tracking-[-0.03em] text-ink">Goals</h1>
        <p className="mt-1 text-sm text-ink-muted">
          What each bucket is for, and this week&rsquo;s slice of it. Both modes
          below propose into a list you confirm or edit — neither writes anything
          on its own.
        </p>
      </div>

      {allBuckets.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No active buckets yet. Create one in Settings first.
        </p>
      ) : (
        <>
          <Section
            title="Breakdown"
            description="A conversation, not a form. It interviews you on scope, what is already done, dependencies and who else is involved — then argues with the numbers from your own history if the plan does not fit the hours you actually log."
          >
            <BreakdownPanel
              buckets={allBuckets}
              initialBucketId={bucketId}
              initialMessages={transcript.messages}
              initialProposal={transcript.proposal}
            />
          </Section>

          <Section
            title="Weekly kickoff"
            description="Given this week's targets, propose the tasks that would deliver them, sized with your calibration ratios."
          >
            <KickoffPanel
              weekStart={thisWeek}
              targets={targets.map((t) => ({
                id: t.id,
                label: `${t.bucketName}: ${t.description}`,
              }))}
            />
          </Section>
        </>
      )}
    </div>
  );
}
