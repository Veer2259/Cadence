import type { MetadataRoute } from "next";

/**
 * PWA manifest, served at /manifest.webmanifest by the Next file convention.
 *
 * `start_url` is /today rather than / — the root just redirects, and the point
 * of installing this is to land on the day. Everything behind /login is
 * gated, so an installed app that has lost its session still lands correctly.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cadence",
    short_name: "Cadence",
    description: "A day planner that can count.",
    start_url: "/today",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Both --color-paper. The app is a light surface, so the installed
    // status bar should be paper too — matching the <meta name="theme-color">
    // in the root layout rather than contradicting it.
    background_color: "#f7f7f4",
    theme_color: "#f7f7f4",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
