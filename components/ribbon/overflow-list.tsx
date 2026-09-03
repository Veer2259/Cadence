export type OverflowView = {
  id: string;
  title: string;
  reason: string;
  action: "defer" | "shrink" | "delegate" | "drop";
  suggestion: string;
};

/**
 * "This doesn't fit today" — the app saying no, out loud (SPEC §1, principle 2).
 * Renders nothing when everything fits.
 */

const ACTION_LABEL: Record<OverflowView["action"], string> = {
  defer: "Move",
  shrink: "Shrink",
  delegate: "Delegate",
  drop: "Drop",
};

export function OverflowList({ items }: { items: OverflowView[] }) {
  if (!items.length) return null;

  const n = items.length;
  const heading =
    n === 1 ? "One thing won't fit" : n === 2 ? "Two things won't fit" : `${n} things won't fit`;

  return (
    <section className="rounded-[20px] border border-warn-line bg-warn-tint p-4">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-warn text-[13px] font-extrabold text-white"
        >
          !
        </span>
        <h2 className="text-[15px] font-extrabold tracking-[-0.02em] text-ink">
          {heading}
        </h2>
      </div>

      <ul className="mt-3 flex flex-col gap-3.5">
        {items.map((o) => (
          <li key={o.id}>
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-ink">
                {o.title}
              </span>
              <span className="shrink-0 rounded-full bg-surface px-2.5 py-1 text-[10px] font-extrabold tracking-[0.08em] text-warn uppercase">
                {ACTION_LABEL[o.action]}
              </span>
            </div>
            <p className="mt-1 text-[12.5px] leading-[1.45] font-medium" style={{ color: "#7A6A5C" }}>
              {o.reason}
            </p>
            <p className="mt-2 inline-flex min-h-[38px] items-center rounded-full bg-ink px-4 text-[12.5px] font-bold text-paper">
              {o.suggestion}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
