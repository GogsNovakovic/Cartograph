// The parse, in a process of its own. Selecting and parsing are synchronous
// and can take minutes on a large repository; run inside the server they
// would hold up every other request until they finished. Started by the
// pipeline with fork(), and it reports over the IPC channel:
//
//   { selected: n }     the walk is done and found n source files
//   { error: message }  something threw; the process then exits 1
//
// Exits 3, having parsed nothing, when the walk finds more source files than
// the limit it was given. Otherwise writes the result to the file it was
// given and exits 0. Imports the parser and nothing else.

import { writeFileSync } from "node:fs";
import { parseSelection, selectFiles } from "../../parser/index.ts";

export type ChildMessage = { selected: number } | { error: string };

function send(message: ChildMessage): Promise<void> {
  return new Promise((resolve) => {
    if (process.send) process.send(message, () => resolve());
    else resolve();
  });
}

async function main([directory, outFile, maxFiles]: string[]): Promise<number> {
  const limit = Number(maxFiles);
  if (!directory || !outFile || !Number.isInteger(limit)) {
    await send({ error: "The parse process was started without a directory, an output file and a file limit." });
    return 1;
  }
  try {
    const selection = selectFiles(directory);
    const selected = selection.walk.files.length;
    await send({ selected });
    if (selected > limit) return 3;
    writeFileSync(outFile, JSON.stringify(parseSelection(selection)));
    return 0;
  } catch (error) {
    await send({ error: error instanceof Error ? error.message : String(error) });
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
// The IPC channel would otherwise keep the process alive.
process.disconnect?.();
