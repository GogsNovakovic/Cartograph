// npm run analyse -- <github-url> --org <organization-id>
// npm run analyse -- --rerun <analysis-id>
//
// The same run the app will start, from a terminal. A URL that has been
// analysed before reports the existing analysis and stops; re-running it is
// the separate, deliberate --rerun.

import { tracing } from "../env.ts";
import { runAnalysis, startAnalysis, type RunResult } from "./run.ts";

function report(analysisId: string, result: RunResult): number {
  if (!result.ok) {
    console.error(`analysis ${analysisId} failed${result.stage ? ` while ${result.stage}` : ""}: ${result.message}`);
    return 1;
  }
  const { files, edges, roles, routes } = result.stored;
  console.log(`analysis ${analysisId} complete`);
  console.log(`commit    ${result.commitSha}`);
  console.log(`stored    ${files} files, ${edges} edges, ${roles} convention roles, ${routes} routes`);
  const c = result.classification;
  console.log(
    c.ok
      ? `roles     ${c.suggested.length} suggested, ${c.none.length} with no role that fits, ${c.unanswered.length} unanswered`
      : `roles     none suggested: ${c.message}`,
  );
  console.log(tracing.on ? `traced    LangSmith project ${tracing.project}` : `traced    no: ${tracing.reason}`);
  return 0;
}

function usage(): number {
  console.error("usage: npm run analyse -- <github-url> --org <organization-id>\n       npm run analyse -- --rerun <analysis-id>");
  return 2;
}

async function main(args: string[]): Promise<number> {
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : (args[i + 1] ?? null);
  };

  const rerun = flag("--rerun");
  if (rerun !== undefined) {
    if (!rerun) return usage();
    return report(rerun, await runAnalysis(rerun));
  }

  const organizationId = flag("--org");
  const url = args.find((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--org");
  if (!organizationId || !url) return usage();

  const started = await startAnalysis(organizationId, url);
  if (!started.ok) {
    console.error(started.message);
    return 1;
  }
  if (!started.created) {
    console.log(`already analysed: ${started.analysisId}. Use --rerun ${started.analysisId} to run it again.`);
    return 0;
  }
  console.log(`analysis ${started.analysisId} created, running`);
  return report(started.analysisId, await runAnalysis(started.analysisId));
}

process.exitCode = await main(process.argv.slice(2));
