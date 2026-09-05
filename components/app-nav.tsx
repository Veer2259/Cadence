"use client";

/**
 * The bottom tab bar: Today · Inbox · (+) · Week · More.
 *
 * Was a sticky top nav listing all six routes, which overflowed at phone width.
 * Four of those routes now live behind More, and the centre + opens capture —
 * the one thing worth reaching for without navigating first.
 *
 * The 26px of bottom padding clears the home indicator on a modern iPhone.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/** Routes that More is the hub for — it reads as active on any of them. */
const MORE_ROUTES = ["/more", "/goals", "/review", "/settings", "/debrief"];

const TABS = [
  { href: "/today", label: "Today" },
  { href: "/inbox", label: "Inbox" },
] as const;

const TABS_RIGHT = [
  { href: "/week", label: "Week" },
  { href: "/more", label: "More" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/more") return MORE_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));
  return pathname === href || pathname.startsWith(href + "/");
}

function Tab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-[44px] flex-1 items-center justify-center rounded-full text-[12.5px]",
        active ? "bg-surface font-extrabold text-ink shadow-tab" : "font-semibold text-ink-soft",
      )}
    >
      {label}
    </Link>
  );
}

export function AppNav({ onCapture }: { onCapture: () => void }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="shrink-0 px-3.5 pt-1"
      style={{ paddingBottom: "calc(26px + env(safe-area-inset-bottom, 0px))" }}
    >
      <div className="flex items-stretch gap-1 rounded-full bg-tint p-1.5">
        {TABS.map((t) => (
          <Tab key={t.href} {...t} active={isActive(pathname, t.href)} />
        ))}

        <button
          type="button"
          onClick={onCapture}
          aria-label="Brain dump — opens Ask Cadence ready to capture"
          className="flex h-11 w-[52px] shrink-0 items-center justify-center rounded-full bg-primary text-[22px] leading-none text-white hover:bg-primary-deep"
        >
          <span aria-hidden>+</span>
        </button>

        {TABS_RIGHT.map((t) => (
          <Tab key={t.href} {...t} active={isActive(pathname, t.href)} />
        ))}
      </div>
    </nav>
  );
}

/**
 * The grabber above the tab bar. On a real device this should also respond to
 * an upward drag; for now it is a button, which is what a keyboard needs anyway.
 */
export function AssistantHandle({
  onOpen,
  unread,
}: {
  onOpen: () => void;
  unread: number;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-[34px] w-full shrink-0 items-center justify-center gap-2"
      aria-label="Ask Cadence"
    >
      <span aria-hidden className="block h-1 w-[30px] rounded-full" style={{ background: "#E2D9C8" }} />
      <span className="text-[11.5px] font-bold text-ink-soft">Ask Cadence</span>
      {unread > 0 ? (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-extrabold text-white">
          {unread}
        </span>
      ) : null}
    </button>
  );
}
