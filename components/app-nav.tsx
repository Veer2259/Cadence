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

/** Header height — kept in sync with the spacer padding in (app)/layout.tsx. */
export const NAV_HEIGHT_CLASS = "h-12";

export function AppNav() {
  const pathname = usePathname();

  return (
    // role="banner" instead of <header> so a browser extension's `header {…}`
    // reset can't strip the background. Opaque fill set three ways (class,
    // inline var, inline fallback) so it always covers the content behind it.
    <div
      role="banner"
      className={cn(
        "fixed inset-x-0 top-0 z-[100] border-b border-rule bg-surface",
        NAV_HEIGHT_CLASS,
      )}
      style={{ backgroundColor: "var(--color-surface, #ffffff)" }}
    >
      <nav className="mx-auto flex h-full max-w-3xl items-stretch px-3 sm:px-4">
        <Link
          href="/today"
          className="mr-2 flex shrink-0 items-center font-mono text-sm tracking-tight text-ink sm:mr-3"
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
                    "flex h-full items-center border-b-2 px-1 text-[13px] sm:px-2 sm:text-sm",
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
            className="text-[13px] text-ink-muted hover:text-ink sm:text-sm"
          >
            Log out
          </button>
        </form>
      </nav>
    </div>
  );
}
