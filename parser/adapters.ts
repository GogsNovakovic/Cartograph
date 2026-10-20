// Framework knowledge lives behind this interface and nowhere else. The parser
// asks an adapter questions; it never checks which framework it's looking at.

export type RepositoryContext = {
  root: string;
  // Relative paths of every source file the walk found.
  paths: readonly string[];
};

export type Adapter = {
  name: string;
  // Whether this framework is present in the repository.
  detects(repository: RepositoryContext): boolean;
  // What the framework's conventions make of a file at this path, or null
  // when its conventions say nothing about it.
  roleOf(path: string): string | null;
};

// Assumes no framework: detects everything, knows nothing about any file.
export const noFramework: Adapter = {
  name: "none",
  detects: () => true,
  roleOf: () => null,
};

// Checked in order; the fallback is last and always matches.
const ADAPTERS: readonly Adapter[] = [noFramework];

export function pickAdapter(repository: RepositoryContext): Adapter {
  return ADAPTERS.find((adapter) => adapter.detects(repository)) ?? noFramework;
}
