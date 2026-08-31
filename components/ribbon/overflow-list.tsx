export type OverflowView = {
  id: string;
  title: string;
  reason: string;
  action: "defer" | "shrink" | "delegate" | "drop";
  suggestion: string;
};

/** Rendered under the ribbon when work did not fit. SPEC section 9. */
export function OverflowList({ items }: { items: OverflowView[] }) {
  if (!items.length) return null;
  return (
    <section className="mt-6">
      <div className="h-px bg-rule" />
      <h2 className="judgment mt-4 text-lg text-signal">This doesn&rsquo;t fit today</h2>
      <ul className="mt-2 divide-y divide-rule">
        {items.map((o) => (
          <li key={o.id} className="py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-ink">{o.title}</span>
              <span className="shrink-0 text-[11px] tracking-wide text-caution uppercase">
                {o.action}
              </span>
            </div>
            <p className="judgment text-xs text-ink-muted">{o.reason}</p>
            <p className="mt-0.5 text-xs text-ink-muted">→ {o.suggestion}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
