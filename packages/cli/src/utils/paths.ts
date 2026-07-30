import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REGISTRY_DIR } from "../registry.js";
import { VERSION } from "./version.js";

export interface LinkedProject {
  /** Registered project name — becomes the first URL segment. */
  name: string;
  /** Absolute path to that project's docs folder. */
  docsPath: string;
}

/** Wipes Astro's content-layer cache so the next sync re-reads every entry. */
function clearContentCache(docsAppDir: string): void {
  const dotAstro = join(docsAppDir, ".astro");
  for (const stale of [
    "data-store.json",
    "data-store",
    "content-modules.mjs",
    "content-assets.mjs",
  ]) {
    rmSync(join(dotAstro, stale), { recursive: true, force: true });
  }
}

/**
 * Links every registered project's docs folder into the docs-app at
 * `.mdxctl/projects/<name>` and returns that projects directory for use as
 * MDXCTL_PROJECTS_PATH.
 *
 * Why links: Astro's dev-mode content layer resolves entry modules relative to
 * the Astro project root, so docs living OUTSIDE the root break module
 * resolution (and the .astro cache goes stale when a base path changes).
 * Keeping every project under one constant in-root directory via junctions
 * (Windows, no admin needed) / symlinks avoids both problems, and makes the
 * collection id naturally `<project>/<slug>`.
 *
 * Whenever the linked set changes, Astro's content-layer cache is wiped so the
 * dev server re-syncs instead of serving stale modules.
 */
export function linkProjectsIntoApp(
  docsAppDir: string,
  projects: LinkedProject[],
): string {
  const linkDir = join(docsAppDir, ".mdxctl");
  const projectsDir = join(linkDir, "projects");
  const statePath = join(linkDir, "targets.json");

  const desired = new Map(
    projects.map((project) => [project.name, resolve(project.docsPath)]),
  );

  let previous: Record<string, string> = {};
  try {
    previous = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, string>;
  } catch {
    // no state recorded yet
  }

  mkdirSync(projectsDir, { recursive: true });

  // Legacy single-project link from earlier versions.
  rmSync(join(linkDir, "docs"), { recursive: true, force: true });
  rmSync(join(linkDir, "target.json"), { force: true });

  let changed = false;

  // Drop links that are no longer registered (or renamed away).
  for (const existing of readdirSync(projectsDir)) {
    if (!desired.has(existing)) {
      rmSync(join(projectsDir, existing), { recursive: true, force: true });
      changed = true;
    }
  }

  for (const [name, target] of desired) {
    const linkPath = join(projectsDir, name);
    // lstat doesn't follow the link, so this is true even if the target is gone
    let linkExists = false;
    try {
      lstatSync(linkPath);
      linkExists = true;
    } catch {
      // no link yet
    }
    if (linkExists && previous[name] === target) continue;

    rmSync(linkPath, { recursive: true, force: true });
    symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
    changed = true;
  }

  if (changed) {
    writeFileSync(
      statePath,
      JSON.stringify(Object.fromEntries(desired), null, 2) + "\n",
      "utf8",
    );
    clearContentCache(docsAppDir);
  }

  return projectsDir;
}

/**
 * Resolves an installed package's CLI entry point. Spawning it via
 * process.execPath avoids shell shims entirely (pnpm.cmd, .bin wrappers),
 * which Windows refuses to spawn without a shell.
 */
function resolveInstalledBin(
  parentDir: string,
  packageName: string,
  binName: string,
): string {
  const pkgDir = join(parentDir, "node_modules", packageName);
  const pkgJsonPath = join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) {
    throw new Error(
      `${packageName} is not installed in ${parentDir} — run \`pnpm install\` first.`,
    );
  }
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const binRel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[binName];
  if (!binRel) {
    throw new Error(`Could not find the "${binName}" binary in ${pkgDir}`);
  }
  return join(pkgDir, binRel);
}

/** Resolves the astro CLI entry point bundled with the mdxctl package. */
export function resolveAstroBin(): string {
  const pkgRoot = findCliPackageRoot(dirname(fileURLToPath(import.meta.url)));
  return resolveInstalledBin(pkgRoot, "astro", "astro");
}

/** Resolves the portless CLI entry point bundled with the mdxctl package. */
export function resolvePortlessBin(): string {
  const pkgRoot = findCliPackageRoot(dirname(fileURLToPath(import.meta.url)));
  return resolveInstalledBin(pkgRoot, "portless", "portless");
}

/** Walks up from a directory until it finds the mdxctl package root. */
function findCliPackageRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
        if (pkg.name === "mdxctl") {
          return dir;
        }
      } catch {
        // not parseable — keep walking up
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("Could not find the mdxctl package root");
    }
    dir = parent;
  }
}

/**
 * Resolves the writable docs-app directory.
 *
 * Development uses the workspace app directly. Published installs ship a
 * read-only template at <cli-pkg>/docs-app, which is copied into the user's
 * mdxctl data directory so Astro can write caches and project links there.
 */
export function resolveDocsAppDir(): string {
  const override = process.env.MDXCTL_DOCS_APP_PATH;
  if (override) {
    const dir = resolve(override);
    if (existsSync(join(dir, "astro.config.mjs"))) {
      return dir;
    }
    throw new Error(
      `MDXCTL_DOCS_APP_PATH points at ${dir}, but no astro.config.mjs was found there`,
    );
  }

  const pkgRoot = findCliPackageRoot(dirname(fileURLToPath(import.meta.url)));
  const workspaceApp = join(pkgRoot, "..", "docs-app");
  if (existsSync(join(workspaceApp, "package.json"))) {
    return workspaceApp;
  }

  const templateDir = join(pkgRoot, "docs-app");
  if (!existsSync(join(templateDir, "astro.config.mjs"))) {
    throw new Error(`The mdxctl package is missing its bundled docs app at ${templateDir}`);
  }

  const runtimeDir = join(REGISTRY_DIR, "runtime", `docs-app-${VERSION}`);
  const markerPath = join(runtimeDir, ".mdxctl-template-version");
  let current = false;
  try {
    current = readFileSync(markerPath, "utf8").trim() === VERSION;
  } catch {
    // The runtime copy has not been created yet.
  }

  if (!current) {
    rmSync(runtimeDir, { recursive: true, force: true });
    mkdirSync(dirname(runtimeDir), { recursive: true });
    cpSync(templateDir, runtimeDir, { recursive: true });
    writeFileSync(markerPath, `${VERSION}\n`, "utf8");
  }

  const runtimeModules = join(runtimeDir, "node_modules");
  if (!existsSync(runtimeModules)) {
    const installedModules = join(pkgRoot, "node_modules");
    symlinkSync(
      installedModules,
      runtimeModules,
      process.platform === "win32" ? "junction" : "dir",
    );
  }

  return runtimeDir;
}
