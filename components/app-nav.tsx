"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { logout } from "@/app/(app)/actions";

const LINKS = [
  { href: "/today", label: "Today" },
  { href: "/inbox", label: "Inbox" },
  { href: "/week", label: "Week" },
  { href: "/review", label: "Review" },
  { href: "/settings", label: "Settings" },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-surface">
      <nav className="mx-auto flex max-w-3xl items-center px-3 sm:px-4">
        <Link
          href="/today"
          className="mr-2 shrink-0 py-3 font-mono text-sm tracking-tight text-ink sm:mr-3"
        >
          Cadence
        </Link>

        {/* tight enough to fit ~360px; the strip scrolls sideways as a last
            resort rather than pushing "Log out" off the edge */}
        <ul className="flex min-w-0 flex-1 items-center gap-0 overflow-x-auto sm:gap-1">
          {LINKS.map((link) => {
            const active =
              pathname === link.href || pathname.startsWith(link.href + "/");
            return (
              <li key={link.href} className="shrink-0">
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-block border-b-2 px-1 py-3 text-[13px] sm:px-2 sm:text-sm",
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

        <form action={logout} className="shrink-0 pl-2">
          <button
            type="submit"
            className="py-3 text-[13px] text-ink-muted hover:text-ink sm:text-sm"
          >
            Log out
          </button>
        </form>
      </nav>
    </header>
  );
}
