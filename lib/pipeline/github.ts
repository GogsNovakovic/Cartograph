import { pipeline } from "node:stream/promises";
import { x as extract } from "tar";

export type Repository = { owner: string; name: string };

export type UrlResult = { ok: true; repository: Repository } | { ok: false; message: string };

// GitHub's own limits on account and repository names.
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

// A repository's home URL and nothing deeper. A link into a branch or a
// folder is refused rather than quietly mapped from the default branch's
// root, which would be a map of something other than what was pasted.
export function parseRepositoryUrl(input: string): UrlResult {
  const trimmed = input.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, message: "That isn't a URL." };
  }
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    return { ok: false, message: "Only github.com repositories can be mapped." };
  }
  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length !== 2) {
    return { ok: false, message: "Paste the repository's home URL, like https://github.com/owner/name." };
  }
  const owner = parts[0];
  const name = parts[1].replace(/\.git$/, "");
  if (!OWNER.test(owner) || !NAME.test(name)) {
    return { ok: false, message: `github.com/${owner}/${name} isn't a valid repository name.` };
  }
  // GitHub names are case-insensitive, so the same repository pasted with
  // different casing is the same project rather than a second one.
  return { ok: true, repository: { owner: owner.toLowerCase(), name: name.toLowerCase() } };
}

// Unauthenticated on purpose: public repositories only, and no token to
// request, hold or store.
const HEADERS = { "User-Agent": "cartograph", "X-GitHub-Api-Version": "2022-11-28" };

async function failure(response: Response, what: string): Promise<Error> {
  if ((response.status === 403 || response.status === 429) && response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    const at = Number.isFinite(reset) ? ` It resets at ${new Date(reset * 1000).toLocaleTimeString()}.` : "";
    return new Error(`GitHub's limit for unauthenticated requests is used up.${at}`);
  }
  const body = (await response.text()).slice(0, 200);
  return new Error(`GitHub answered ${response.status} when ${what}.${body ? ` ${body}` : ""}`);
}

// The commit the default branch points at now. The archive is then requested
// by that exact commit, so what is parsed and what is recorded can't differ
// even if someone pushes in between.
export async function resolveCommit({ owner, name }: Repository): Promise<string> {
  const repo = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
    headers: { ...HEADERS, Accept: "application/vnd.github+json" },
  });
  if (repo.status === 404) {
    throw new Error(`There is no public repository at github.com/${owner}/${name}. It doesn't exist, or it's private.`);
  }
  if (!repo.ok) throw await failure(repo, "looking up the repository");
  const { default_branch: branch } = (await repo.json()) as { default_branch?: unknown };
  if (typeof branch !== "string") throw new Error(`GitHub didn't say what github.com/${owner}/${name}'s default branch is.`);

  const commit = await fetch(
    `https://api.github.com/repos/${owner}/${name}/commits/${encodeURIComponent(branch)}`,
    { headers: { ...HEADERS, Accept: "application/vnd.github.sha" } },
  );
  if (commit.status === 409) throw new Error(`github.com/${owner}/${name} is empty: it has no commits to map.`);
  if (!commit.ok) throw await failure(commit, `resolving the ${branch} branch`);
  const sha = (await commit.text()).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`GitHub returned "${sha.slice(0, 60)}" as the ${branch} commit.`);
  return sha;
}

// Streams the archive straight into the directory without holding it in
// memory. The archive's single top-level folder is stripped so the
// directory is the repository root; tar refuses entries that would land
// outside it.
export async function downloadArchive({ owner, name }: Repository, sha: string, directory: string): Promise<void> {
  const response = await fetch(`https://codeload.github.com/${owner}/${name}/tar.gz/${sha}`, { headers: HEADERS });
  if (!response.ok || !response.body) throw await failure(response, "downloading the archive");
  await pipeline(chunks(response.body), extract({ cwd: directory, strip: 1 }));
}

// One file's bytes at an exact commit, or null when it isn't there. Raw
// content rather than the API: no token, and it doesn't spend the
// unauthenticated API allowance a run needs.
export async function fetchFile({ owner, name }: Repository, sha: string, file: string): Promise<Buffer | null> {
  const encoded = file.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`https://raw.githubusercontent.com/${owner}/${name}/${sha}/${encoded}`, { headers: HEADERS });
  if (response.status === 404) return null;
  if (!response.ok) throw await failure(response, `fetching ${file} at ${sha.slice(0, 7)}`);
  return Buffer.from(await response.arrayBuffer());
}

// fetch's body is the DOM stream type, which Node's stream helpers don't
// accept by type; a generator bridges it without a cast.
async function* chunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    yield value;
  }
}
