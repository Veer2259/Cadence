/**
 * lib/pressure-alloc.ts — the earliest-due-first allocation from SPEC section 5,
 * step 3. Pure (no DB), so the allocation is unit tested directly.
 *
 * The bug this prevents: three tasks due Thursday must NOT each independently
 * "have" the same free hours. Earlier deadlines consume the shared pool first.
 */

export type PressureStatus = "safe" | "tight" | "at_risk" | "impossible";

export function classify(ratio: number): PressureStatus {
  if (ratio >= 1.5) return "safe";
  if (ratio >= 1.0) return "tight";
  if (ratio >= 0.6) return "at_risk";
  return "impossible";
}

export type AllocNeed = {
  /** index into `freePerDay`; 0 = today. The deadline's IST due day. */
  dueDayIndex: number;
  hoursNeeded: number;
};

export type AllocOutcome = {
  /** free hours this deadline can still draw on, after every earlier deadline */
  hoursAvailable: number;
  /** hours actually reserved for it (min of available and needed) */
  hoursAllocated: number;
  ratio: number;
  status: PressureStatus;
};

/**
 * Allocate the free-hours pool to deadlines, earliest due day first. Returns one
 * outcome per input need, in the SAME order as `needs` (not the sorted order).
 */
export function allocateEarliestDueFirst(
  needs: AllocNeed[],
  freePerDay: number[],
): AllocOutcome[] {
  // prefix[i] = free hours available on days 0..i inclusive
  const prefix: number[] = [];
  let run = 0;
  for (const h of freePerDay) {
    run += Math.max(0, h);
    prefix.push(run);
  }
  const totalPool = run;
  const capacityUpTo = (dayIndex: number) => {
    if (freePerDay.length === 0) return 0;
    const i = Math.min(Math.max(dayIndex, 0), prefix.length - 1);
    return dayIndex < 0 ? 0 : prefix[i];
  };

  const order = needs
    .map((n, i) => ({ n, i }))
    .sort((a, b) => a.n.dueDayIndex - b.n.dueDayIndex || a.i - b.i);

  const out: AllocOutcome[] = new Array(needs.length);
  let consumed = 0;

  for (const { n, i } of order) {
    const capacity = Math.max(capacityUpTo(n.dueDayIndex), 0);
    // never more than what's still in the whole pool
    const available = Math.max(0, Math.min(capacity - consumed, totalPool - consumed));
    const ratio = n.hoursNeeded > 0 ? available / n.hoursNeeded : Number.POSITIVE_INFINITY;
    const allocated = Math.min(available, n.hoursNeeded);
    consumed += allocated;
    out[i] = {
      hoursAvailable: round2(available),
      hoursAllocated: round2(allocated),
      ratio: Number.isFinite(ratio) ? round2(ratio) : ratio,
      status: classify(ratio),
    };
  }

  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
