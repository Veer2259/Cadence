"use client";

import { useRouter } from "next/navigation";
import { Chip } from "@/components/ui/controls";

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
    <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
      <Chip selected={!bucket} onClick={() => apply({ bucket: null })}>
        All
      </Chip>
      {buckets.map((b) => (
        <Chip
          key={b.id}
          selected={bucket === b.id}
          onClick={() => apply({ bucket: b.id })}
        >
          {b.name}
        </Chip>
      ))}
      <span aria-hidden className="w-px shrink-0" />
      <Chip
        selected={sort === "created"}
        onClick={() => apply({ sort: sort === "created" ? "due" : "created" })}
      >
        {sort === "created" ? "Newest first" : "By due date"}
      </Chip>
    </div>
  );
}
