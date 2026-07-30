import gradient from "gradient-string";
import pc from "picocolors";
import { VERSION } from "./version.js";

const brand = gradient(["#f97316", "#fbbf24"]); // orange-500 → amber-400

/** Gradient brand text, used for card borders and accents. */
export const brandText = (text: string): string => brand(text);

/** Solid orange accent for paths, URLs, and command names. */
export const accent = (text: string): string =>
  `\x1b[38;2;251;146;60m${text}\x1b[39m`; // orange-400

/** Bold black-on-orange chip for clack intro titles. */
export const introChip = (text: string): string =>
  `\x1b[1m\x1b[38;2;0;0;0m\x1b[48;2;249;115;22m${text}\x1b[0m`; // on orange-500

// ---------------------------------------------------------------------------
// Log parsing
// ---------------------------------------------------------------------------

/** Matches astro's "astro  v7.1.3 ready in 3131 ms" (any version/unit). */
const READY_RE = /astro\s+v?([\d.]+)\s+ready in\s+([\d.,]+)\s*(ms|s)/i;

export interface ReadyInfo {
  version: string;
  readyIn: string;
}

export function parseReady(line: string): ReadyInfo | undefined {
  const match = line.match(READY_RE);
  if (!match) return undefined;
  const [, version, num, unit] = match;
  const value = Number(num.replace(",", "."));
  const readyIn =
    unit.toLowerCase() === "ms"
      ? value >= 1000
        ? `${(value / 1000).toFixed(1)}s`
        : `${Math.round(value)} ms`
      : `${value.toFixed(1)}s`;
  return { version, readyIn };
}

/** Hidden child-output lines mapped to friendly spinner milestones. */
const MILESTONES: [RegExp, string][] = [
  [/Starting proxy/, "Starting local proxy"],
  [/Ensuring TLS certificates/, "Preparing HTTPS certificates"],
  [/Adding CA to system trust store/, "Trusting local certificate"],
  [/HTTPS\/2 proxy started/, "Proxy listening on :443"],
  [/Syncing content/, "Syncing docs content"],
  [/\[types\] Generated/, "Generating types"],
  [/Re-optimizing dependencies/, "Optimizing dependencies"],
];

export function milestoneFor(line: string): string | undefined {
  for (const [pattern, message] of MILESTONES) {
    if (pattern.test(line)) return message;
  }
  return undefined;
}

const ERROR_RE =
  /(\[ERROR\]|\bERROR\b|Error:|error occurred|Cannot find module|Failed|failed to|ENOENT|EADDRINUSE)/i;

/** Lines that always reach the terminal, even in quiet mode. */
export function isErrorLine(line: string): boolean {
  return ERROR_RE.test(line);
}

// ---------------------------------------------------------------------------
// Status card
// ---------------------------------------------------------------------------

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const visibleLength = (s: string): number => s.replace(ANSI_RE, "").length;

export interface StatusCardOptions {
  url: string;
  /** The project the URL points at, when one could be determined. */
  project?: { name: string; path: string };
  /** How many registered projects are being served. */
  projectCount: number;
  readyIn: string;
}

/** Renders the boxed "server ready" status card. */
export function renderStatusCard(options: StatusCardOptions): string {
  const rows: string[] = [
    `${pc.green("●")} ${pc.bold("mdxctl docs server")} ${accent(`v${VERSION}`)} ${pc.dim(`— ready in ${options.readyIn}`)}`,
    "",
    `${pc.dim("Local   ")} ${pc.bold(accent(options.url))}`,
  ];

  if (options.project) {
    rows.push(`${pc.dim("Project ")} ${pc.green(options.project.name)}`);
    rows.push(`${pc.dim("Folder  ")} ${pc.white(options.project.path)}`);
  }

  if (options.projectCount === 0) {
    rows.push(`${pc.dim("Projects")} ${pc.yellow("none registered yet")}`);
    rows.push("");
    rows.push(`Run ${accent("mdxctl init")} in a project folder to add one.`);
  } else {
    rows.push(
      `${pc.dim("Serving ")} ${pc.white(String(options.projectCount))} ${pc.dim(
        `project${options.projectCount === 1 ? "" : "s"}`,
      )}${options.project ? "" : pc.dim(" — pick one on the index page")}`,
    );
  }

  rows.push("");
  rows.push(pc.dim("Ctrl+C to stop  ·  --verbose for raw logs"));

  const termWidth = process.stdout.columns ?? 80;
  const contentWidth = Math.min(
    Math.max(...rows.map(visibleLength)),
    termWidth - 6, // border + padding + safety margin
  );
  const width = contentWidth + 2; // one space padding on each side

  const border = (s: string) => brand(s);
  const side = brand("│");
  const top = border(`╭${"─".repeat(width)}╮`);
  const bottom = border(`╰${"─".repeat(width)}╯`);
  const pad = (text: string) =>
    side +
    " " +
    text +
    " ".repeat(Math.max(0, contentWidth - visibleLength(text))) +
    " " +
    side;

  return [top, ...rows.map(pad), bottom].join("\n");
}
