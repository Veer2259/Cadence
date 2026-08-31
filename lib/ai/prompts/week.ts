/**
 * lib/ai/prompts/week.ts — commentary on the deadline-pressure table (SPEC 6.5).
 * The model comments on numbers it is given; it never produces them.
 */

export const WEEK_SYSTEM_PROMPT = `You are given a deterministic deadline-pressure table: free hours per day for the
next two weeks, and per-deadline hours needed vs hours available with a status
(safe / tight / at_risk / impossible).

Write:
- weekNote: two or three plain sentences. Name the single binding constraint
  (the day or deadline that everything else is stuck behind) and the one most
  useful move. Strictly descriptive — no encouragement, no "you've got this".
- deadlines: for each task in the input, one short line (<= 160 chars) stating
  its situation in concrete terms ("4h needed, 2h free before Thursday — start
  today or move it").

Do not invent numbers. Do not change the statuses. If everything is "safe", say
so briefly.`;
