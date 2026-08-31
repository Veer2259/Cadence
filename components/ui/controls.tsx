/** Shared form-control styling so every screen looks like the same instrument. */
import { cn } from "@/lib/cn";

export const fieldCls =
  "border border-rule bg-surface px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink disabled:opacity-60";

export const RADIUS = { borderRadius: "var(--radius)" } as const;

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return <input {...rest} className={cn(fieldCls, className)} style={{ ...RADIUS, ...props.style }} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, ...rest } = props;
  return (
    <select {...rest} className={cn(fieldCls, "pr-7", className)} style={{ ...RADIUS, ...props.style }} />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props;
  return (
    <textarea {...rest} className={cn(fieldCls, "min-h-[4rem] resize-y", className)} style={{ ...RADIUS, ...props.style }} />
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "solid" | "quiet" | "danger";
};

export function Button({ variant = "solid", className, ...rest }: ButtonProps) {
  const styles = {
    solid: "bg-ink text-paper hover:opacity-90",
    quiet: "border border-rule bg-surface text-ink hover:border-ink",
    danger: "border border-rule bg-surface text-signal hover:border-signal",
  }[variant];
  return (
    <button
      {...rest}
      className={cn(
        "px-3 py-1.5 text-sm font-medium disabled:opacity-60",
        styles,
        className,
      )}
      style={{ ...RADIUS, ...rest.style }}
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
    <label className="flex flex-col gap-1">
      <span className="text-xs text-ink-muted">{label}</span>
      {children}
      {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
    </label>
  );
}
