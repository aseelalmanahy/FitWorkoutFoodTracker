import "server-only";

/**
 * Account email work happens after the response, so its timing can't reveal whether an address has an account.
 * One job at a time, which also means two requests for one address can't normally both pass its cooldown. A job past
 * its deadline is left running, and stops at its next check of the signal, so one stuck in the database for that long
 * could overlap the next. This assumes one long-lived server process, like the throttles. Overlap or a second instance
 * could send extra email, and couldn't weaken a token. Waiting jobs are lost on a restart, and the person just asks again.
 */
const MAX_WAITING = 500;
export const JOB_DEADLINE_MS = 30_000;

type Job = (signal: AbortSignal) => Promise<void>;
const waiting: { name: string; job: Job }[] = [];
let running: Promise<void> | null = null;

/** Fixed codes only. An error's text can hold an address or a token, so it's never logged. */
export function logAccountMail(name: string, code: string): void {
  console.warn(`[account-mail] ${name}: ${code}`);
}

/** Past its deadline a job is left behind, so that one hung provider call can't stop everyone else's email. */
async function runWithDeadline({ name, job }: { name: string; job: Job }): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"deadline">((resolve) => {
    timer = setTimeout(() => resolve("deadline"), JOB_DEADLINE_MS);
  });
  try {
    const finished = job(controller.signal).then(() => "done" as const);
    // If it fails after its deadline, nothing is waiting for it any more.
    finished.catch(() => {});
    if ((await Promise.race([finished, deadline])) === "deadline") {
      controller.abort();
      logAccountMail(name, "deadline-passed");
    }
  } catch {
    logAccountMail(name, "failed");
  } finally {
    clearTimeout(timer);
  }
}

async function drain(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve)); // the response goes first
  for (let next = waiting.shift(); next; next = waiting.shift()) await runWithDeadline(next);
  running = null;
}

export function enqueueAccountJob(name: string, job: Job): void {
  if (waiting.length >= MAX_WAITING) {
    logAccountMail(name, "queue-full");
    return;
  }
  waiting.push({ name, job });
  running ??= drain();
}

/** Test hooks. */
export const _accountJobsIdle = async () => { while (running) await running; };
export const _accountJobsWaiting = () => waiting.length;
