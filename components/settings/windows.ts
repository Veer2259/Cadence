/** Client-side helpers to move between "09:00-13:00, 14:00-20:00" text and tuples. */

export type Win = [string, string];

const HM = /^\d{2}:\d{2}$/;

export function textToWindows(text: string): { windows: Win[]; error: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { windows: [], error: null };

  const parts = trimmed.split(",").map((p) => p.trim()).filter(Boolean);
  const windows: Win[] = [];
  for (const part of parts) {
    const m = part.split("-").map((s) => s.trim());
    if (m.length !== 2 || !HM.test(m[0]) || !HM.test(m[1])) {
      return { windows: [], error: `"${part}" is not a HH:MM-HH:MM range` };
    }
    if (m[1] <= m[0]) {
      return { windows: [], error: `"${part}" must end after it starts` };
    }
    windows.push([m[0], m[1]]);
  }
  return { windows, error: null };
}

export function windowsToText(windows: Win[] | undefined): string {
  return (windows ?? []).map(([a, b]) => `${a}-${b}`).join(", ");
}
