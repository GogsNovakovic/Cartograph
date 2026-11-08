import { defineDeepAgent } from "managed-deepagents";
import { contextSchema, filesWithRole, neighbours, overview, routes, searchFiles, walk } from "./tools/cartograph.ts";

// The system prompt is instructions.md next to this file.
export const agent = defineDeepAgent({
  name: "cartograph",
  // An exact snapshot, as the app pins its own: an alias changes what answers
  // without anything here changing.
  model: "openai:gpt-5.5-2026-04-23",
  tools: [overview, searchFiles, filesWithRole, neighbours, walk, routes],
  contextSchema,
});
