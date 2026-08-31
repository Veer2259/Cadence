"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/controls";

export function InboxControls({
  buckets,
  bucket,
  sort,
}: {
  buckets: { id: string; name: string }[];
  bucket: string | null;
  sort: "due" | "created";
}) {
  const router = useRouter();

  function apply(next: { bucket?: string | null; sort?: string }) {
    const params = new URLSearchParams();
    const b = next.bucket === undefined ? bucket : next.bucket;
    const s = next.sort ?? sort;
    if (b) params.set("bucket", b);
    if (s && s !== "due") params.set("sort", s);
    const qs = params.toString();
    router.replace(qs ? `/inbox?${qs}` : "/inbox");
  }

  return (
    <div className="flex items-center gap-2 text-xs text-ink-muted">
      <label className="flex items-center gap-1.5">
        bucket
        <Select
          value={bucket ?? ""}
          onChange={(e) => apply({ bucket: e.target.value || null })}
        >
          <option value="">all</option>
          {buckets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex items-center gap-1.5">
        sort
        <Select value={sort} onChange={(e) => apply({ sort: e.target.value })}>
          <option value="due">by due date</option>
          <option value="created">newest first</option>
        </Select>
      </label>
    </div>
  );
}
