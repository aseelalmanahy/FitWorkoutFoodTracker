import { headers } from "next/headers";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaClient } from "@/components/pwa/pwa-client";

export const metadata: Metadata = {
  // Phase 1: the working product name in what browsers and home screens show. The in-app wordmark awaits branding.
  title: { default: "FitWorkoutFoodTracker", template: "%s · FitWorkoutFoodTracker" },
  applicationName: "FitWorkoutFoodTracker",
  description: "Plan, log and progress your training.",
  appleWebApp: { capable: true, title: "FitTracker", statusBarStyle: "default" },
  icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }], apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f4f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1217" },
  ],
};

// Apply a saved theme preference before paint to avoid a flash.
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // From middleware.ts. Reading a request header renders every page per request, as a nonce has to be fresh.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">
        <PwaClient register={process.env.NODE_ENV === "production"} />
        {children}
      </body>
    </html>
  );
}
