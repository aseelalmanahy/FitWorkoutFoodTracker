// RC-02: preloaded (`node -r`) into every process the scripts start, so it ends when the script that started it ends,
// however that script ends. On Windows a script that is force-ended (Stop-Process, Task Manager, closing its window)
// runs none of its exit or signal handlers, and Windows doesn't end its children with it: an app left behind kept
// holding its port. The parent gives each child a pipe as its standard input and sets FIT_EXIT_WITH_PARENT=1; the
// operating system closes that pipe when the parent ends, for any reason, so the child sees it close and exits.
// Unlike watching the parent's process id, this can't be fooled when Windows reuses that id.
// The watch never keeps a process alive by itself (unref), so a child that finishes its work still exits normally.
"use strict";
const watch = process.env.FIT_EXIT_WITH_PARENT === "1";
// Only this process watches its pipe. A process it starts in turn inherits neither the setting nor, unless given one,
// a pipe: with the setting and no pipe it would see its input closed at once and exit.
delete process.env.FIT_EXIT_WITH_PARENT;
if (watch) {
  const end = () => process.exit(0);
  const stdin = process.stdin;
  stdin.on("end", end);
  stdin.on("close", end);
  stdin.on("error", end);
  stdin.on("data", () => { /* nothing is ever sent; reading is what notices the pipe closing */ });
  stdin.resume();
  if (typeof stdin.unref === "function") stdin.unref();
}
