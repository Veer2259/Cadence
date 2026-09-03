/** A plain marker for screens whose behaviour arrives in a later build phase. */
export function PhaseNotice({
  title,
  phase,
  children,
}: {
  title: string;
  phase: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h1 className="text-[30px] leading-none font-extrabold tracking-[-0.03em] text-ink">{title}</h1>
      <div className="mt-4 rounded-[18px] bg-surface p-4 shadow-card">
        <p className="text-sm text-ink">{children}</p>
        <p className="mt-2 text-xs text-ink-muted">Arrives in {phase}.</p>
      </div>
    </section>
  );
}
