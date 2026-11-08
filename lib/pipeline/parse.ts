import { fork } from "node:child_process";
import path from "node:path";
import { readParseResult } from "../../parser/read.ts";
import type { ParseResult } from "../../parser/types.ts";
import type { ChildMessage } from "./parse-child.ts";

// Past these a repository is refused rather than mapped: more source files
// than this is beyond what the map can show anyone, and a parse running
// longer than this has most likely stalled.
export const MAX_SOURCE_FILES = 20_000;
export const PARSE_TIMEOUT_MS = 10 * 60 * 1000;

// Run from source at run time, from the project root both `next` and the
// terminal scripts start in; nothing here for the build to trace.
const CHILD = path.join(/*turbopackIgnore: true*/ process.cwd(), "lib", "pipeline", "parse-child.ts");

function isChildMessage(value: unknown): value is ChildMessage {
  if (typeof value !== "object" || value === null) return false;
  if ("selected" in value) return typeof value.selected === "number";
  return "error" in value && typeof value.error === "string";
}

// Selects and parses `directory` in a child process and reads the result
// back through the parser's own reader, so what crosses the process boundary
// is checked field by field rather than trusted. `onSelected` runs once the
// walk has counted the files, and the result waits for it, so the stage it
// records always lands before whatever the caller writes next.
export function parseInChild(
  directory: string,
  outFile: string,
  onSelected: (files: number) => Promise<void>,
): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    // No inherited flags: the server's or a script's own options mean nothing
    // to the parse.
    const child = fork(CHILD, [directory, outFile, String(MAX_SOURCE_FILES)], {
      execArgv: [],
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    let selected: number | null = null;
    let reported: string | null = null;
    let entered: Promise<void> = Promise.resolve();
    let settled = false;

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const timer = setTimeout(
      () => fail(new Error(`Parsing took longer than ${PARSE_TIMEOUT_MS / 60_000} minutes, so it was stopped.`)),
      PARSE_TIMEOUT_MS,
    );

    child.on("message", (message: unknown) => {
      if (!isChildMessage(message)) return;
      if ("error" in message) {
        reported = message.error;
        return;
      }
      selected = message.selected;
      if (selected <= MAX_SOURCE_FILES) entered = onSelected(selected).catch(fail);
    });
    child.on("error", fail);
    child.on("exit", (code, signal) => {
      if (settled) return;
      if (code === 0) {
        void entered.then(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            resolve(readParseResult(outFile));
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
        return;
      }
      if (code === 3) {
        fail(new Error(`The repository has ${selected} source files, more than the ${MAX_SOURCE_FILES.toLocaleString("en")} Cartograph maps.`));
        return;
      }
      fail(new Error(reported ?? `The parse process stopped (${signal ?? `exit code ${code}`}) without saying why.`));
    });
  });
}
