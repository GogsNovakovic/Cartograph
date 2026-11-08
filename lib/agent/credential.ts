import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { agentSigningKey } from "../env.ts";

// The agent's credential: a short-lived token naming exactly one analysis and
// the organization it belongs to. It is a database token like a member's,
// signed with a key the project trusts, so every read made with it goes
// through the same policies, narrowed by the agent-scope policies to that
// one analysis. Nothing in this system holds a key that reads everything on
// the agent's behalf: the signing key reads nothing by itself, and each token
// it signs reads one analysis for five minutes.
//
// The agent never sees which analysis it's reading. The token travels in the
// agent's run context, which never reaches the model.

export type AgentScope = { analysisId: string; organizationId: string };

// Long enough for one answer's lookups; each message gets a fresh one.
export const CREDENTIAL_TTL_SECONDS = 5 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type SigningKey = { kid: string; privateKey: KeyObject; publicKey: KeyObject };

type KeyResult = { ok: true; key: SigningKey } | { ok: false; message: string };

function field(value: object, name: string): unknown {
  return Object.fromEntries(Object.entries(value))[name];
}

// Read once; a key that doesn't parse is reported the same way every time.
let loaded: KeyResult | undefined;

function signingKey(): KeyResult {
  if (loaded) return loaded;
  loaded = readKey();
  return loaded;
}

function readKey(): KeyResult {
  if (agentSigningKey === null) return { ok: false, message: "SUPABASE_AGENT_SIGNING_KEY isn't set." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(agentSigningKey);
  } catch {
    return { ok: false, message: "SUPABASE_AGENT_SIGNING_KEY isn't JSON. Paste the key `supabase gen signing-key` printed." };
  }
  // The CLI prints a one-key array; a bare key is accepted too.
  const jwk: unknown = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
  if (typeof jwk !== "object" || jwk === null) return { ok: false, message: "SUPABASE_AGENT_SIGNING_KEY isn't one key." };
  const [kid, d, x, y] = ["kid", "d", "x", "y"].map((name) => field(jwk, name));
  if (
    field(jwk, "kty") !== "EC" ||
    field(jwk, "crv") !== "P-256" ||
    typeof kid !== "string" ||
    typeof d !== "string" ||
    typeof x !== "string" ||
    typeof y !== "string"
  ) {
    return { ok: false, message: "SUPABASE_AGENT_SIGNING_KEY must be an ES256 private key with a kid." };
  }
  try {
    const privateKey = createPrivateKey({ key: { kty: "EC", crv: "P-256", d, x, y }, format: "jwk" });
    return { ok: true, key: { kid, privateKey, publicKey: createPublicKey(privateKey) } };
  } catch (error) {
    return { ok: false, message: `SUPABASE_AGENT_SIGNING_KEY couldn't be read: ${error instanceof Error ? error.message : String(error)}` };
  }
}

const base64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");

function decodeJson(part: string): unknown {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export type Minted = { ok: true; token: string; expiresAt: number } | { ok: false; message: string };

// The caller has already established that the asker may read this analysis;
// minting is not a check, it only writes down the answer.
export function mintCredential(scope: AgentScope, now = Date.now()): Minted {
  const key = signingKey();
  if (!key.ok) return key;
  if (!UUID.test(scope.analysisId)) return { ok: false, message: `${scope.analysisId} isn't an analysis id.` };
  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + CREDENTIAL_TTL_SECONDS;
  const header = { alg: "ES256", typ: "JWT", kid: key.key.kid };
  // `role` and `aud` are what the database expects of a signed-in token;
  // `o.id` is where the organization policies read the organization, as on a
  // member's token; `analysis_id` is what narrows it to one analysis.
  const payload = {
    sub: `agent:${scope.analysisId}`,
    role: "authenticated",
    aud: "authenticated",
    iat: issuedAt,
    exp: expiresAt,
    o: { id: scope.organizationId },
    analysis_id: scope.analysisId,
  };
  const signed = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = sign("sha256", Buffer.from(signed), { key: key.key.privateKey, dsaEncoding: "ieee-p1363" });
  return { ok: true, token: `${signed}.${base64url(signature)}`, expiresAt: expiresAt * 1000 };
}

export type Verified = { ok: true; scope: AgentScope } | { ok: false; message: string };

// Checked here as well as by the database, so a bad token is refused with a
// reason before any read, and the analysis it names is known to be the one
// it was signed for.
export function verifyCredential(token: string, now = Date.now()): Verified {
  const key = signingKey();
  if (!key.ok) return key;
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, message: "The credential isn't a token." };
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodeJson(headerPart);
  if (typeof header !== "object" || header === null || field(header, "alg") !== "ES256" || field(header, "kid") !== key.key.kid) {
    return { ok: false, message: "The credential wasn't signed with the agent key." };
  }
  const valid = verify(
    "sha256",
    Buffer.from(`${headerPart}.${payloadPart}`),
    { key: key.key.publicKey, dsaEncoding: "ieee-p1363" },
    Buffer.from(signaturePart, "base64url"),
  );
  if (!valid) return { ok: false, message: "The credential's signature doesn't match." };
  const payload = decodeJson(payloadPart);
  if (typeof payload !== "object" || payload === null) return { ok: false, message: "The credential has no claims." };
  const exp = field(payload, "exp");
  if (typeof exp !== "number" || exp * 1000 <= now) return { ok: false, message: "The credential has expired." };
  const analysisId = field(payload, "analysis_id");
  const organization = field(payload, "o");
  const organizationId = typeof organization === "object" && organization !== null ? field(organization, "id") : undefined;
  if (typeof analysisId !== "string" || !UUID.test(analysisId) || typeof organizationId !== "string") {
    return { ok: false, message: "The credential doesn't name an analysis and its organization." };
  }
  return { ok: true, scope: { analysisId, organizationId } };
}
