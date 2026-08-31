/**
 * Manual end-to-end check of compose against the real DB + real model.
 * Uses ONE model request (mind the 5 rpm free tier).
 *
 *   node --conditions=react-server --import tsx scripts/try-compose.ts [YYYY-MM-DD]
 */
import "../db/load-env";
import { composePlan } from "../lib/ai/modes/compose";
import { istToday } from "../lib/time";
import { closeDb } from "../db";

async function main() {
  const date = process.argv[2] ?? istToday();
  console.log(`composing for ${date} (provider=${process.env.LLM_PROVIDER})`);
  const t0 = Date.now();
  const out = await composePlan(date);
  console.log(`\ndone in ${Date.now() - t0}ms — retried=${out.retried}`);
  console.log(`blocks=${out.plan.blocks.length} overflow=${out.plan.overflow.length}`);
  console.log(`calibrationNote: ${out.plan.calibrationNote ?? "(null)"}`);
  console.log(`violations: ${out.violations.length ? "\n- " + out.violations.join("\n- ") : "none"}`);
  console.log("\n--- blocks ---");
  for (const b of out.plan.blocks) {
    console.log(`${b.start}-${b.end}  [${b.kind}/${b.category}] ${b.title}  (${b.estimateMin}m)`);
    console.log(`            ${b.reason}`);
  }
  if (out.plan.overflow.length) {
    console.log("\n--- overflow ---");
    for (const o of out.plan.overflow) {
      console.log(`${o.action}: ${o.reason} -> ${o.suggestion}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
