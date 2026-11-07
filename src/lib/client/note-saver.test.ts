// Note saving under slow, repeated, failed and overlapping saves. Controlled promises stand in for the network.
import { describe, expect, it } from "vitest";
import { NoteSaver, flushAll, type NoteSaveStatus } from "./note-saver";

/** A fake server: each send waits until the test answers it, and records the order values arrived. */
function server() {
  const pending: { value: string; answer: (ok: boolean) => void }[] = [];
  const received: string[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  const send = (value: string) => new Promise<boolean>((resolve) => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    pending.push({ value, answer: (ok) => { concurrent--; if (ok) received.push(value); resolve(ok); } });
  });
  return { send, pending, received, get maxConcurrent() { return maxConcurrent; } };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("NoteSaver", () => {
  it("sends nothing when the text hasn't changed, ignoring surrounding spaces", async () => {
    const s = server();
    const saver = new NoteSaver(s.send, "Felt strong");
    saver.set("  Felt strong ");
    expect(saver.dirty).toBe(false);
    expect(await saver.flush()).toBe(true);
    expect(s.pending).toHaveLength(0);
  });

  it("text typed during a slow save is saved after it: never dropped, never reported saved early", async () => {
    const s = server();
    const statuses: NoteSaveStatus[] = [];
    const saver = new NoteSaver(s.send, null, (st) => statuses.push(st));
    saver.set("A");
    const first = saver.flush(); // blur
    await tick();
    saver.set("AB"); // still typing while A is on its way
    const second = saver.flush(); // blur again, or Done
    await tick();
    expect(s.pending).toHaveLength(1); // B isn't sent alongside A
    s.pending[0].answer(true);
    await tick();
    expect(statuses.at(-1)).toBe("saving"); // not "Saved": AB is still unsaved
    expect(s.pending).toHaveLength(2);
    expect(s.pending[1].value).toBe("AB");
    s.pending[1].answer(true);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(s.received).toEqual(["A", "AB"]); // the server got them in order, the newest last
    expect(saver.savedValue).toBe("AB");
    expect(statuses.at(-1)).toBe("saved");
    expect(s.maxConcurrent).toBe(1);
  });

  it("a blur and a click on Done at the same moment send one request", async () => {
    const s = server();
    const saver = new NoteSaver(s.send, null);
    saver.set("Elbows tucked");
    const a = saver.flush();
    const b = saver.flush();
    await tick();
    expect(s.pending).toHaveLength(1);
    s.pending[0].answer(true);
    expect([await a, await b]).toEqual([true, true]);
    expect(s.received).toEqual(["Elbows tucked"]);
  });

  it("a failed save is reported, stays unsaved, and a later attempt saves it", async () => {
    const s = server();
    const statuses: NoteSaveStatus[] = [];
    const saver = new NoteSaver(s.send, "old", (st) => statuses.push(st));
    saver.set("new");
    const failed = saver.flush();
    await tick();
    s.pending[0].answer(false);
    expect(await failed).toBe(false);
    expect(statuses.at(-1)).toBe("failed");
    expect(saver.dirty).toBe(true); // a finish must not go ahead as if saved
    expect(saver.savedValue).toBe("old");
    const retry = saver.flush();
    await tick();
    s.pending[1].answer(true);
    expect(await retry).toBe(true);
    expect(saver.savedValue).toBe("new");
    expect(statuses.at(-1)).toBe("saved");
  });

  it("a send that throws counts as a failure, not a crash", async () => {
    const saver = new NoteSaver(() => Promise.reject(new Error("offline")), null);
    saver.set("x");
    expect(await saver.flush()).toBe(false);
    expect(saver.dirty).toBe(true);
  });

  it("clearing a note saves it as empty", async () => {
    const s = server();
    const saver = new NoteSaver(s.send, "something");
    saver.set("   ");
    const done = saver.flush();
    await tick();
    expect(s.pending[0].value).toBe("");
    s.pending[0].answer(true);
    expect(await done).toBe(true);
  });

  it("is dirty while a save is on its way, so leaving the page can warn", async () => {
    const s = server();
    const saver = new NoteSaver(s.send, null);
    saver.set("x");
    const p = saver.flush();
    await tick();
    saver.set(""); // back to what's saved, but a request is still out
    expect(saver.dirty).toBe(true);
    s.pending[0].answer(true);
    await tick();
    s.pending[1]?.answer(true); // the latest text, empty, follows
    await p;
    expect(saver.dirty).toBe(false);
    expect(s.received).toEqual(["x", ""]);
  });
});

describe("flushAll, before finishing a workout", () => {
  it("waits for every note, including one on its way, and says if any failed", async () => {
    const s1 = server();
    const s2 = server();
    const exercise = new NoteSaver(s1.send, null);
    const workout = new NoteSaver(s2.send, null);
    exercise.set("hard last set");
    void exercise.flush(); // a blur's save, still on its way
    workout.set("busy gym");
    let settled = false;
    const all = flushAll([exercise, workout]).then((ok) => { settled = true; return ok; });
    await tick();
    expect(settled).toBe(false); // Finish must wait
    s2.pending[0].answer(true);
    await tick();
    expect(settled).toBe(false);
    s1.pending[0].answer(false);
    expect(await all).toBe(false); // so Finish stops, and says a note wasn't saved
  });

  it("is true once everything is saved, and true with nothing to save", async () => {
    const s = server();
    const n = new NoteSaver(s.send, null);
    expect(await flushAll([])).toBe(true);
    n.set("ok");
    const all = flushAll([n]);
    await tick();
    s.pending[0].answer(true);
    expect(await all).toBe(true);
  });
});
