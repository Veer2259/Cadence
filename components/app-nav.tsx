"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { logout } from "@/app/(app)/actions";

const LINKS = [
  { href: "/today", label: "Today" },
  { href: "/inbox", label: "Inbox" },
  { href: "/goals", label: "Goals" },
  { href: "/week", label: "Week" },
  { href: "/review", label: "Review" },
  { href: "/settings", label: "Settings" },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    // Sticky so the nav stays on screen as the page scrolls. It is opaque
    // (inline bg guards against an aggressive `header {}` reset) and sits at
    // z-40; <main> is `isolate`, so the ribbon's own z-indexes stay in their
    // own stacking context strictly below this bar.
    <div
      role="banner"
      className="border-b border-rule bg-surface"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        backgroundColor: "var(--color-surface, #ffffff)",
      }}
    >
      <nav className="mx-auto flex max-w-3xl items-stretch px-3 sm:px-4">
        <Link
          href="/today"
          className="mr-2 flex shrink-0 items-center py-3 font-mono text-sm tracking-tight text-ink sm:mr-3"
        >
          Cadence
        </Link>

        {/* tight enough to fit ~360px; scrolls sideways only as a last resort */}
        <ul className="flex min-w-0 flex-1 items-stretch gap-0 overflow-x-auto sm:gap-1">
          {LINKS.map((link) => {
            const active =
              pathname === link.href || pathname.startsWith(link.href + "/");
            return (
              <li key={link.href} className="shrink-0">
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-full items-center border-b-2 px-1 py-3 text-[13px] sm:px-2 sm:text-sm",
                    active
                      ? "border-ink text-ink"
                      : "border-transparent text-ink-muted hover:text-ink",
                  )}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <form action={logout} className="flex shrink-0 items-center pl-2">
          <button
            type="submit"
            className="py-3 text-[13px] text-ink-muted hover:text-ink sm:text-sm"
          >
            Log out
          </button>
        </form>
      </nav>
    </div>
  );
}
