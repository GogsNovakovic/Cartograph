// npm run agent:credential -- <analysis-id> --org <organization-id>
//
// Prints a credential for one analysis, to call the agent's lookups from a
// terminal before anything in the app mints one. It proves nothing about who
// is asking; the database still decides what the credential can read, and a
// wrong organization reads as no analysis at all.

import { CREDENTIAL_TTL_SECONDS, mintCredential } from "./credential.ts";

function main(args: string[]): number {
  const orgAt = args.indexOf("--org");
  const organizationId = orgAt === -1 ? undefined : args[orgAt + 1];
  const analysisId = args.find((arg, i) => !arg.startsWith("--") && i !== orgAt + 1);
  if (!analysisId || !organizationId) {
    console.error("usage: npm run agent:credential -- <analysis-id> --org <organization-id>");
    return 2;
  }
  const minted = mintCredential({ analysisId, organizationId });
  if (!minted.ok) {
    console.error(minted.message);
    return 1;
  }
  console.log(minted.token);
  console.error(`valid for ${CREDENTIAL_TTL_SECONDS / 60} minutes`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
