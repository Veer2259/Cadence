import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

/**
 * Manrope carries the whole interface. The Daylight direction retired the
 * three-face split (IBM Plex Sans / Mono / Newsreader) — 800 at tight tracking
 * does the work the mono face used to do for numerals, and Manrope's tabular
 * figures keep columns of times aligned.
 */
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Cadence",
  description: "A day planner that can count.",
  // PWA: /manifest.webmanifest comes from app/manifest.ts
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Cadence",
    // the status bar sits on --color-paper, so keep it light
    statusBarStyle: "default",
  },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#fdf8f0",
  width: "device-width",
  initialScale: 1,
  // installed on a phone, the ribbon must not sit under the notch
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} h-full`}
      suppressHydrationWarning
    >
      {/* Browser extensions add attributes to <body> before React hydrates;
          suppress the warning for this element only (not its children). */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
