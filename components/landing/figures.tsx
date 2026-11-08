// Drawings of the canvas for the landing page. Drawn rather than captured,
// and unlabelled: grey bars stand where names would be, because a real name
// is a claim about somebody's code. Every colour is a theme token, so both
// palettes come from the same place the canvas's do. Static by design.

import type { ReactNode } from "react";

// The canvas drops whatever the selection doesn't touch to this.
const DIMMED = 0.25;

type Dim = { dim?: boolean };

function Figure({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" aria-hidden fill="none" strokeLinecap="round">
      {children}
    </svg>
  );
}

// Name, then counts: the two lines every box on the canvas carries.
function Label({ x, y, w }: { x: number; y: number; w: number }) {
  return (
    <>
      <rect x={x} y={y} width={w * 0.45} height={5} rx={1.5} className="fill-text" opacity={0.75} />
      <rect x={x} y={y + 12} width={w * 0.3} height={4} rx={1} className="fill-muted" opacity={0.6} />
    </>
  );
}

const BOX = 48;

function Folder({ x, y, w, dim }: { x: number; y: number; w: number } & Dim) {
  return (
    <g opacity={dim ? DIMMED : 1}>
      <rect x={x + 0.5} y={y + 0.5} width={w} height={BOX} rx={3} className="fill-surface stroke-border" />
      <Label x={x + 12} y={y + 16} w={w} />
    </g>
  );
}

type Row = { hue: number | null; length: number; state?: "selected" | "dimmed" };

const ROW = 26;
const HEADER = 44;

function rowY(panelY: number, index: number) {
  return panelY + HEADER + 2 + index * ROW + ROW / 2;
}

// An opened folder: header, then one row per file with its kind swatch.
function Panel({ x, y, w, rows, selected, dim }: { x: number; y: number; w: number; rows: Row[]; selected?: boolean } & Dim) {
  const height = HEADER + rows.length * ROW + 4;
  return (
    <g opacity={dim ? DIMMED : 1}>
      <rect
        x={x + 0.5}
        y={y + 0.5}
        width={w}
        height={height}
        rx={3}
        className={selected ? "fill-surface stroke-accent" : "fill-surface stroke-muted"}
        strokeWidth={selected ? 1.5 : 1}
      />
      <rect x={x + 1.25} y={y + 1.25} width={w - 1.5} height={HEADER - 1} rx={2.5} className="fill-raised" />
      <path d={`M${x + 1} ${y + HEADER + 0.5}h${w - 1}`} className="stroke-border" />
      <Label x={x + 12} y={y + 14} w={w} />
      {rows.map((row, i) => {
        const top = y + HEADER + 2 + i * ROW;
        const on = row.state === "selected";
        return (
          <g key={i} opacity={row.state === "dimmed" ? DIMMED : 1}>
            {on && <rect x={x + 1.5} y={top} width={w - 2} height={ROW} className="fill-accent" />}
            <rect
              x={x + 12}
              y={top + 9}
              width={8}
              height={8}
              rx={2}
              style={{ fill: on ? "var(--accent-text)" : row.hue === null ? "var(--muted)" : `var(--kind-${row.hue})` }}
            />
            <rect
              x={x + 28}
              y={top + 11}
              width={(w - 50) * row.length}
              height={4}
              rx={1}
              className={on ? "fill-accent-text" : "fill-text"}
              opacity={on ? 0.9 : 0.55}
            />
          </g>
        );
      })}
    </g>
  );
}

type Tone = "incoming" | "outgoing" | "plain";

const TONE: Record<Tone, string> = {
  incoming: "stroke-incoming",
  outgoing: "stroke-outgoing",
  plain: "stroke-border",
};

// Left to right, as the canvas lays dependencies out.
function Edge({ from, to, tone = "plain", dim }: { from: [number, number]; to: [number, number]; tone?: Tone } & Dim) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const bend = (x2 - x1) / 2;
  return (
    <path
      d={`M${x1} ${y1}C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`}
      className={TONE[tone]}
      strokeWidth={tone === "plain" ? 1 : 1.5}
      opacity={dim ? DIMMED : 1}
    />
  );
}

// The hero: a file selected in an opened folder, what imports it in green
// on the left, what it imports in amber on the right, everything else
// stepped back — as the canvas draws a selection.
export function MapFigure() {
  const w = 190;
  const [left, centre, right] = [1, 296, 589];
  const selected = rowY(56, 1);
  return (
    <Figure width={780} height={456}>
      <Edge from={[left + w, 164]} to={[centre, 312]} dim />
      <Edge from={[left + w, 424]} to={[centre, 396]} dim />
      <Edge from={[centre + w, 312]} to={[right, 324]} dim />
      <Edge from={[centre + w, 396]} to={[right, 412]} dim />
      <Edge from={[left + w, 44]} to={[centre, selected]} tone="incoming" />
      <Edge from={[left + w, rowY(228, 0)]} to={[centre, selected]} tone="incoming" />
      <Edge from={[centre + w, selected]} to={[right, rowY(8, 0)]} tone="outgoing" />
      <Edge from={[centre + w, selected]} to={[right, 216]} tone="outgoing" />

      <Folder x={left} y={20} w={w} />
      <Folder x={left} y={140} w={w} dim />
      <Panel
        x={left}
        y={228}
        w={w}
        rows={[
          { hue: 1, length: 0.6 },
          { hue: 0, length: 0.4, state: "dimmed" },
          { hue: 2, length: 0.7, state: "dimmed" },
        ]}
      />
      <Folder x={left} y={400} w={w} dim />

      <Panel
        x={centre}
        y={56}
        w={w}
        selected
        rows={[
          { hue: 1, length: 0.45, state: "dimmed" },
          { hue: 0, length: 0.7, state: "selected" },
          { hue: 0, length: 0.5, state: "dimmed" },
          { hue: 3, length: 0.6, state: "dimmed" },
        ]}
      />
      <Folder x={centre} y={288} w={w} dim />
      <Folder x={centre} y={372} w={w} dim />

      <Panel
        x={right}
        y={8}
        w={w}
        rows={[
          { hue: 0, length: 0.5 },
          { hue: 0, length: 0.65, state: "dimmed" },
          { hue: 2, length: 0.4, state: "dimmed" },
        ]}
      />
      <Folder x={right} y={192} w={w} />
      <Folder x={right} y={300} w={w} dim />
      <Folder x={right} y={388} w={w} dim />
    </Figure>
  );
}

// A single file on the canvas: kind swatch and name.
function File({ x, y, w, hue, selected }: { x: number; y: number; w: number; hue: number | null; selected?: boolean }) {
  return (
    <g>
      <rect
        x={x + 0.5}
        y={y + 0.5}
        width={w}
        height={28}
        rx={3}
        className={selected ? "fill-surface stroke-accent" : "fill-surface stroke-border"}
        strokeWidth={selected ? 1.5 : 1}
      />
      <rect x={x + 10} y={y + 10} width={8} height={8} rx={2} style={{ fill: hue === null ? "var(--muted)" : `var(--kind-${hue})` }} />
      <rect x={x + 26} y={y + 12} width={w * 0.45} height={4} rx={1} className="fill-text" opacity={selected ? 0.85 : 0.55} />
    </g>
  );
}

// Blast radius: the selected file on the right, what imports it, and what
// imports those, two imports out.
export function BlastFigure() {
  const w = 150;
  const [far, near, target] = [1, 186, 371];
  const farY = [16, 64, 148, 214, 262];
  const nearY = [40, 148, 238];
  const targetY = 140;
  const mid = (y: number) => y + 14;
  const feeds: [number, number][] = [[0, 0], [1, 0], [2, 1], [3, 2], [4, 2]];
  return (
    <Figure width={522} height={306}>
      {feeds.map(([from, to]) => (
        <Edge key={from} from={[far + w, mid(farY[from])]} to={[near, mid(nearY[to])]} tone="incoming" />
      ))}
      {nearY.map((y) => (
        <Edge key={y} from={[near + w, mid(y)]} to={[target, mid(targetY)]} tone="incoming" />
      ))}
      {farY.map((y, i) => (
        <File key={y} x={far} y={y} w={w} hue={[1, 1, 2, 3, 1][i]} />
      ))}
      {nearY.map((y, i) => (
        <File key={y} x={near} y={y} w={w} hue={[1, 1, 3][i]} />
      ))}
      <File x={target} y={targetY} w={w} hue={1} selected />
    </Figure>
  );
}

// The four steps, each small enough to sit above its text.

export function FetchFigure() {
  return (
    <Figure width={240} height={120}>
      <rect x={20.5} y={30.5} width={74} height={58} rx={3} className="fill-surface stroke-muted" />
      <path d="M21 44.5h73" className="stroke-muted" />
      <path d="M106 60h28" className="stroke-border" />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={146.5 + i * 14} y={20.5 + i * 14} width={52} height={52} rx={3} className="fill-surface stroke-border" />
          <rect x={154 + i * 14} y={30 + i * 14} width={22} height={4} rx={1} className="fill-text" opacity={0.5} />
        </g>
      ))}
    </Figure>
  );
}

// The import lines carry the outgoing colour: an import is what a file
// reaches out to.
export function ParseFigure() {
  const lines = [0.8, 0.62, 0.86, 0, 0.5, 0.88, 0.66];
  return (
    <Figure width={240} height={120}>
      <rect x={40.5} y={6.5} width={160} height={108} rx={3} className="fill-surface stroke-border" />
      {lines.map((length, i) =>
        length === 0 ? null : (
          <g key={i}>
            {i < 3 && <rect x={52} y={18 + i * 13} width={3} height={7} rx={1} className="fill-outgoing" />}
            <rect x={62} y={20 + i * 13} width={124 * length} height={4} rx={1} className="fill-text" opacity={i < 3 ? 0.75 : 0.4} />
          </g>
        ),
      )}
    </Figure>
  );
}

// Two imports land on files; the third lands on nothing and stops at a
// cross, reported rather than drawn in.
export function ResolveFigure() {
  return (
    <Figure width={240} height={120}>
      <Edge from={[94, 56]} to={[150, 20]} tone="outgoing" />
      <Edge from={[94, 56]} to={[150, 60]} tone="outgoing" />
      <path d="M94 56C122 56 118 96 146 98" className="stroke-muted" strokeDasharray="2 4" />
      <path d="M150 93l10 10m0-10l-10 10" className="stroke-muted" strokeWidth={1.5} />
      <rect x={22.5} y={42.5} width={72} height={28} rx={3} className="fill-surface stroke-accent" strokeWidth={1.5} />
      <rect x={34} y={54} width={40} height={4} rx={1} className="fill-text" opacity={0.75} />
      {[6, 46].map((y) => (
        <g key={y}>
          <rect x={150.5} y={y + 0.5} width={72} height={28} rx={3} className="fill-surface stroke-border" />
          <rect x={162} y={y + 12} width={36} height={4} rx={1} className="fill-text" opacity={0.5} />
        </g>
      ))}
    </Figure>
  );
}

export function DrawFigure() {
  const node = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect x={x + 0.5} y={y + 0.5} width={62} height={26} rx={3} className="fill-surface stroke-border" />
      <rect x={x + 12} y={y + 11} width={30} height={4} rx={1} className="fill-text" opacity={0.6} />
    </g>
  );
  return (
    <Figure width={240} height={120}>
      <Edge from={[63, 23]} to={[89, 60]} />
      <Edge from={[63, 97]} to={[89, 60]} />
      <Edge from={[151, 60]} to={[177, 23]} />
      <Edge from={[151, 60]} to={[177, 97]} />
      {node(1, 10)}
      {node(1, 84)}
      {node(89, 47)}
      {node(177, 10)}
      {node(177, 84)}
    </Figure>
  );
}
