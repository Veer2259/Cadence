"use server";

/**
 * Timetable import actions.
 *
 * Parsing NEVER writes. The parse comes back, the person reviews it — including
 * everything that was excluded, struck through with its reason — and only
 * `confirmTimetable` writes anything.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { commitments, exams, plans, timetableImports } from "@/db/schema";
import { requireAuth } from "@/lib/auth";
import { istDateString, istToday } from "@/lib/time";
import { parseTimetable, MAX_PDF_BYTES } from "@/lib/ai/modes/timetable";
import {
  canConfirm,
  commitmentsToReplace,
  importRange,
  sessionProblems,
  toCommitments,
  type ExistingCommitment,
} from "@/lib/timetable";
import { syncBucketGoalForSubject } from "@/lib/exams";
import { timetableParse, type TimetableParse } from "@/lib/schemas";
import {
  StructuredOutputError,
  ModelBudgetError,
  DailyQuotaError,
  dailyQuotaResetHint,
} from "@/lib/ai/provider";

function friendly(e: unknown): string {
  if (e instanceof DailyQuotaError) {
    return `The daily request limit for ${e.model} is used up — ${dailyQuotaResetHint()}.`;
  }
  if (e instanceof ModelBudgetError) {
    return `Gave up after ${e.spent} model calls. Try again in a moment.`;
  }
  if (e instanceof StructuredOutputError) return e.message;
  const status = (e as { status?: number } | undefined)?.status;
  if (status === 429) return "Rate-limited — try again in a minute.";
  if (status === 503 || status === 500 || status === 529) {
    return "The model is busy — try again shortly.";
  }
  console.error("[timetable]", e);
  return e instanceof Error ? e.message : "That failed.";
}

/* ------------------------------------------------------------------ */
/*  Parse — reads the PDF, writes nothing                              */
/* ------------------------------------------------------------------ */

export type ParseReply =
  | {
      ok: true;
      parse: TimetableParse;
      /** rows that cannot be written, and why */
      problems: { index: number; title: string; problem: string }[];
      /** what a confirm would replace, named before it happens */
      willReplace: { id: string; title: string; date: string }[];
      range: { start: string; end: string } | null;
      /** dates with an existing plan that this import would change under */
      planConflicts: string[];
    }
  | { ok: false; error: string };

export async function parseTimetableFile(form: FormData): Promise<ParseReply> {
  await requireAuth();

  const file = form.get("pdf");
  const instruction = String(form.get("instruction") ?? "");

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a PDF first." };
  }
  if (file.type && file.type !== "application/pdf") {
    return { ok: false, error: `That is a ${file.type}, not a PDF.` };
  }
  if (file.size > MAX_PDF_BYTES) {
    return {
      ok: false,
      error: `That PDF is ${(file.size / 1024 / 1024).toFixed(1)}MB; the limit is ${MAX_PDF_BYTES / 1024 / 1024}MB.`,
    };
  }

  let parse: TimetableParse;
  try {
    const pdfBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    parse = await parseTimetable({
      pdfBase64,
      fileName: file.name,
      instruction,
    });
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }

  const problems = sessionProblems(parse.sessions);
  const range = importRange(parse.sessions, parse.exams);

  // Name what a confirm would replace BEFORE it happens.
  let willReplace: { id: string; title: string; date: string }[] = [];
  let planConflicts: string[] = [];
  if (range) {
    const existing = await loadCommitmentsInRange(range);
    willReplace = commitmentsToReplace(existing, range).map((c) => ({
      id: c.id,
      title: c.title,
      date: c.date,
    }));

    // A plan already built for one of these days may now disagree with the
    // timetable. Flag it; this codebase flags, it does not cascade.
    const planned = await db
      .select({ date: plans.date })
      .from(plans)
      .where(
        and(
          gte(plans.date, range.start),
          lte(plans.date, range.end),
          inArray(plans.status, ["draft", "committed"]),
        ),
      );
    planConflicts = [...new Set(planned.map((p) => p.date))].sort();
  }

  return { ok: true, parse, problems, willReplace, range, planConflicts };
}

async function loadCommitmentsInRange(range: {
  start: string;
  end: string;
}): Promise<ExistingCommitment[]> {
  // Commitments are stored as instants; widen by a day either side and filter
  // on the IST date, so a 23:00 IST class is not missed at the boundary.
  const from = new Date(`${range.start}T00:00:00+05:30`);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${range.end}T23:59:59+05:30`);
  to.setUTCDate(to.getUTCDate() + 1);

  const rows = await db
    .select({
      id: commitments.id,
      title: commitments.title,
      startAt: commitments.startAt,
      source: commitments.source,
    })
    .from(commitments)
    .where(and(gte(commitments.startAt, from), lte(commitments.startAt, to)));

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    date: istDateString(r.startAt),
    source: r.source as ExistingCommitment["source"],
  }));
}

/* ------------------------------------------------------------------ */
/*  Confirm — the only thing here that writes                          */
/* ------------------------------------------------------------------ */

const confirmSchema = z.object({
  parse: timetableParse,
  instruction: z.string().max(4000).optional(),
  fileName: z.string().max(300).optional(),
});

export type ConfirmReply =
  | {
      ok: true;
      written: number;
      replaced: number;
      examsWritten: number;
      goals: { bucket: string; outcome: string; targetDate: string }[];
    }
  | { ok: false; error: string };

export async function confirmTimetable(input: unknown): Promise<ConfirmReply> {
  await requireAuth();
  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Could not read that timetable." };

  const { parse, instruction, fileName } = parsed.data;

  // The review list is editable, so re-check rather than trusting the client.
  if (!canConfirm(parse.sessions)) {
    return {
      ok: false,
      error:
        "Some sessions still have no date or time. Fix or exclude them before saving — a class on the wrong date is worse than a missing one.",
    };
  }

  const range = importRange(parse.sessions, parse.exams);
  if (!range) return { ok: false, error: "Nothing to import." };

  const rows = toCommitments(parse.sessions);
  const datedExamRows = parse.exams.filter((e) => e.date);

  let replaced = 0;
  await db.transaction(async (tx) => {
    const [imp] = await tx
      .insert(timetableImports)
      .values({
        fileName: fileName ?? null,
        instruction: instruction ?? null,
        rangeStart: range.start,
        rangeEnd: range.end,
        sessionCount: rows.length,
        excludedCount: parse.sessions.filter((s) => s.excluded).length,
      })
      .returning({ id: timetableImports.id });

    // Replace ONLY previous imports inside the new range. Manual commitments
    // are untouched — that separation is the point of storing the source.
    const existing = await loadCommitmentsInRange(range);
    const doomed = commitmentsToReplace(existing, range);
    if (doomed.length) {
      await tx.delete(commitments).where(
        inArray(
          commitments.id,
          doomed.map((d) => d.id),
        ),
      );
      replaced = doomed.length;
    }

    if (rows.length) {
      await tx.insert(commitments).values(
        rows.map((r) => ({
          title: r.title,
          startAt: r.startAt,
          endAt: r.endAt,
          source: "timetable" as const,
          timetableImportId: imp.id,
        })),
      );
    }

    for (const e of datedExamRows) {
      await tx
        .insert(exams)
        .values({
          subjectCode: e.subjectCode,
          subjectName: e.subjectName,
          kind: e.kind,
          date: e.date as string,
          location: e.location,
          timetableImportId: imp.id,
        })
        .onConflictDoNothing();
    }

  });

  // An exam is a goal: point each subject's bucket at its next one. Outside the
  // transaction on purpose — the import is already correct, and a goal that
  // fails to sync is a smaller problem than losing the whole import.
  const goals: { bucket: string; outcome: string; targetDate: string }[] = [];
  for (const code of [...new Set(datedExamRows.map((e) => e.subjectCode))]) {
    try {
      const g = await syncBucketGoalForSubject(code, istToday());
      if (g.outcome && g.targetDate) {
        goals.push({ bucket: code, outcome: g.outcome, targetDate: g.targetDate });
      }
    } catch (e) {
      console.error("[timetable] goal sync failed for", code, e);
    }
  }

  revalidatePath("/settings");
  revalidatePath("/today");
  revalidatePath("/week");
  revalidatePath("/goals");

  return {
    ok: true,
    written: rows.length,
    replaced,
    examsWritten: datedExamRows.length,
    goals,
  };
}
