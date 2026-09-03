/**
 * Shared form controls.
 *
 * Daylight direction: every button, chip and badge is a pill; inputs sit on
 * --color-tint with a 14px radius and no border. Primary actions are 46–52px
 * tall, everything tappable is at least 42px.
 */
import { cn } from "@/lib/cn";

export const fieldCls =
  "bg-tint px-3.5 py-2.5 text-sm font-medium text-ink placeholder:text-ink-faint " +
  "outline-none focus:bg-surface focus:ring-2 focus:ring-primary/40 disabled:opacity-60";

/** Legacy inline-style escape hatch. New code should use `rounded-*` utilities. */
export const RADIUS = { borderRadius: "var(--radius)" } as const;

const INPUT_RADIUS = { borderRadius: "var(--radius-input)" } as const;

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, style, ...rest } = props;
  return <input {...rest} className={cn(fieldCls, className)} style={{ ...INPUT_RADIUS, ...style }} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, style, ...rest } = props;
  return (
    <select {...rest} className={cn(fieldCls, "pr-8", className)} style={{ ...INPUT_RADIUS, ...style }} />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, style, ...rest } = props;
  return (
    <textarea
      {...rest}
      className={cn(fieldCls, "min-h-[4rem] resize-y leading-relaxed", className)}
      style={{ ...INPUT_RADIUS, ...style }}
    />
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "dark" | "quiet" | "danger" | "solid";
  /** Full-height primary action (50px) rather than the default 42px tap target. */
  size?: "md" | "lg";
};

const VARIANTS = {
  /** Emerald — the one action the screen is asking for. */
  primary: "bg-primary text-white hover:bg-primary-deep",
  /** Ink fill — confirmations and selected chips. */
  dark: "bg-ink text-paper hover:opacity-90",
  /** Tint fill — everything secondary. */
  quiet: "bg-tint text-ink-muted hover:text-ink",
  /** Destructive, and never colour alone: the label always says what it does. */
  danger: "bg-warn-tint text-warn hover:bg-warn-line",
  /** Retired name kept so unmigrated screens keep compiling. Same as `dark`. */
  solid: "bg-ink text-paper hover:opacity-90",
} as const;

export function Button({ variant = "primary", size = "md", className, style, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 px-4 text-sm font-extrabold",
        "transition-opacity disabled:opacity-60",
        size === "lg" ? "min-h-[50px]" : "min-h-[42px]",
        VARIANTS[variant],
        className,
      )}
      style={{ borderRadius: "var(--radius-pill)", ...style }}
    />
  );
}

/** A small pill: filter chips, status chips, action tags. */
export function Chip({
  selected = false,
  className,
  style,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      {...rest}
      aria-pressed={selected}
      className={cn(
        "inline-flex min-h-[34px] items-center justify-center px-3.5 text-xs font-bold whitespace-nowrap",
        selected ? "bg-ink text-paper" : "bg-tint text-ink-soft hover:text-ink",
        className,
      )}
      style={{ borderRadius: "var(--radius-pill)", ...style }}
    />
  );
}

/** The 10–12px uppercase tracked label above a section or metric. */
export function Eyebrow({
  className,
  ...rest
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      {...rest}
      className={cn(
        "text-[11px] font-extrabold tracking-[0.12em] text-ink-soft uppercase",
        className,
      )}
    />
  );
}

export function Labeled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-bold text-ink-soft">{label}</span>
      {children}
      {hint ? <span className="text-xs font-medium text-ink-faint">{hint}</span> : null}
    </label>
  );
}
