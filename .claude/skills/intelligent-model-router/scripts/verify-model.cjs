#!/usr/bin/env node
// Which model a finished subagent actually ran on, from its transcript. Best effort: the transcript's format isn't
// a documented interface, so if it changes this reports "unverified" rather than guessing. /tasks is the documented
// way to see this while a subagent runs.
//   node verify-model.cjs <path to the subagent's .jsonl transcript>
"use strict";
const fs = require("node:fs");

/** The distinct models named by assistant turns, ignoring lines it can't read. */
function modelsInTranscript(text) {
  const models = new Set();
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const model = entry.type === "assistant" ? entry.message?.model : undefined;
      if (typeof model === "string" && model && !model.startsWith("<")) models.add(model);
    } catch {
      // A partial line says nothing about the model.
    }
  }
  return [...models];
}

function report(models) {
  if (!models.length) return "unverified: the transcript names no model";
  return models.length === 1 ? `verified from the transcript: ${models[0]}` : `verified from the transcript, and it changed during the run: ${models.join(", ")}`;
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: verify-model.cjs <transcript.jsonl>");
    process.exit(2);
  }
  try {
    console.log(report(modelsInTranscript(fs.readFileSync(file, "utf8"))));
  } catch (err) {
    console.log(`unverified: the transcript can't be read (${err.code ?? "error"})`);
  }
}

module.exports = { modelsInTranscript, report };
