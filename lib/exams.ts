/**
 * lib/exams.ts — an exam is a goal.
 *
 * The whole point of the exam module is that an exam is not a diary entry, it
 * is a DEADLINE WITH WORK BEHIND IT — which is exactly what the goal layer
 * already models. So this does not re-implement goals: each exam gets a bucket,
 * and the bucket carries the exam as its `outcome` + `outcome_target_date`.
 *
 * Everything downstream then works unchanged:
 *  - goalHorizon() sees a date days or weeks away, so it takes the DIRECT path
 *    and proposes tasks against the goal rather than inventing weekly targets
 *    for a two-week block (lib/goal-horizon.ts).
 *  - capacityEvidence() argues from hours actually logged in that subject.
 *  - goal pressure feeds compose, so an exam that is behind pace shows up in
 *    the day's plan as evidence, never as a hard rule.
 *
 * A bucket carries ONE outcome, so it tracks the NEXT unsat exam for its
 * subject. The `exams` table keeps them all.
 */

import "server-only";
import { and, asc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { buckets, exams } from "@/db/schema";
import { istToday } from "@/lib/time";

export type ExamKind = "mid_block" | "end_block" | "other";

const KIND_LABEL: Record<ExamKind, string> = {
  mid_block: "mid-block exam",
  end_block: "end-block exam",
  other: "exam",
};

/**
 * The bucket name for a subject.
 *
 * Deliberately the bare subject code, lowercased: buckets are the person's own
 * vocabulary (SPEC §1 principle 7) and "pwmc" is what the timetable calls it.
 * Prefixing with "exam-" would create a second bucket for work that belongs
 * with the rest of the subject's hours, and split its capacity evidence in two.
 */
export function bucketNameForSubject(subjectCode: string): string {
  return subjectCode.trim().toLowerCase();
}

/** One line describing what "done" means, for the bucket's outcome. */
export function outcomeForExam(args: {
  subjectCode: string;
  subjectName: string | null;
  kind: ExamKind;
  date: string;
}): string {
  const subject = args.subjectName?.trim() || args.subjectCode;
  return `Ready for the ${subject} ${KIND_LABEL[args.kind]} on ${args.date}`;
}

/**
 * Find or create the bucket for a subject.
 *
 * Never clobbers an existing bucket's colour or history — a subject the person
 * already tracks keeps everything it has.
 */
export async function bucketForSubject(subjectCode: string): Promise<string> {
  const name = bucketNameForSubject(subjectCode);
  const found = await db.query.buckets.findFirst({ where: eq(buckets.name, name) });
  if (found) return found.id;

  const [row] = await db
    .insert(buckets)
    .values({ name, color: "#7A8CA3", active: true })
    .returning({ id: buckets.id });
  return row.id;
}

/**
 * Point a subject's bucket at its next upcoming exam.
 *
 * Only ever moves the outcome FORWARD to the nearest future exam. Once every
 * exam for a subject is in the past the outcome is left alone rather than
 * cleared: the person may still be working through the aftermath, and silently
 * blanking a goal they set is worse than leaving a stale one they can see.
 */
export async function syncBucketGoalForSubject(
  subjectCode: string,
  today: string = istToday(),
): Promise<{ bucketId: string; outcome: string | null; targetDate: string | null }> {
  const bucketId = await bucketForSubject(subjectCode);

  const [next] = await db
    .select()
    .from(exams)
    .where(and(eq(exams.subjectCode, subjectCode), gte(exams.date, today)))
    .orderBy(asc(exams.date))
    .limit(1);

  if (!next) {
    return { bucketId, outcome: null, targetDate: null };
  }

  const outcome = outcomeForExam({
    subjectCode: next.subjectCode,
    subjectName: next.subjectName,
    kind: next.kind as ExamKind,
    date: next.date,
  });

  await db
    .update(buckets)
    .set({ outcome, outcomeTargetDate: next.date, status: "active" })
    .where(eq(buckets.id, bucketId));

  await db.update(exams).set({ bucketId }).where(eq(exams.id, next.id));

  return { bucketId, outcome, targetDate: next.date };
}

export type ExamView = {
  id: string;
  subjectCode: string;
  subjectName: string | null;
  kind: ExamKind;
  date: string;
  location: string | null;
  bucketId: string | null;
  /** whole days from today; negative once it is past */
  daysAway: number;
};

/** Every exam from `today` onwards, soonest first. */
export async function upcomingExams(today: string = istToday()): Promise<ExamView[]> {
  const rows = await db
    .select()
    .from(exams)
    .where(gte(exams.date, today))
    .orderBy(asc(exams.date));

  return rows.map((r) => ({
    id: r.id,
    subjectCode: r.subjectCode,
    subjectName: r.subjectName,
    kind: r.kind as ExamKind,
    date: r.date,
    location: r.location,
    bucketId: r.bucketId,
    daysAway: Math.round(
      (Date.parse(`${r.date}T00:00:00+05:30`) - Date.parse(`${today}T00:00:00+05:30`)) /
        86_400_000,
    ),
  }));
}
