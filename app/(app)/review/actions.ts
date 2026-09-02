"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { setFocusOverride } from "@/lib/focus-db";

const schema = z.object({
  hour: z.coerce.number().int().min(0).max(23),
  /** 0..1, or null to clear the override and go back to the learned score */
  score: z.union([z.coerce.number().min(0).max(1), z.null()]),
});

/**
 * Override one hour's focus score by hand. The evidence is shown next to it on
 * Review, so this is a correction made with the data in view — not a blind
 * preference like the sharp hours it replaced.
 */
export async function overrideFocusHour(formData: FormData): Promise<void> {
  await requireAuth();
  const raw = formData.get("score");
  const parsed = schema.safeParse({
    hour: formData.get("hour"),
    score: raw === "" || raw === null ? null : raw,
  });
  if (!parsed.success) throw new Error("Bad focus override.");
  await setFocusOverride(parsed.data.hour, parsed.data.score);
  revalidatePath("/review");
  revalidatePath("/today");
}
