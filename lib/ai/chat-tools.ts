/**
 * lib/ai/chat-tools.ts — the 7 chat-rail tools (SPEC 6.6).
 *
 * Task reads/writes execute immediately. `trigger_compose` and
 * `trigger_rebalance` never execute here — they return a confirmation request
 * that the UI turns into a card the person must accept.
 */

import "server-only";
import { and, eq, gte, inArray, isNull, sql, ilike } from "drizzle-orm";
import { db } from "@/db";
import { tasks, buckets, timeLog, habits } from "@/db/schema";
import { insertTask, resolveBucketId } from "@/lib/tasks";
import { narrowCadence, formatCadence } from "@/lib/habits";
import {
  istEndOfDayToUtc,
  istToday,
  istMinutesOfDay,
  hmToMinutes,
  minutesToHm,
} from "@/lib/time";
import { computePressure } from "@/lib/pressure";
import { getLivePlan, applyBlockAdjustment, placeHabitBlock } from "@/lib/plan";
import { insertCommitment } from "@/lib/commitments";
import type { ToolDeclaration } from "@/lib/ai/adapters/types";

const CATEGORY = ["deep", "shallow", "calls", "admin", "errand", "personal"] as const;
const PRIORITY = ["low", "normal", "high"] as const;
const STATUS = ["inbox", "active", "done", "dropped"] as const;

export type ToolResult =
  | { result: Record<string, unknown> }
  | {
      confirm: {
        kind: "compose" | "rebalance" | "drop_block";
        params: Record<string, unknown>;
      };
    };

/* ------------------------------------------------------------------ */
/*  Declarations                                                       */
/* ------------------------------------------------------------------ */

const dateField = { type: "string", description: "IST date, YYYY-MM-DD" };

export const CHAT_TOOLS: ToolDeclaration[] = [
  {
    name: "create_task",
    description: "Create a task. Executes immediately.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        notes: { type: "string" },
        bucketName: { type: "string" },
        category: { type: "string", enum: CATEGORY },
        estimateMin: { type: "integer" },
        dueDate: dateField,
        priority: { type: "string", enum: PRIORITY },
        status: { type: "string", enum: ["inbox", "active"] },
        mustDoToday: {
          type: "boolean",
          description:
            "HARD constraint: the planner may not defer this to overflow. Only set " +
            "it when the person clearly means today is the deadline, not merely that " +
            "it is important — priority is for importance.",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "update_task",
    description:
      "Update a task, found by taskId or by titleContains. Executes immediately.",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        titleContains: { type: "string" },
        title: { type: "string" },
        notes: { type: "string" },
        bucketName: { type: "string" },
        category: { type: "string", enum: CATEGORY },
        estimateMin: { type: "integer" },
        dueDate: dateField,
        priority: { type: "string", enum: PRIORITY },
        status: { type: "string", enum: STATUS },
        mustDoToday: { type: "boolean", description: "see create_task" },
      },
    },
  },
  {
    name: "list_tasks",
    description: "List tasks. Read-only.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: STATUS },
        bucketName: { type: "string" },
        dueWithinDays: { type: "integer" },
      },
    },
  },
  {
    name: "list_habits",
    description:
      "List the person's habits (name, cadence, duration, preferred window). Read-only. " +
      "Use this to check whether something they mentioned is an existing habit before routing it.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "place_habit_today",
    description:
      "Put an existing habit on today's plan as a habit block. Executes immediately. " +
      "Use when the person says they are doing one of their habits today " +
      "(\"football tonight\", \"gym at 6\"). Not for new one-off things — that is create_commitment.",
    parameters: {
      type: "object",
      properties: {
        habitName: { type: "string", description: "matched against existing habits" },
        start: { type: "string", description: "IST clock time, HH:mm" },
        end: {
          type: "string",
          description: "IST clock time, HH:mm. Defaults to start + the habit's duration.",
        },
      },
      required: ["habitName", "start"],
    },
  },
  {
    name: "create_commitment",
    description:
      "Add a fixed commitment (a thing that cannot move: a meeting, a match, an appointment). " +
      "Executes immediately. Use for one-off timed things that are not a habit and not a to-do.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        start: { type: "string", description: "IST clock time, HH:mm" },
        end: { type: "string", description: "IST clock time, HH:mm" },
        date: { ...dateField, description: "IST date, YYYY-MM-DD (default: today)" },
      },
      required: ["title", "start", "end"],
    },
  },
  {
    name: "adjust_block",
    description:
      "Move, resize, or drop one block on today's live plan (draft OR committed). " +
      "Found by blockTitleContains. move/resize apply immediately; drop returns a " +
      "confirmation card. Other blocks are left where they are; any new conflict is reported.",
    parameters: {
      type: "object",
      properties: {
        blockTitleContains: { type: "string" },
        action: { type: "string", enum: ["move", "resize", "drop"] },
        start: { type: "string", description: "new start, HH:mm (move / resize)" },
        end: { type: "string", description: "new end, HH:mm (resize)" },
      },
      required: ["blockTitleContains", "action"],
    },
  },
  {
    name: "trigger_compose",
    description:
      "Ask to build today's plan. Returns a confirmation card; does not run until accepted.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "trigger_rebalance",
    description:
      "Ask to replan the rest of today. Returns a confirmation card; does not run until accepted.",
    parameters: {
      type: "object",
      properties: {
        account: { type: "string", description: "what happened so far" },
        energy: { type: "string", enum: ["sharp", "ok", "fried"] },
      },
      required: ["account", "energy"],
    },
  },
  {
    name: "query_time_log",
    description: "Aggregate logged time. Read-only.",
    parameters: {
      type: "object",
      properties: {
        days: { type: "integer", description: "look back this many days (default 7)" },
        bucketName: { type: "string" },
        category: { type: "string", enum: CATEGORY },
      },
    },
  },
  {
    name: "get_pressure",
    description: "The deadline-pressure table for the next 14 days. Read-only.",
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

export async function executeChatTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  switch (name) {
    case "create_task": {
      const title = str(args.title);
      if (!title) return { result: { error: "title is required" } };
      const row = await insertTask({
        title,
        notes: str(args.notes) ?? null,
        bucketName: str(args.bucketName) ?? null,
        category: oneOf(args.category, CATEGORY) ?? "shallow",
        estimateMin: num(args.estimateMin) ?? null,
        dueAt: str(args.dueDate) ? istEndOfDayToUtc(str(args.dueDate)!) : null,
        priority: oneOf(args.priority, PRIORITY) ?? "normal",
        status: oneOf(args.status, ["inbox", "active"] as const) ?? "active",
        mustDoToday: args.mustDoToday === true,
        source: "manual",
      });
      return { result: { created: row } };
    }

    case "update_task": {
      let id = str(args.taskId);
      if (!id) {
        const q = str(args.titleContains);
        if (!q) return { result: { error: "provide taskId or titleContains" } };
        const matches = await db
          .select({ id: tasks.id, title: tasks.title, status: tasks.status })
          .from(tasks)
          .where(and(ilike(tasks.title, `%${q}%`), inArray(tasks.status, ["inbox", "active"])));
        if (matches.length === 0) return { result: { error: "no matching task" } };
        if (matches.length > 1) return { result: { error: "multiple matches", matches } };
        id = matches[0].id;
      }
      const patch: Record<string, unknown> = {};
      if (str(args.title)) patch.title = str(args.title);
      if (args.notes !== undefined) patch.notes = str(args.notes) ?? null;
      if (oneOf(args.category, CATEGORY)) patch.category = oneOf(args.category, CATEGORY);
      if (oneOf(args.priority, PRIORITY)) patch.priority = oneOf(args.priority, PRIORITY);
      if (num(args.estimateMin) !== undefined) patch.estimateMin = num(args.estimateMin);
      if (str(args.bucketName) !== undefined)
        patch.bucketId = await resolveBucketId(str(args.bucketName)!);
      if (str(args.dueDate)) patch.dueAt = istEndOfDayToUtc(str(args.dueDate)!);
      if (typeof args.mustDoToday === "boolean") patch.mustDoToday = args.mustDoToday;
      const status = oneOf(args.status, STATUS);
      if (status) {
        patch.status = status;
        patch.completedAt = status === "done" ? new Date() : null;
      }
      if (Object.keys(patch).length === 0) return { result: { error: "nothing to change" } };
      const [updated] = await db
        .update(tasks)
        .set(patch)
        .where(eq(tasks.id, id))
        .returning({ id: tasks.id, title: tasks.title, status: tasks.status });
      return { result: { updated } };
    }

    case "list_tasks": {
      const status = oneOf(args.status, STATUS);
      const bucketId = str(args.bucketName) ? await resolveBucketId(str(args.bucketName)!) : undefined;
      const withinDays = num(args.dueWithinDays);
      const conds = [isNull(tasks.parentId)];
      if (status) conds.push(eq(tasks.status, status));
      else conds.push(inArray(tasks.status, ["inbox", "active"]));
      if (bucketId) conds.push(eq(tasks.bucketId, bucketId));
      if (withinDays !== undefined) {
        const cut = new Date(Date.now() + withinDays * 86_400_000);
        conds.push(sql`${tasks.dueAt} is not null and ${tasks.dueAt} <= ${cut.toISOString()}`);
      }
      const rows = await db
        .select({
          id: tasks.id,
          title: tasks.title,
          status: tasks.status,
          category: tasks.category,
          estimateMin: tasks.estimateMin,
          priority: tasks.priority,
          deferCount: tasks.deferCount,
          mustDoToday: tasks.mustDoToday,
          dueAt: tasks.dueAt,
        })
        .from(tasks)
        .where(and(...conds))
        .orderBy(sql`${tasks.dueAt} asc nulls last`)
        .limit(60);
      return { result: { count: rows.length, tasks: rows } };
    }

    case "list_habits": {
      const rows = await db.select().from(habits).where(eq(habits.active, true));
      return {
        result: {
          habits: rows.map((h) => ({
            name: h.name,
            cadence: formatCadence(narrowCadence(h.cadence)),
            durationMin: h.durationMin,
            preferredWindow: h.preferredWindow,
          })),
        },
      };
    }

    case "place_habit_today": {
      const wanted = str(args.habitName);
      const start = str(args.start);
      if (!wanted || !start) {
        return { result: { error: "habitName and start (HH:mm) are required" } };
      }
      const rows = await db.select().from(habits).where(eq(habits.active, true));
      const matches = rows.filter((h) =>
        h.name.toLowerCase().includes(wanted.toLowerCase()),
      );
      if (matches.length === 0) {
        return {
          result: {
            error: "no habit by that name",
            known: rows.map((h) => h.name),
            hint: "If this is a one-off rather than a habit, use create_commitment.",
          },
        };
      }
      if (matches.length > 1) {
        return {
          result: { error: "multiple matching habits", matches: matches.map((h) => h.name) },
        };
      }
      const habit = matches[0];
      const startMin = hmToMinutes(start);
      const endMin = str(args.end)
        ? hmToMinutes(str(args.end)!)
        : startMin + habit.durationMin;

      const res = await placeHabitBlock({
        dateStr: istToday(),
        habitId: habit.id,
        title: habit.name,
        durationMin: habit.durationMin,
        startMin,
        endMin,
        reason: "You said you're doing this today.",
      });
      if (!res.ok) return { result: { error: res.error } };
      return {
        result: {
          placed: {
            name: habit.name,
            start: minutesToHm(startMin),
            end: minutesToHm(Math.min(1440, endMin)),
          },
          // true = the habit was already on today's plan and was moved, not duplicated
          movedExisting: res.moved === true,
          violations: res.violations,
          note: "Offer to rebalance the rest of the day; do not move other blocks yourself.",
        },
      };
    }

    case "create_commitment": {
      const title = str(args.title);
      const start = str(args.start);
      const end = str(args.end);
      if (!title || !start || !end) {
        return { result: { error: "title, start and end (HH:mm) are required" } };
      }
      const date = str(args.date) ?? istToday();
      try {
        const row = await insertCommitment({
          title,
          dateStr: date,
          startHm: start,
          endHm: end,
        });
        return {
          result: {
            created: { title: row.title, date, start, end },
            note: "The next plan / rebalance will treat this time as blocked.",
          },
        };
      } catch (e) {
        return { result: { error: e instanceof Error ? e.message : "could not save" } };
      }
    }

    case "adjust_block": {
      const q = str(args.blockTitleContains);
      const action = oneOf(args.action, ["move", "resize", "drop"] as const);
      if (!q || !action) {
        return { result: { error: "blockTitleContains and action are required" } };
      }
      const live = await getLivePlan(istToday());
      if (!live) return { result: { error: "there is no plan today to adjust" } };
      const matches = live.blocks.filter((b) =>
        b.title.toLowerCase().includes(q.toLowerCase()),
      );
      if (matches.length === 0) return { result: { error: "no matching block" } };
      if (matches.length > 1) {
        return {
          result: {
            error: "multiple matching blocks",
            matches: matches.map((b) => b.title),
          },
        };
      }
      const block = matches[0];
      const curStart = istMinutesOfDay(block.startAt);
      const curEndRaw = istMinutesOfDay(block.endAt);
      const curEnd = curEndRaw <= curStart ? 1440 : curEndRaw;

      if (action === "drop") {
        return {
          confirm: {
            kind: "drop_block",
            params: { blockId: block.id, title: block.title },
          },
        };
      }

      let startMin = curStart;
      let endMin = curEnd;
      if (action === "move") {
        const s = str(args.start);
        if (!s) return { result: { error: "move needs a new start (HH:mm)" } };
        startMin = hmToMinutes(s);
        endMin = startMin + (curEnd - curStart); // keep duration
      } else {
        // resize
        const e = str(args.end);
        const s = str(args.start);
        if (s) startMin = hmToMinutes(s);
        if (!e) return { result: { error: "resize needs a new end (HH:mm)" } };
        endMin = hmToMinutes(e);
      }

      const res = await applyBlockAdjustment({
        dateStr: istToday(),
        blockId: block.id,
        startMin,
        endMin,
      });
      if (!res.ok) return { result: { error: res.error } };
      return {
        result: {
          updated: {
            title: block.title,
            start: minutesToHm(startMin),
            end: minutesToHm(Math.min(1440, endMin)),
          },
          violations: res.violations,
        },
      };
    }

    case "trigger_compose":
      return { confirm: { kind: "compose", params: {} } };

    case "trigger_rebalance": {
      const account = str(args.account) ?? "";
      const energy = oneOf(args.energy, ["sharp", "ok", "fried"] as const) ?? "ok";
      return { confirm: { kind: "rebalance", params: { account, energy } } };
    }

    case "query_time_log": {
      const days = num(args.days) ?? 7;
      const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      const rows = await db
        .select({
          durationMin: timeLog.durationMin,
          category: timeLog.category,
          bucketId: timeLog.bucketId,
          date: timeLog.date,
        })
        .from(timeLog)
        .where(gte(timeLog.date, cutoff));
      const bucketNames = new Map(
        (await db.select({ id: buckets.id, name: buckets.name }).from(buckets)).map((b) => [
          b.id,
          b.name,
        ]),
      );
      const wantBucket = str(args.bucketName)?.toLowerCase();
      const wantCat = oneOf(args.category, CATEGORY);
      let total = 0;
      const byCategory: Record<string, number> = {};
      const byBucket: Record<string, number> = {};
      for (const r of rows) {
        const bn = r.bucketId ? (bucketNames.get(r.bucketId) ?? "?") : "(none)";
        if (wantBucket && bn.toLowerCase() !== wantBucket) continue;
        if (wantCat && r.category !== wantCat) continue;
        total += r.durationMin;
        byCategory[r.category] = (byCategory[r.category] ?? 0) + r.durationMin;
        byBucket[bn] = (byBucket[bn] ?? 0) + r.durationMin;
      }
      return {
        result: { days, totalMin: total, byCategoryMin: byCategory, byBucketMin: byBucket },
      };
    }

    case "get_pressure": {
      const p = await computePressure();
      return {
        result: {
          horizonDays: p.horizonDays,
          freeHoursByDay: p.days.map((d) => ({ date: d.date, freeHours: d.freeHours })),
          deadlines: p.deadlines.map((d) => ({
            title: d.title,
            dueDate: d.dueDate,
            hoursNeeded: d.hoursNeeded,
            hoursAvailable: d.hoursAvailable,
            status: d.status,
          })),
        },
      };
    }

    default:
      return { result: { error: `unknown tool ${name}` } };
  }
}
