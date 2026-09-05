/**
 * lib/ai/chat-tools-extra.ts — the rest of the app, as tools.
 *
 * The assistant rail is the primary way to operate Cadence: capture, planning,
 * logging, closing the day, goals, buckets, habits and the review numbers are
 * all reachable from one conversation. These are the tools that were missing
 * for that to be true. They live in their own file only because chat-tools.ts
 * was already long; they are declared and executed exactly like the rest.
 *
 * The standing confirmation rules hold here:
 *   - capture PROPOSES into a review card; it never writes on its own (SPEC 6.2)
 *   - committing a plan, discarding one, and closing the day all return a card
 *   - everything else that is cheap and reversible executes immediately
 */

import "server-only";
import { desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { buckets, habits, plans, tasks, weeklyTargets } from "@/db/schema";
import { getLivePlan, logBlockStatus, placeTaskBlock } from "@/lib/plan";
import { getPlanToDebrief } from "@/lib/debrief";
import { recordEnergy } from "@/lib/energy-db";
import { computeReview } from "@/lib/review";
import { loadFocusScores } from "@/lib/focus-db";
import { weeklyTargetsFor, weekStartOf } from "@/lib/goals";
import { captureFromText } from "@/lib/ai/modes/capture";
import { hmToMinutes, istMinutesOfDay, istToday, minutesToHm } from "@/lib/time";
import type { ToolDeclaration } from "@/lib/ai/adapters/types";
import type { ToolResult } from "@/lib/ai/chat-tools";

const dateField = { type: "string", description: "IST date, YYYY-MM-DD" };

/* ------------------------------------------------------------------ */
/*  Declarations                                                       */
/* ------------------------------------------------------------------ */

export const EXTRA_CHAT_TOOLS: ToolDeclaration[] = [
  {
    name: "capture_brain_dump",
    description:
      "Parse a brain dump into tasks. Use this when the person is EMPTYING THEIR " +
      "HEAD — several things at once, or a stream of thought — rather than asking " +
      "for one specific change. It writes nothing: it returns either clarifying " +
      "questions (ask them and stop) or a review card the person confirms.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "their words, verbatim" },
        answers: {
          type: "string",
          description: "their answers to clarifying questions from an earlier call",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "schedule_task",
    description:
      "Put an existing task on a day's plan at a time. This is how an OVERFLOW " +
      "item gets dealt with — overflow means there was no room that day, and the " +
      "fix is to place it on another one. Also moves a task already blocked on " +
      "that day. Executes immediately. The day must already have a plan; if it " +
      "does not, say so and offer to build one.",
    parameters: {
      type: "object",
      properties: {
        taskTitleContains: { type: "string" },
        date: { ...dateField, description: "the day to put it on; default: today" },
        start: { type: "string", description: "IST clock time, HH:mm" },
        end: { type: "string", description: "HH:mm; defaults to start + the estimate" },
        reason: { type: "string", description: "one line, why it is in that slot" },
      },
      required: ["taskTitleContains", "start"],
    },
  },
  {
    name: "log_block_status",
    description:
      "Mark one block on a day's plan done, partial or skipped — or back to " +
      "planned. Found by blockTitleContains. Executes immediately.",
    parameters: {
      type: "object",
      properties: {
        blockTitleContains: { type: "string" },
        status: { type: "string", enum: ["planned", "done", "partial", "skipped"] },
        date: { ...dateField, description: "default: today" },
      },
      required: ["blockTitleContains", "status"],
    },
  },
  {
    name: "log_energy",
    description:
      "Record how sharp they feel right now. Executes immediately. Use when they " +
      'say something like "I\'m fried" or "feeling sharp".',
    parameters: {
      type: "object",
      properties: { level: { type: "string", enum: ["fried", "ok", "sharp"] } },
      required: ["level"],
    },
  },
  {
    name: "commit_plan",
    description:
      "Commit today's draft plan. Returns a confirmation card; does not run until accepted.",
    parameters: {
      type: "object",
      properties: { date: { ...dateField, description: "default: today" } },
    },
  },
  {
    name: "discard_plan",
    description:
      "Throw away the current draft plan. Returns a confirmation card; does not run until accepted.",
    parameters: {
      type: "object",
      properties: { date: { ...dateField, description: "default: today" } },
    },
  },
  {
    name: "close_the_day",
    description:
      "Close out a committed day: log what actually happened and update " +
      "calibration. Returns a confirmation card. CLOSING IS FINAL — the day " +
      "cannot be reopened. Call get_plan first and pass an entry per block; any " +
      "block you omit is logged as done at its planned length.",
    parameters: {
      type: "object",
      properties: {
        date: { ...dateField, description: "default: today" },
        entries: {
          type: "array",
          description: "one per block you want to log differently from planned",
          items: {
            type: "object",
            properties: {
              blockTitleContains: { type: "string" },
              status: { type: "string", enum: ["done", "partial", "skipped"] },
              actualMin: { type: "integer", description: "omit for skipped" },
            },
            required: ["blockTitleContains", "status"],
          },
        },
      },
    },
  },
  {
    name: "list_buckets",
    description: "The person's buckets, with any outcome and weekly targets. Read-only.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "create_bucket",
    description:
      "Create a bucket (a project or life area). Executes immediately. Never " +
      "invent one they did not ask for.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "lowercase, their words" },
        color: { type: "string", description: "hex like #2f5d50; optional" },
      },
      required: ["name"],
    },
  },
  {
    name: "retire_bucket",
    description:
      "Retire a bucket. Its history is kept and it stops appearing for new work. " +
      "Executes immediately and is reversible.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        active: { type: "boolean", description: "false to retire, true to restore" },
      },
      required: ["name"],
    },
  },
  {
    name: "create_habit",
    description:
      "Create a recurring habit — something they want placed regularly that is " +
      "not a task. Executes immediately.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        cadence: { type: "string", description: 'e.g. "3x/week", "daily", "mon,wed,fri"' },
        durationMin: { type: "integer" },
        preferredWindow: { type: "string", description: 'e.g. "06:00-08:00"' },
        bucketName: { type: "string" },
      },
      required: ["name", "cadence", "durationMin"],
    },
  },
  {
    name: "update_habit",
    description:
      "Change or deactivate an existing habit. Executes immediately. Matched by name.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "the habit to change" },
        cadence: { type: "string" },
        durationMin: { type: "integer" },
        preferredWindow: { type: "string" },
        active: { type: "boolean" },
      },
      required: ["name"],
    },
  },
  {
    name: "set_bucket_outcome",
    description:
      "Set what 'done' looks like for a bucket, and when it should be true by. " +
      "This is the goal the planner works towards. Executes immediately.",
    parameters: {
      type: "object",
      properties: {
        bucketName: { type: "string" },
        outcome: { type: "string", description: "one concrete sentence" },
        targetDate: { ...dateField, description: "when it should be true by; optional" },
      },
      required: ["bucketName", "outcome"],
    },
  },
  {
    name: "set_weekly_target",
    description:
      "Set a target for one bucket for one week. Executes immediately.",
    parameters: {
      type: "object",
      properties: {
        bucketName: { type: "string" },
        description: { type: "string", description: "what the target is, in a line" },
        weekStart: { ...dateField, description: "the IST Monday; default: this week" },
        targetHours: { type: "number", description: "optional — a target can be a deliverable" },
      },
      required: ["bucketName", "description"],
    },
  },
  {
    name: "get_goals",
    description:
      "Bucket outcomes and this week's targets, with where each one stands. Read-only.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_review",
    description:
      "The learned numbers: estimate accuracy over time, per-category calibration " +
      "ratios, hours per bucket, the defer leaderboard, and learned focus hours. " +
      "Read-only. Use it to answer 'how am I doing' honestly, with figures.",
    parameters: { type: "object", properties: {} },
  },
];

/* ------------------------------------------------------------------ */
/*  Execution                                                          */
/* ------------------------------------------------------------------ */

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function oneOf<T extends readonly string[]>(v: unknown, allowed: T): T[number] | undefined {
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T[number])
    : undefined;
}

async function bucketByName(name: string) {
  const rows = await db.select().from(buckets);
  return rows.find((b) => b.name.toLowerCase() === name.toLowerCase().trim()) ?? null;
}

/** Returns null when the tool name is not one of ours. */
export async function executeExtraChatTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult | null> {
  switch (name) {
    /* ---------------- capture ---------------- */
    case "capture_brain_dump": {
      const text = str(args.text);
      if (!text) return { result: { error: "nothing to capture" } };
      const parsed = await captureFromText(text, str(args.answers));

      // A vague goal gets questions before anything is written (SPEC 6.2).
      if (parsed.clarifications.length > 0 && parsed.tasks.length === 0) {
        return {
          result: {
            needsAnswers: true,
            questions: parsed.clarifications,
            note:
              "Ask these in your reply and stop. Call capture_brain_dump again " +
              "with the same text plus their answers.",
          },
        };
      }
      if (parsed.tasks.length === 0) {
        return { result: { captured: 0, note: "Nothing actionable in that." } };
      }
      return {
        confirm: {
          kind: "capture_tasks",
          params: {
            tasks: parsed.tasks.map((t) => ({
              title: t.title,
              notes: t.notes,
              bucketName: t.bucketName,
              category: t.category,
              estimateMin: t.estimateMin,
              dueDate: t.dueAt ? t.dueAt.slice(0, 10) : null,
              possibleDuplicateOf: t.possibleDuplicateOf,
            })),
            clarifications: parsed.clarifications,
          },
        },
      };
    }

    /* ---------------- the day ---------------- */
    case "schedule_task": {
      const q = str(args.taskTitleContains);
      const start = str(args.start);
      if (!q || !start) {
        return { result: { error: "taskTitleContains and start (HH:mm) are required" } };
      }
      const date = str(args.date) ?? istToday();

      // Search EVERY status, not just the open ones. A bare "no open task
      // matching X" when the task exists but is done reads as "it does not
      // exist", and the model's recovery from that is to create a duplicate —
      // which is exactly what happened the first time this ran.
      const all = await db.select().from(tasks);
      const named = all.filter((t) => t.title.toLowerCase().includes(q.toLowerCase()));
      if (named.length === 0) {
        return { result: { error: `no task at all matching "${q}"` } };
      }
      const open = named.filter((t) => t.status === "inbox" || t.status === "active");
      if (open.length === 0) {
        const t = named[0];
        return {
          result: {
            error: `"${t.title}" exists but is ${t.status}, so it cannot be scheduled.`,
            hint:
              "Reopen it with update_task (status: active) if that is what they " +
              "meant. Do NOT create a new task with the same title.",
          },
        };
      }
      if (open.length > 1) {
        return { result: { error: "multiple matches", matches: open.map((t) => t.title) } };
      }
      const task = open[0];

      const startMin = hmToMinutes(start);
      const raw = task.estimateMin ?? 30;
      const endStr = str(args.end);
      const endMin = endStr ? hmToMinutes(endStr) : startMin + raw;

      const res = await placeTaskBlock({
        dateStr: date,
        taskId: task.id,
        title: task.title,
        category: task.category,
        rawEstimateMin: raw,
        startMin,
        endMin,
        reason: str(args.reason) ?? "You asked for it in this slot.",
      });
      if (!res.ok) return { result: { error: res.error } };
      return {
        result: {
          scheduled: task.title,
          date,
          start: minutesToHm(startMin),
          end: minutesToHm(endMin),
          moved: res.moved === true,
          violations: res.violations,
          note:
            "If it was in overflow, it no longer is — a task is a block or an " +
            "overflow row, never both.",
        },
      };
    }

    case "log_block_status": {
      const q = str(args.blockTitleContains);
      const status = oneOf(args.status, ["planned", "done", "partial", "skipped"] as const);
      if (!q || !status) return { result: { error: "blockTitleContains and status required" } };
      const date = str(args.date) ?? istToday();
      const live = await getLivePlan(date);
      if (!live) return { result: { error: `no plan on ${date}` } };
      const matches = live.blocks.filter((b) =>
        b.title.toLowerCase().includes(q.toLowerCase()),
      );
      if (matches.length === 0) {
        return {
          result: { error: `no block on ${date} matching "${q}"`, blocksOnThatDay: live.blocks.map((b) => b.title) },
        };
      }
      if (matches.length > 1) {
        return { result: { error: "multiple matches", matches: matches.map((b) => b.title) } };
      }
      const res = await logBlockStatus({ dateStr: date, blockId: matches[0].id, status });
      if (!res.ok) return { result: { error: res.error } };
      return { result: { logged: matches[0].title, status, date } };
    }

    case "log_energy": {
      const level = oneOf(args.level, ["fried", "ok", "sharp"] as const);
      if (!level) return { result: { error: "level must be fried, ok or sharp" } };
      await recordEnergy(level);
      return {
        result: {
          level,
          at: minutesToHm(istMinutesOfDay(new Date())),
          note: "Recorded. It informs the learned focus hours, nothing immediate.",
        },
      };
    }

    case "commit_plan": {
      const date = str(args.date) ?? istToday();
      const live = await getLivePlan(date);
      if (!live) return { result: { error: `no plan on ${date}` } };
      if (live.plan.status === "committed") {
        return { result: { error: `the plan on ${date} is already committed` } };
      }
      return { confirm: { kind: "commit_plan", params: { date, planId: live.plan.id } } };
    }

    case "discard_plan": {
      const date = str(args.date) ?? istToday();
      const live = await getLivePlan(date);
      if (!live) return { result: { error: `no plan on ${date}` } };
      if (live.plan.status !== "draft") {
        return { result: { error: "only a draft can be discarded" } };
      }
      return { confirm: { kind: "discard_plan", params: { date, planId: live.plan.id } } };
    }

    case "close_the_day": {
      const date = str(args.date) ?? istToday();
      const target = await getPlanToDebrief(date);
      if (!target) {
        return { result: { error: `nothing to close on ${date} — no committed, undebriefed plan` } };
      }
      const raw = Array.isArray(args.entries) ? args.entries : [];
      const entries = raw
        .map((e) => (e && typeof e === "object" ? (e as Record<string, unknown>) : null))
        .filter((e): e is Record<string, unknown> => !!e)
        .map((e) => ({
          blockTitleContains: str(e.blockTitleContains) ?? "",
          status: oneOf(e.status, ["done", "partial", "skipped"] as const) ?? "done",
          actualMin: num(e.actualMin) ?? null,
        }))
        .filter((e) => e.blockTitleContains);
      return {
        confirm: {
          kind: "close_day",
          params: { date, planId: target.plan.id, entries },
        },
      };
    }

    /* ---------------- buckets ---------------- */
    case "list_buckets": {
      const rows = await db.select().from(buckets).orderBy(buckets.name);
      return {
        result: {
          buckets: rows.map((b) => ({
            name: b.name,
            active: b.active,
            outcome: b.outcome,
            targetDate: b.outcomeTargetDate,
            status: b.status,
          })),
        },
      };
    }

    case "create_bucket": {
      const name = str(args.name)?.toLowerCase();
      if (!name) return { result: { error: "name is required" } };
      if (await bucketByName(name)) return { result: { error: `"${name}" already exists` } };
      const [row] = await db
        .insert(buckets)
        .values({ name, color: str(args.color) ?? "#7A8CA3", active: true })
        .returning({ name: buckets.name });
      return { result: { created: row.name } };
    }

    case "retire_bucket": {
      const name = str(args.name);
      if (!name) return { result: { error: "name is required" } };
      const b = await bucketByName(name);
      if (!b) return { result: { error: `no bucket called "${name}"` } };
      const active = args.active === true;
      await db.update(buckets).set({ active }).where(eq(buckets.id, b.id));
      return { result: { bucket: b.name, active, note: "History is kept either way." } };
    }

    /* ---------------- habits ---------------- */
    case "create_habit": {
      const name = str(args.name);
      const cadence = str(args.cadence);
      const durationMin = num(args.durationMin);
      if (!name || !cadence || !durationMin) {
        return { result: { error: "name, cadence and durationMin are required" } };
      }
      const bn = str(args.bucketName);
      const b = bn ? await bucketByName(bn) : null;
      const [row] = await db
        .insert(habits)
        .values({
          name,
          cadence,
          durationMin,
          preferredWindow: str(args.preferredWindow) ?? null,
          bucketId: b?.id ?? null,
          active: true,
        })
        .returning({ name: habits.name });
      return { result: { created: row.name, cadence, durationMin } };
    }

    case "update_habit": {
      const name = str(args.name);
      if (!name) return { result: { error: "name is required" } };
      const rows = await db.select().from(habits);
      const h = rows.find((x) => x.name.toLowerCase().includes(name.toLowerCase()));
      if (!h) return { result: { error: `no habit called "${name}"` } };
      const patch: Record<string, unknown> = {};
      if (str(args.cadence)) patch.cadence = str(args.cadence);
      if (num(args.durationMin)) patch.durationMin = num(args.durationMin);
      if (args.preferredWindow !== undefined) patch.preferredWindow = str(args.preferredWindow) ?? null;
      if (typeof args.active === "boolean") patch.active = args.active;
      if (Object.keys(patch).length === 0) return { result: { error: "nothing to change" } };
      await db.update(habits).set(patch).where(eq(habits.id, h.id));
      return { result: { updated: h.name, ...patch } };
    }

    /* ---------------- goals ---------------- */
    case "set_bucket_outcome": {
      const bn = str(args.bucketName);
      const outcome = str(args.outcome);
      if (!bn || !outcome) return { result: { error: "bucketName and outcome are required" } };
      const b = await bucketByName(bn);
      if (!b) return { result: { error: `no bucket called "${bn}"` } };
      const targetDate = str(args.targetDate) ?? null;
      await db
        .update(buckets)
        .set({ outcome, outcomeTargetDate: targetDate, status: "active" })
        .where(eq(buckets.id, b.id));
      return { result: { bucket: b.name, outcome, targetDate } };
    }

    case "set_weekly_target": {
      const bn = str(args.bucketName);
      const description = str(args.description);
      if (!bn || !description) {
        return { result: { error: "bucketName and description are required" } };
      }
      const b = await bucketByName(bn);
      if (!b) return { result: { error: `no bucket called "${bn}"` } };
      const weekStart = str(args.weekStart) ?? weekStartOf(istToday());
      const hours = num(args.targetHours);
      const [row] = await db
        .insert(weeklyTargets)
        .values({
          bucketId: b.id,
          weekStart,
          description,
          targetHours: hours == null ? null : String(hours),
        })
        .returning({ id: weeklyTargets.id });
      return { result: { created: row.id, bucket: b.name, weekStart, description, targetHours: hours ?? null } };
    }

    case "get_goals": {
      const rows = await db.select().from(buckets).where(isNotNull(buckets.outcome));
      const thisWeek = await weeklyTargetsFor(weekStartOf(istToday()));
      return {
        result: {
          outcomes: rows.map((b) => ({
            bucket: b.name,
            outcome: b.outcome,
            targetDate: b.outcomeTargetDate,
            status: b.status,
          })),
          thisWeeksTargets: thisWeek.map((t) => ({
            bucket: t.bucketName,
            description: t.description,
            targetHours: t.targetHours,
            hoursLogged: t.actualHours,
            tasksDone: `${t.doneTasks}/${t.totalTasks}`,
          })),
        },
      };
    }

    /* ---------------- review ---------------- */
    case "get_review": {
      const r = await computeReview();
      const focus = await loadFocusScores();
      const learned = focus.filter((f) => f.score != null || f.manualScore != null);
      const closed = await db
        .select({ date: plans.date })
        .from(plans)
        .where(isNotNull(plans.debriefedAt))
        .orderBy(desc(plans.date));
      return {
        result: {
          debriefedDays: closed.length,
          latestAccuracy: r.accuracy.at(-1)?.ratio ?? null,
          accuracyTrend: r.accuracy.slice(-8),
          calibrationByCategory: r.categories,
          hoursPerBucket: r.buckets,
          deferLeaderboard: r.deferLeaderboard.slice(0, 5),
          learnedFocusHours:
            learned.length > 0
              ? learned.map((f) => ({ hour: f.hour, score: f.manualScore ?? f.score }))
              : null,
          note:
            learned.length === 0
              ? "No focus hours learned yet — that is honest, not missing data. They appear after a few debriefs."
              : undefined,
        },
      };
    }

    default:
      return null;
  }
}
