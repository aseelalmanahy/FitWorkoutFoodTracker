// UI-10: the workout logger opens in "One exercise" view until a view is chosen. Suites written for the complete
// logger choose "Full workout", as a person would, before any page loads. It's only a stored preference: nothing else.
async function preferFullWorkout(context) {
  await context.addInitScript(() => { try { if (!localStorage.getItem("fit.loggerView")) localStorage.setItem("fit.loggerView", "full"); } catch { /* no storage */ } });
  return context;
}
module.exports = { preferFullWorkout };
