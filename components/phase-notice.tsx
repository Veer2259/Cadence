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
      <h1 className="font-mono text-lg tracking-tight text-ink">{title}</h1>
      <div className="mt-4 border border-rule bg-surface p-4" style={{ borderRadius: "var(--radius)" }}>
        <p className="text-sm text-ink">{children}</p>
        <p className="mt-2 text-xs text-ink-muted">Arrives in {phase}.</p>
      </div>
    </section>
  );
}
