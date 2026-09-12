// A row of hero numbers. Text wears text tokens; a tone class marks the
// verdict (primary = good for freecode, destructive = bad), never the series
// colour. A null value renders as "—" with its note, never as a zero.

export interface StatTile {
  value: string | null;
  label: string;
  note?: string;
  tone?: "text-primary" | "text-destructive" | "text-foreground";
}

export function StatTiles({ tiles }: { tiles: StatTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-8">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-md border border-border bg-card p-4 md:p-5">
          <dd
            className={`font-mono text-2xl md:text-3xl font-bold tracking-tight ${t.value === null ? "text-muted-foreground/50" : (t.tone ?? "text-foreground")}`}
          >
            {t.value ?? "—"}
          </dd>
          <dt className="mt-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
            {t.label}
          </dt>
          {t.note && (
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{t.note}</p>
          )}
        </div>
      ))}
    </dl>
  );
}

/** Section chrome shared by every block on /bench. */
export function BenchSection({
  id,
  index,
  title,
  lede,
  command,
  children,
}: {
  id: string;
  index: number;
  title: string;
  lede: string;
  /** How this number is produced — printed, because a number without its command is a claim. */
  command?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-border pt-12 pb-16">
      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground/60 mb-3">
        {String(index).padStart(2, "0")}
      </p>
      <h2 className="text-2xl md:text-3xl font-medium text-foreground tracking-tight">{title}</h2>
      <p className="text-base md:text-lg text-muted-foreground mt-3 max-w-2xl leading-relaxed">
        {lede}
      </p>
      {command && (
        <p className="mt-4 mb-8 font-mono text-xs text-muted-foreground">
          <span className="text-muted-foreground/50">produced by </span>
          <code className="rounded border border-border bg-muted px-1.5 py-0.5 text-foreground/80">
            {command}
          </code>
        </p>
      )}
      {!command && <div className="mb-8" />}
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-card/50 p-6 text-sm text-muted-foreground leading-relaxed">
      {children}
    </div>
  );
}
