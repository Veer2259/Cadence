/**
 * lib/commitments.ts — create a fixed commitment (a thing that cannot move).
 *
 * Shared by the Today "＋ Fixed commitment" form and the chat rail's
 * `create_commitment` tool. Compose already treats commitments as
 * absolute, so a commitment written here is honoured by the next plan.
 */

import "server-only";
import { db } from "@/db";
import { commitments, type Commitment } from "@/db/schema";
import { istDayInstant, hmToMinutes } from "@/lib/time";

export async function insertCommitment(args: {
  title: string;
  dateStr: string;
  startHm: string;
  endHm: string;
}): Promise<Commitment> {
  const { title, dateStr, startHm, endHm } = args;
  if (hmToMinutes(endHm) <= hmToMinutes(startHm)) {
    throw new Error("A commitment must end after it starts.");
  }
  const [row] = await db
    .insert(commitments)
    .values({
      title: title.trim().slice(0, 120),
      startAt: istDayInstant(dateStr, startHm),
      endAt: istDayInstant(dateStr, endHm),
      source: "manual",
      recurrence: null,
    })
    .returning();
  return row;
}
