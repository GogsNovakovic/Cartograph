import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BUTTON } from "@/components/controls";
import {
  BlastFigure,
  DrawFigure,
  FetchFigure,
  MapFigure,
  ParseFigure,
  ResolveFigure,
} from "@/components/landing/figures";
import { ThemeControl } from "@/components/theme-control";
import { Wordmark } from "@/components/wordmark";
import { ANALYSE_PATH, SIGN_IN_PATH } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Cartograph — see the shape of code you didn't write",
  description:
    "Parses a public TypeScript or JavaScript repository and draws its resolved imports as a map. Every line is an import resolved to a real file.",
};

// The product's type and tokens at a reading size. Measures are in ch so a
// paragraph is capped by its own text, not the column.
const COLUMN = "mx-auto w-full max-w-[1140px] px-6";
const H2 = "text-[clamp(2rem,4vw,3rem)] leading-[1.1] font-semibold tracking-[-0.035em]";
const BODY = "text-[16px] leading-[1.65] text-muted";

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-surface">
        <div className={`${COLUMN} flex h-12 items-center gap-3`}>
          <Wordmark />
          <div className="flex-1" />
          <ThemeControl />
          <Link href={SIGN_IN_PATH} className={`${BUTTON} inline-flex items-center`}>
            Sign in
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <Hero />
        <WhatItDoes />
        <HowItWorks />
        <Frameworks />
        <WhatItDoesnt />
      </main>

      <footer className="border-t border-border">
        <div className={`${COLUMN} flex flex-wrap items-baseline gap-x-6 gap-y-1 py-8 text-[12px] text-muted`}>
          <Wordmark />
          <span>Public GitHub repositories. TypeScript and JavaScript.</span>
        </div>
      </footer>
    </div>
  );
}

function Hero() {
  return (
    <section
      className={`${COLUMN} grid min-h-[calc(100svh-3rem)] items-center gap-x-20 gap-y-16 py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]`}
    >
      <div>
        <h1 className="text-[clamp(2.75rem,6vw,5rem)] leading-[1.04] font-semibold tracking-[-0.045em]">
          See the shape of code you didn&apos;t write.
        </h1>
        <p className={`${BODY} mt-8 max-w-[46ch] text-[17px]`}>
          Paste a public GitHub repository. Cartograph parses every TypeScript and JavaScript file and draws the
          imports between them. Every line on the map is an import it resolved to a real file.
        </p>
        {/* A plain GET, so it works signed out: the proxy sends the visitor
            through sign-in and back to the same URL, which starts the run. */}
        <form action={ANALYSE_PATH} method="get" className="mt-10 max-w-[40rem]">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              name="url"
              type="text"
              required
              spellCheck={false}
              autoComplete="off"
              placeholder="github.com/owner/repo"
              aria-label="Public GitHub repository URL"
              className="h-10 min-w-0 flex-1 rounded border border-border bg-raised px-3 font-mono text-[14px] outline-none placeholder:text-muted focus:border-accent"
            />
            {/* The accent is for what's interactive; this is the one action
                the page exists for. */}
            <button
              type="submit"
              className="h-10 shrink-0 rounded bg-accent px-5 text-[14px] font-medium text-accent-text hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Map repository
            </button>
          </div>
          <p className="mt-3 text-[12.5px] text-muted">Public repositories only. You sign in first; no GitHub token is asked for.</p>
        </form>
      </div>
      <MapFigure />
    </section>
  );
}

function Section({ children }: { children: ReactNode }) {
  return (
    <section className="border-t border-border">
      <div className={`${COLUMN} py-28 sm:py-32`}>{children}</div>
    </section>
  );
}

// A short line of the outgoing or incoming colour, as the edge is drawn.
function Stroke({ tone }: { tone: "incoming" | "outgoing" }) {
  return (
    <span
      aria-hidden
      className={`mx-1 inline-block h-[2px] w-3 align-middle ${tone === "incoming" ? "bg-incoming" : "bg-outgoing"}`}
    />
  );
}

const FEATURES: { title: string; body: ReactNode }[] = [
  {
    title: "The map",
    body: "Folders are boxes and imports are the lines between them. Open a folder to see its files.",
  },
  {
    title: "A file's neighbours",
    body: (
      <>
        Select a file to see what imports it,
        <Stroke tone="incoming" />
        in green, and what it imports,
        <Stroke tone="outgoing" />
        in amber.
      </>
    ),
  },
  {
    title: "Blast radius",
    body: "Everything that depends on a file, two imports out, worked out the moment you click.",
  },
  {
    title: "Explanations",
    body: "A paragraph on what a file or folder does, written from its source and its real neighbours.",
  },
  {
    title: "Coverage",
    body: "How much of the repository was parsed, and why the rest wasn't. A partial map always says so.",
  },
];

function WhatItDoes() {
  return (
    <Section>
      <div className="grid items-center gap-x-20 gap-y-16 lg:grid-cols-2">
        <div>
          <h2 className={`${H2} max-w-[14ch]`}>Answers you get by clicking.</h2>
          <dl className="mt-12 space-y-8">
            {FEATURES.map((feature) => (
              <div key={feature.title}>
                <dt className="text-[17px] font-semibold tracking-[-0.01em]">{feature.title}</dt>
                <dd className={`${BODY} mt-1.5 max-w-[46ch]`}>{feature.body}</dd>
              </div>
            ))}
          </dl>
        </div>
        <BlastFigure />
      </div>
    </Section>
  );
}

const STEPS: { title: string; body: string; figure: ReactNode }[] = [
  {
    title: "Fetch",
    body: "The repository is downloaded as one archive, at the commit that was latest when you asked. That commit is recorded with the map.",
    figure: <FetchFigure />,
  },
  {
    title: "Parse",
    body: "Every TypeScript and JavaScript file is parsed. Imports, re-exports, dynamic imports and require() calls are all read.",
    figure: <ParseFigure />,
  },
  {
    title: "Resolve",
    body: "Each import is resolved to a file in the repository, through tsconfig paths and workspace packages. One that can't be is reported with the reason.",
    figure: <ResolveFigure />,
  },
  {
    title: "Draw",
    body: "The map, the neighbours and the blast radius are arithmetic over that list of edges, worked out in your browser.",
    figure: <DrawFigure />,
  },
];

function HowItWorks() {
  return (
    <Section>
      <h2 className={H2}>How it works</h2>
      <p className={`${BODY} mt-6 max-w-[64ch]`}>
        The parser decides what&apos;s connected. The AI explains what the parser found and labels files no convention
        could place, but it never adds a line to the map.
      </p>
      <ol className="mt-20 grid gap-x-12 gap-y-16 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, i) => (
          <li key={step.title}>
            <div className="max-w-[240px]">{step.figure}</div>
            <h3 className="mt-8 flex items-baseline gap-2 text-[17px] font-semibold tracking-[-0.01em]">
              <span className="font-mono text-[12px] font-normal text-muted tabular-nums">{i + 1}</span>
              {step.title}
            </h3>
            <p className={`${BODY} mt-3 max-w-[34ch]`}>{step.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

// A heading and its reason on the left, a two-column list on the right: the
// shape shared by the last two sections.
function TableSection({ title, intro, rows }: { title: string; intro: string; rows: { term: string; body: string }[] }) {
  return (
    <Section>
      <div className="grid gap-x-20 gap-y-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          <h2 className={`${H2} max-w-[14ch]`}>{title}</h2>
          <p className={`${BODY} mt-8 max-w-[46ch]`}>{intro}</p>
        </div>
        <dl className="border-b border-border">
          {rows.map((row) => (
            <div key={row.term} className="grid gap-x-8 gap-y-1 border-t border-border py-6 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <dt className="text-[16px] font-semibold">{row.term}</dt>
              <dd className={`${BODY} max-w-[52ch]`}>{row.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}

function Frameworks() {
  return (
    <TableSection
      title="It knows what frameworks put where."
      intro="Framework knowledge sorts files into roles, so a page reads as a page and a controller as a controller. It names what a file is; it never adds a line."
      rows={[
        { term: "Next.js", body: "Pages, layouts, route handlers, server actions and middleware, and the routes those handlers serve." },
        { term: "NestJS", body: "Controllers, modules, services, guards and the rest, and routes read from their decorators." },
        { term: "Express", body: "Routers, controllers, services, models and middleware, by the folders they live in." },
        { term: "Docusaurus", body: "Pages and swizzled theme overrides." },
        { term: "React", body: "Components and hooks, and the file that mounts the app." },
        {
          term: "Anything else",
          body: "Still parsed and mapped in full. Config files and type declarations are recognised by name.",
        },
      ]}
    />
  );
}

function WhatItDoesnt() {
  return (
    <TableSection
      title="What it deliberately doesn't do."
      intro="Each of these would make a more impressive demo. Each would also make a map you can't trust, which is the only thing this is for."
      rows={[
        { term: "Guess", body: "An import that can't be resolved to a file gets no line. The gap is counted and explained, never filled in." },
        { term: "Grade", body: "No scores, ratings or issues found. Once there's a number, people argue with the number instead of reading the map." },
        {
          term: "Approximate",
          body: "A route appears only when its method and full path both come from the source. A wrong route is the same failure as an invented edge.",
        },
        {
          term: "Let the model walk",
          body: "Which files a change can reach is counted from the edge list, the same way the map is drawn, never reasoned out by a model.",
        },
        { term: "Read private code", body: "That would need a GitHub token it then has to keep. Sign-in is for knowing who you are." },
        { term: "Other languages", body: "TypeScript and JavaScript only. Getting one language exactly right is the whole point." },
      ]}
    />
  );
}
