// The invented-path check: every path an explanation names, tested against
// the text the model was shown. Set membership, so deterministic code, never
// a model: a hallucination detector that hallucinates is worth nothing.
// Pure, so the app runs it live and a script runs it over saved runs, and
// both get the same answer.

// Characters a repository path is made of, including Next's route groups
// and dynamic segments: app/(site)/[id]/page.tsx.
const PATHISH = /[\w@.$~+\-[\]()/]+/g;

// Extensions that make a slash-less token a file name. A dot alone doesn't:
// `module.exports` and `process.env` are code, not files.
const EXTENSION =
  /\.(?:[cm]?[jt]sx?|json|mdx?|css|scss|sass|less|html|vue|svelte|ya?ml|toml|sql|graphql|gql|prisma|sh|py|go|rs|java|rb|php|xml|svg|txt|lock)$/;

const CODE = /`+([^`]+?)`+/g;

// A trailing full stop or comma is prose, and so is a closing bracket that
// opens nowhere in the token; a leading "./" names the same path without it.
function normalise(token: string): string {
  let t = token.trim();
  for (;;) {
    const before = t;
    t = t.replace(/[.,;:]+$/, "");
    if (t.endsWith(")") && count(t, "(") < count(t, ")")) t = t.slice(0, -1);
    if (t.startsWith("(") && count(t, "(") > count(t, ")")) t = t.slice(1);
    if (t === before) break;
  }
  return t.replace(/^(?:\.\/)+/, "").replace(/\/+$/, "");
}

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

// Path-shaped: relative, made only of path characters, and either has a
// directory in it or ends in a file extension. A leading slash is a URL
// route, which isn't a repository path and is never in what was shown.
function isPathShaped(token: string): boolean {
  if (token === "" || token.startsWith("/") || token.includes("//")) return false;
  if (token.replace(PATHISH, "") !== "") return false;
  if (!/[A-Za-z0-9]/.test(token)) return false;
  return token.includes("/") ? /[A-Za-z0-9]/.test(token.replace(/^[.@/]+/, "")) : EXTENSION.test(token);
}

// Everything that counts as shown: each path-like run of characters in the
// text, with the shorter ways of writing the same thing. A path written
// from a later folder down (`lib/cache.ts` for `src/lib/cache.ts`) names the
// same file, and a folder that a shown path sits in was shown with it.
function shownSet(shown: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const text of shown) {
    for (const [run] of text.matchAll(PATHISH)) {
      const pieces = [run, ...run.split(/[()]/)];
      for (const piece of pieces) {
        const token = normalise(piece);
        if (token === "") continue;
        set.add(token);
        const segments = token.split("/");
        for (let i = 1; i < segments.length; i++) {
          set.add(segments.slice(i).join("/"));
          set.add(segments.slice(0, i).join("/"));
        }
      }
    }
  }
  return set;
}

// Paths the explanation names. The prompt asks for every path in backticks,
// so each code span is a candidate; outside them only a token that is
// unmistakably a file path counts, so prose like "read/write" or "Next.js"
// is never mistaken for one.
export function mentionedPaths(explanation: string): string[] {
  const found = new Set<string>();
  const prose = explanation.replace(CODE, (_, inner: string) => {
    const token = normalise(inner);
    if (isPathShaped(token)) found.add(token);
    return " ";
  });
  for (const [run] of prose.matchAll(PATHISH)) {
    const token = normalise(run);
    if (token.includes("/") && EXTENSION.test(token) && isPathShaped(token)) found.add(token);
  }
  return [...found];
}

export type PathCheck = {
  // Every path the explanation names, in order of first mention.
  mentioned: string[];
  // Those that appear nowhere in what the model was shown.
  invented: string[];
};

export function checkPaths(shown: readonly string[], explanation: string): PathCheck {
  const set = shownSet(shown);
  const mentioned = mentionedPaths(explanation);
  return { mentioned, invented: mentioned.filter((path) => !set.has(path)) };
}

// The score recorded for a check: 1 when every named path was shown.
export const GROUNDED_PATHS = "grounded paths";

export function pathScore(check: PathCheck): { key: string; score: number; comment: string } {
  return {
    key: GROUNDED_PATHS,
    score: check.invented.length === 0 ? 1 : 0,
    comment:
      check.invented.length === 0
        ? `All ${check.mentioned.length} paths named were in what the model was shown.`
        : `Not in what the model was shown: ${check.invented.join(", ")}`,
  };
}
