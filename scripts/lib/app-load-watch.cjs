// RC-08: when one of the application's own scripts fails to load, the page never becomes interactive, and a test
// used to find out only 30 s later, as a timeout on whatever it waited for next. This records each such failure as it
// happens, so a step can fail at once and say which script failed and how.
"use strict";

// A navigation cancels the previous page's loads; those aren't failures of the page being tested.
const CANCELLED = /ERR_ABORTED|NS_BINDING_ABORTED|NS_ERROR_ABORT|cancelled/i;

/**
 * Watches a page for scripts from `appOrigin` that fail to load: a network failure (for example the browser can't
 * reach its proxy) or an error status (for example the proxy answering 502). Other origins aren't watched.
 */
function watchAppScripts(page, appOrigin) {
  const origin = new URL(appOrigin).origin;
  const failures = [];
  const own = (request) => request.resourceType() === "script" && new URL(request.url()).origin === origin;
  // Firefox can report one failed load twice; each script and reason is listed once.
  const add = (entry) => { if (!failures.includes(entry)) failures.push(entry); };
  page.on("requestfailed", (request) => {
    if (!own(request)) return;
    const error = request.failure()?.errorText ?? "unknown error";
    if (!CANCELLED.test(error)) add(`${new URL(request.url()).pathname} ${error}`);
  });
  page.on("response", (response) => {
    if (own(response.request()) && response.status() >= 400) add(`${new URL(response.url()).pathname} HTTP ${response.status()}`);
  });
  return {
    failures,
    /** Throws, naming every failed script, if any has failed since the watch began or since the last clear. */
    assertNone(step) {
      if (failures.length) throw new Error(`${step}: the application's own script failed to load, so the page couldn't become interactive: ${failures.join("; ")}`);
    },
    clear() { failures.length = 0; },
  };
}

module.exports = { watchAppScripts };
