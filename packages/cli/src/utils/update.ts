import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { join } from "node:path";
import pc from "picocolors";
import { REGISTRY_DIR } from "../registry.js";
import { accent } from "./tui.js";
import { VERSION } from "./version.js";

const PACKAGE_NAME = "mdxctl";
const REGISTRY_HOST = "registry.npmjs.org";
const CACHE_PATH = join(REGISTRY_DIR, "update-check.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 1_000;

interface UpdateCache {
  checkedAt: number;
  latest: string;
}

/** Compares stable numeric semver versions without adding a runtime dependency. */
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (version: string): number[] | undefined => {
    const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
    return match?.slice(1).map(Number);
  };
  const next = parse(latest);
  const installed = parse(current);
  if (!next || !installed) return false;

  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index];
  }
  return false;
}

function readFreshCache(now: number): string | undefined {
  try {
    const cache = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as UpdateCache;
    if (now - cache.checkedAt < CACHE_TTL_MS) return cache.latest;
  } catch {
    // Missing or malformed cache: query npm.
  }
  return undefined;
}

function writeCache(latest: string, now: number): void {
  try {
    mkdirSync(REGISTRY_DIR, { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify({ checkedAt: now, latest }) + "\n", "utf8");
  } catch {
    // Update checks must never interfere with a command.
  }
}

function fetchLatestVersion(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const req = request(
      {
        hostname: REGISTRY_HOST,
        path: `/${PACKAGE_NAME}/latest`,
        headers: { accept: "application/json" },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          resolve(undefined);
          return;
        }

        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            const payload = JSON.parse(body) as { version?: unknown };
            resolve(typeof payload.version === "string" ? payload.version : undefined);
          } catch {
            resolve(undefined);
          }
        });
      },
    );
    req.once("timeout", () => req.destroy());
    req.once("error", () => resolve(undefined));
    req.end();
  });
}

export function renderUpdateNotice(latest: string): string {
  return [
    `${pc.yellow("●")} ${pc.bold("Update available")} ${pc.dim(`v${VERSION} -> `)}${accent(`v${latest}`)}`,
    `${pc.dim("  Run")} ${accent("npm install -g mdxctl@latest")}`,
    `${pc.dim("  Update the skill:")} ${accent("npx skills update")}`,
    "",
  ].join("\n");
}

/** Prints a small update notice before a command, and stays silent otherwise. */
export async function showUpdateNotice(): Promise<void> {
  if (!process.stdout.isTTY || process.env.NO_UPDATE_NOTIFIER) return;

  const now = Date.now();
  const latest = readFreshCache(now) ?? (await fetchLatestVersion());
  if (!latest) return;
  writeCache(latest, now);

  if (!isNewerVersion(latest, VERSION)) return;
  console.log(renderUpdateNotice(latest));
}
