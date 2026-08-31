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
import { tasks, buckets, timeLog } from "@/db/schema";
import { insertTask, resolveBucketId } from "@/lib/tasks";
import { istEndOfDayToUtc } from "@/lib/time";
import { computePressure } from "@/lib/pressure";
import type { ToolDeclaration } from "@/lib/ai/adapters/types";

const CATEGORY = ["deep", "shallow", "calls", "admin", "errand", "personal"] as const;
const PRIORITY = ["low", "normal", "high"] as const;
const STATUS = ["inbox", "active", "done", "dropped"] as const;

export type ToolResult =
  | { result: Record<string, unknown> }
  | { confirm: { kind: "compose" | "rebalance"; params: Record<string, unknown> } };

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
          dueAt: tasks.dueAt,
        })
        .from(tasks)
        .where(and(...conds))
        .orderBy(sql`${tasks.dueAt} asc nulls last`)
        .limit(60);
      return { result: { count: rows.length, tasks: rows } };
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
