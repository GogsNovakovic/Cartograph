// The rail's categories per framework: which roles each holds, in reading
// order. Data only, no parser or filesystem import, so the browser can read
// it. The role names must match what the adapters emit; a role missing here
// lands in "Unlisted roles" rather than disappearing.

export type CategoryDefinition = {
  name: string;
  roles: readonly string[];
  // Shown even at zero, so a framework's main surfaces always have a place
  // in the rail and "none" is something it says rather than omits.
  always?: boolean;
};

type Framework = { label: string; categories: readonly CategoryDefinition[] };

// Routable surfaces first, then the layers behind them. Plumbing every
// framework shares follows, from PLUMBING.
const FRAMEWORKS: Record<string, Framework> = {
  nextjs: {
    label: "Next.js",
    categories: [
      { name: "Page routes", roles: ["page"], always: true },
      { name: "API endpoints", roles: ["route handler", "API route"], always: true },
      { name: "Server actions", roles: ["server actions"], always: true },
      { name: "Layouts", roles: ["layout", "parallel route default"] },
      { name: "Loading and error UI", roles: ["loading UI", "error UI"] },
      { name: "Metadata", roles: ["metadata"] },
      { name: "Proxy and middleware", roles: ["proxy", "middleware"] },
      { name: "Components", roles: ["component", "MDX components"] },
      { name: "Hooks", roles: ["hook"] },
      { name: "Instrumentation", roles: ["instrumentation"] },
    ],
  },
  nestjs: {
    label: "NestJS",
    categories: [
      { name: "Controllers", roles: ["controller"], always: true },
      { name: "Resolvers", roles: ["resolver"] },
      { name: "Gateways", roles: ["gateway"] },
      { name: "Services", roles: ["service"], always: true },
      { name: "Repositories", roles: ["repository"] },
      { name: "Modules", roles: ["module"], always: true },
      { name: "Entities", roles: ["entity"], always: true },
      { name: "Schemas", roles: ["schema"] },
      { name: "DTOs", roles: ["DTO"] },
      { name: "Guards", roles: ["guard"] },
      { name: "Interceptors", roles: ["interceptor"] },
      { name: "Pipes", roles: ["pipe"] },
      { name: "Filters", roles: ["filter"] },
      { name: "Middleware", roles: ["middleware"] },
      { name: "Strategies", roles: ["strategy"] },
      { name: "Decorators", roles: ["decorator"] },
      { name: "Bootstrap", roles: ["bootstrap"] },
    ],
  },
  // Routers first: they're where requests come in, even though Express
  // assembles the routes themselves at runtime.
  express: {
    label: "Express",
    categories: [
      { name: "Routers", roles: ["router"], always: true },
      { name: "Controllers", roles: ["controller"], always: true },
      { name: "Middleware", roles: ["middleware"], always: true },
      { name: "Validators", roles: ["validator"] },
      { name: "Services", roles: ["service"], always: true },
      { name: "Repositories", roles: ["repository"] },
      { name: "Models", roles: ["model"], always: true },
      { name: "Utilities", roles: ["utility"] },
    ],
  },
  react: {
    label: "React",
    categories: [
      { name: "App entry", roles: ["app entry"] },
      { name: "Components", roles: ["component"], always: true },
      { name: "Hooks", roles: ["hook"], always: true },
    ],
  },
};

// What tools name in any repository, framework or not.
const PLUMBING: readonly CategoryDefinition[] = [
  { name: "App entry", roles: ["app entry"] },
  { name: "Docs pages", roles: ["docs page"] },
  { name: "Theme components", roles: ["theme component"] },
  { name: "Tests", roles: ["test", "test setup"] },
  { name: "Config", roles: ["config"] },
  { name: "Package scripts", roles: ["package script"] },
  { name: "Type declarations", roles: ["type declarations"] },
];

export const UNLISTED = "Unlisted roles";
export const NO_CONVENTION = "No convention";

export function frameworkLabel(framework: string | null): string | null {
  return framework === null ? null : (FRAMEWORKS[framework]?.label ?? framework);
}

// Every category the rail can show for this framework, in order. A
// category name the framework already uses isn't repeated from plumbing.
export function categoriesFor(framework: string | null): CategoryDefinition[] {
  const own = (framework !== null && FRAMEWORKS[framework]?.categories) || [];
  const names = new Set(own.map((category) => category.name));
  return [
    ...own,
    ...PLUMBING.filter((category) => !names.has(category.name)),
    { name: UNLISTED, roles: [] },
    { name: NO_CONVENTION, roles: [] },
  ];
}

export function categoryOf(categories: readonly CategoryDefinition[], role: string | null): string {
  if (role === null) return NO_CONVENTION;
  return categories.find((category) => category.roles.includes(role))?.name ?? UNLISTED;
}
