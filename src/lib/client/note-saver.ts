// Saving a free-text note safely while the person keeps typing, with no React, so it can be tested on its own.
//
// - One request at a time. A request is never sent while another for the same note is on its way, so the
//   server receives the versions in the order they were written, and an older one can't land last.
// - The latest text wins. Text typed while a save is on its way is saved straight after it.
// - A failure is reported, and the text stays unsaved until a later save succeeds. Nothing claims "Saved" for
//   text that wasn't sent.

export type NoteSaveStatus = "idle" | "saving" | "saved" | "failed";

const norm = (v: string) => v.trim();

export class NoteSaver {
  private saved: string;
  private wanted: string;
  private inFlight: Promise<boolean> | null = null;
  private lastFailed = false;

  /** `send` saves one value (already trimmed, "" meaning none) and says whether it was saved. It must not throw. */
  constructor(private readonly send: (value: string) => Promise<boolean>, saved: string | null, private readonly onStatus: (s: NoteSaveStatus) => void = () => {}) {
    this.saved = norm(saved ?? "");
    this.wanted = this.saved;
  }

  /** The person changed the text. Nothing is sent until the next flush. */
  set(value: string) {
    this.wanted = norm(value);
    if (!this.inFlight) this.onStatus(this.dirty ? "idle" : this.lastFailed ? "failed" : "saved");
  }

  /** There's text not yet saved, or a save on its way. */
  get dirty(): boolean {
    return this.inFlight !== null || this.wanted !== this.saved;
  }

  get savedValue(): string {
    return this.saved;
  }

  /**
   * Save until what's saved is the latest text, one request at a time. Resolves true once it is, or false if a
   * save failed. Callers at the same moment, such as a blur and a click on Done, share the same work.
   */
  flush(): Promise<boolean> {
    if (this.inFlight) return this.inFlight.then((ok) => (ok ? this.flush() : false));
    if (this.wanted === this.saved) {
      this.lastFailed = false;
      return Promise.resolve(true);
    }
    const value = this.wanted;
    this.onStatus("saving");
    this.inFlight = this.send(value).then(
      (ok) => ok,
      () => false,
    ).then((ok) => {
      this.inFlight = null;
      this.lastFailed = !ok;
      if (ok) this.saved = value;
      // Text typed meanwhile is still waiting: say so, rather than "Saved".
      this.onStatus(!ok ? "failed" : this.wanted === this.saved ? "saved" : "saving");
      return ok;
    });
    return this.inFlight.then((ok) => (ok ? this.flush() : false));
  }
}

/** Flush several notes, as before finishing a workout. True only if every one is saved. */
export async function flushAll(savers: Iterable<NoteSaver>): Promise<boolean> {
  const results = await Promise.all([...savers].map((s) => s.flush()));
  return results.every(Boolean);
}
