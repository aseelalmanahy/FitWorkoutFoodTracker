"use client";

import { useEffect, useState } from "react";
import { Button, Card, SectionTitle } from "@/components/ui";

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Phase 1: how to put the app on the home screen, for the browser being used. Shown on the profile page. */
export function InstallHelp() {
  const [kind, setKind] = useState<"installed" | "ios" | "android" | "other">("other");
  const [prompt, setPrompt] = useState<PromptEvent | null>(null);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    const ua = navigator.userAgent;
    setKind(standalone ? "installed" : /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "ios" : /Android/.test(ua) ? "android" : "other");
    const keep = (e: Event) => { e.preventDefault(); setPrompt(e as PromptEvent); };
    window.addEventListener("beforeinstallprompt", keep);
    return () => window.removeEventListener("beforeinstallprompt", keep);
  }, []);
  if (kind === "installed") return null;
  return (
    <section className="my-6" data-testid="install-help">
      <SectionTitle>Install the app</SectionTitle>
      <Card className="space-y-2 p-4 text-sm">
        {kind === "ios" && <p>In <strong>Safari</strong>, tap the <strong>Share</strong> button, then <strong>Add to Home Screen</strong>. Open it from the new icon and sign in once there.</p>}
        {kind === "android" && <p>In <strong>Chrome</strong>, open the <strong>⋮</strong> menu and choose <strong>Install app</strong> (or <strong>Add to Home screen</strong>).</p>}
        {kind === "other" && <p>On a phone: in Safari on iPhone, <strong>Share → Add to Home Screen</strong>; in Chrome on Android, <strong>⋮ → Install app</strong>. On a computer, look for the install icon in the address bar.</p>}
        {prompt && <Button size="sm" onClick={async () => { await prompt.prompt(); setPrompt(null); }} data-testid="install-button">Install now</Button>}
        <p className="text-muted">It opens full screen like an app. It still needs a connection: nothing is kept on the phone except the app&apos;s own files.</p>
      </Card>
    </section>
  );
}
