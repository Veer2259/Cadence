import { asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { buckets as bucketsTable, habits as habitsTable } from "@/db/schema";
import { getOrCreateDayProfile } from "@/lib/day-profile";
import { narrowCadence } from "@/lib/habits";
import { DayProfileForm } from "@/components/settings/day-profile-form";
import { BucketsPanel } from "@/components/settings/buckets-panel";
import { HabitsPanel } from "@/components/settings/habits-panel";
import { SharpHoursSuggestion } from "@/components/settings/sharp-hours-suggestion";
import { loadEnergySamples } from "@/lib/energy-db";
import { suggestSharpWindows } from "@/lib/energy";
import { WEEKDAY_KEYS } from "@/lib/time";

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
    <section className="border-t border-rule pt-5">
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

export default async function SettingsPage() {
  const profile = await getOrCreateDayProfile();

  // The energy log's view of when you are actually sharp, for the panel below
  // the day-profile editor. A suggestion only — applying it is a button press.
  const sharpSuggestion = suggestSharpWindows(await loadEnergySamples(30));
  const aWorkingDay =
    WEEKDAY_KEYS.find((d) => (profile.workWindows[d] ?? []).length > 0) ?? "mon";
  const currentSharp = (profile.sharpHours[aWorkingDay] ?? []) as [string, string][];

  const allBuckets = await db
    .select()
    .from(bucketsTable)
    .orderBy(desc(bucketsTable.active), asc(bucketsTable.name));

  const allHabits = await db
    .select()
    .from(habitsTable)
    .orderBy(asc(habitsTable.name));

  const bucketOpts = allBuckets
    .filter((b) => b.active)
    .map((b) => ({ id: b.id, name: b.name }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-mono text-lg tracking-tight text-ink">Settings</h1>
        <p className="judgment mt-1 text-sm text-ink-muted">
          How your days are shaped, and the buckets your work falls into.
        </p>
      </div>

      <Section
        title="Day profile"
        description="The working window, the hours you think clearly, and the limits the planner must respect."
      >
        <DayProfileForm
          initial={{
            workWindows: profile.workWindows,
            sharpHours: profile.sharpHours,
            dailyCapMin: profile.dailyCapMin,
            minBlockMin: profile.minBlockMin,
            maxBlockMin: profile.maxBlockMin,
            breakMin: profile.breakMin,
            protectedBlocks: profile.protectedBlocks,
          }}
        />
        <SharpHoursSuggestion suggestion={sharpSuggestion} current={currentSharp} />
      </Section>

      <Section title="Buckets" description="Projects and life areas. Retiring one keeps its history.">
        <BucketsPanel
          buckets={allBuckets.map((b) => ({
            id: b.id,
            name: b.name,
            color: b.color,
            priorityHint: b.priorityHint,
            active: b.active,
          }))}
        />
      </Section>

      <Section title="Habits" description="Recurring things you want placed but that aren't tasks.">
        <HabitsPanel
          habits={allHabits.map((h) => ({
            id: h.id,
            name: h.name,
            cadence: narrowCadence(h.cadence),
            durationMin: h.durationMin,
            preferredWindow: h.preferredWindow,
            bucketId: h.bucketId,
            active: h.active,
          }))}
          buckets={bucketOpts}
        />
      </Section>

      <Section title="Google Calendar & capture token">
        <p className="text-sm text-ink-muted">
          Calendar sync and the iOS-shortcut capture token arrive in Phase 6.
        </p>
      </Section>
    </div>
  );
}
