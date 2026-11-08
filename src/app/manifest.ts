import type { MetadataRoute } from "next";

/** Phase 1: what a phone needs to install the app. The icons are temporary until the owner approves branding. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "FitWorkoutFoodTracker",
    short_name: "FitTracker",
    description: "Plan and log your training and nutrition.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f2f4f7",
    theme_color: "#4a6a90",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
