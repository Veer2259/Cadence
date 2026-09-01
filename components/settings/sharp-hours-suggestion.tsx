"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/controls";
import { applySuggestedSharpHours } from "@/app/(app)/settings/actions";
import type { SharpSuggestion } from "@/lib/energy";

const fmt = (ws: [string, string][]) =>
  ws.length ? ws.map(([a, b]) => `${a}–${b}`).join(", ") : "none";

/**
 * What the energy log says your sharp hours should be. Shown, never applied on
 * its own: the log is evidence, the day profile is the person's call.
 */
export function SharpHoursSuggestion({
  suggestion,
  current,
}: {
  suggestion: SharpSuggestion;
  current: [string, string][];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);
  const [applied, setApplied] = useState(false);

  if (suggestion.sampleN === 0) {
    return (
      <p className="text-xs text-ink-muted">
        No energy check-ins yet. Log a few from Today and this will start
        suggesting the hours you are actually sharp in.
      </p>
    );
  }

  const same = fmt(suggestion.windows) === fmt(current);

  return (
    <div className="flex flex-col gap-2 border-t border-rule pt-3">
      <p className="text-xs text-ink-muted">
        Your check-ins ({suggestion.sampleN} across {suggestion.dayN} day
        {suggestion.dayN === 1 ? "" : "s"}) point at{" "}
        <span className="tabular text-ink">{fmt(suggestion.windows)}</span>. A
        typical working day is currently set to{" "}
        <span className="tabular text-ink">{fmt(current)}</span>.
      </p>

      {applied ? (
        <p className="text-xs text-settled">Applied to every day you work.</p>
      ) : same ? (
        <p className="text-xs text-ink-muted">
          That already matches what you have — nothing to change.
        </p>
      ) : !suggestion.confident ? (
        <p className="text-xs text-ink-muted">
          Not enough history to act on yet. Keep logging.
        </p>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="quiet"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await applySuggestedSharpHours();
                if (res.ok) {
                  setApplied(true);
                  setErrors([]);
                  router.refresh();
                } else {
                  setErrors(res.errors);
                }
              })
            }
          >
            {pending ? "Applying…" : "Apply to my sharp hours"}
          </Button>
          <span className="text-xs text-ink-muted">
            Applies to every weekday you work; days off are left alone.
          </span>
        </div>
      )}

      {errors.length ? (
        <ul role="alert" className="list-disc pl-5 text-xs text-signal">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
