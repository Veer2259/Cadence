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
    <header className="border-b border-rule bg-surface">
      <nav className="mx-auto flex max-w-3xl items-center gap-1 px-4">
        <Link
          href="/today"
          className="mr-3 py-3 font-mono text-sm tracking-tight text-ink"
        >
          Cadence
        </Link>

        <ul className="flex flex-1 items-center gap-1">
          {LINKS.map((link) => {
            const active =
              pathname === link.href || pathname.startsWith(link.href + "/");
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-block border-b-2 px-2 py-3 text-sm",
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

        <form action={logout}>
          <button
            type="submit"
            className="py-3 text-sm text-ink-muted hover:text-ink"
          >
            Log out
          </button>
        </form>
      </nav>
    </header>
  );
}
