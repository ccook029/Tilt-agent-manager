import type { MetadataRoute } from "next";

// Makes HQ an installable app ("Add to Home Screen") — full-screen, Tilt icon,
// its own window. Required for Web Push on installed PWAs.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tilt HQ",
    short_name: "Tilt HQ",
    description: "Tilt Hockey's internal operations — talk to your team, get alerts.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
