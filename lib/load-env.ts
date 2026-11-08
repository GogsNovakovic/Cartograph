// Preloaded by every terminal script (`node --import ./lib/load-env.ts`), so
// a script sees the environment `next dev` sees: the same files, in Next's
// order of precedence. Loading never overrides a value that is already set,
// so the first file to name a variable wins and the shell beats them all,
// exactly as in Next. A missing file is skipped; a missing value is still
// reported by env.ts, by name.

import { existsSync } from "node:fs";

const FILES = [".env.development.local", ".env.local", ".env.development", ".env"];

for (const file of FILES) if (existsSync(file)) process.loadEnvFile(file);
