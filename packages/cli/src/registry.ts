import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface ProjectEntry {
  /** Unique project name, e.g. "gateway". */
  name: string;
  /** Absolute path to the project's mdxctl folder (contains docs and plans). */
  path: string;
  /** ISO timestamp of when the project was registered. */
  addedAt: string;
}

export interface Registry {
  version: 2;
  projects: Record<string, ProjectEntry>;
}

export const REGISTRY_DIR = join(homedir(), ".mdxctl");
export const REGISTRY_PATH = join(REGISTRY_DIR, "registry.json");

export function emptyRegistry(): Registry {
  return { version: 2, projects: {} };
}

function validateRegistry(raw: unknown): Registry {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("registry root is not an object");
  }
  const reg = raw as {
    version?: number;
    projects?: Record<string, ProjectEntry>;
  };
  if (reg.version !== 1 && reg.version !== 2) {
    throw new Error(`unsupported registry version: ${String(reg.version)}`);
  }
  if (typeof reg.projects !== "object" || reg.projects === null) {
    throw new Error("registry is missing a 'projects' object");
  }
  for (const [key, entry] of Object.entries(reg.projects)) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as ProjectEntry).name !== "string" ||
      typeof (entry as ProjectEntry).path !== "string" ||
      typeof (entry as ProjectEntry).addedAt !== "string"
    ) {
      throw new Error(`malformed project entry under key "${key}"`);
    }
  }
  if (reg.version === 1) {
    // Version 1 stored the docs folder itself. Version 2 stores its parent
    // mdxctl folder and derives the docs path as <root>/docs.
    return {
      version: 2,
      projects: Object.fromEntries(
        Object.entries(reg.projects).map(([key, entry]) => [
          key,
          { ...entry, path: dirname(entry.path) },
        ]),
      ),
    };
  }
  return reg as Registry;
}

/**
 * Reads ~/.mdxctl/registry.json. Returns an empty registry when the file
 * does not exist yet; throws on malformed JSON or schema mismatch.
 */
export function readRegistry(): Registry {
  if (!existsSync(REGISTRY_PATH)) {
    return emptyRegistry();
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(REGISTRY_PATH, "utf8"));
  } catch (err) {
    throw new Error(
      `Failed to parse registry at ${REGISTRY_PATH}: ${(err as Error).message}`,
    );
  }
  try {
    const registry = validateRegistry(raw);
    if ((raw as { version?: number }).version === 1) {
      writeRegistry(registry);
    }
    return registry;
  } catch (err) {
    throw new Error(
      `Invalid registry at ${REGISTRY_PATH}: ${(err as Error).message}`,
    );
  }
}

export function writeRegistry(registry: Registry): void {
  mkdirSync(dirname(REGISTRY_PATH), { recursive: true });
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n", "utf8");
}

export function listProjects(registry: Registry = readRegistry()): ProjectEntry[] {
  return Object.values(registry.projects).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export function getProject(
  name: string,
  registry: Registry = readRegistry(),
): ProjectEntry | undefined {
  return registry.projects[name];
}

/** Absolute path to a project's docs folder. */
export function docsPathOf(entry: ProjectEntry): string {
  return join(entry.path, "docs");
}

const samePath = (a: string, b: string): boolean =>
  process.platform === "win32"
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;

/**
 * Finds the registered project that owns a directory: the nearest ancestor
 * (starting at `dir` itself) that either *is* a registered mdxctl folder, or
 * *contains* one (`<dir>/.mdxctl`), or lives inside one.
 *
 * Lets `mdxctl start` run bare inside a project and still know which docs the
 * user means.
 */
export function findProjectForCwd(
  dir: string = process.cwd(),
  registry: Registry = readRegistry(),
): ProjectEntry | undefined {
  const projects = listProjects(registry);
  if (projects.length === 0) return undefined;

  let current = resolve(dir);
  for (;;) {
    const match = projects.find(
      (project) =>
        samePath(project.path, current) ||
        samePath(project.path, join(current, ".mdxctl")),
    );
    if (match) return match;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** Registers a project. Throws if the name is already taken. */
export function addProject(name: string, mdxctlPath: string): ProjectEntry {
  const registry = readRegistry();
  if (registry.projects[name]) {
    throw new Error(`Project "${name}" is already registered`);
  }
  const entry: ProjectEntry = {
    name,
    path: resolve(mdxctlPath),
    addedAt: new Date().toISOString(),
  };
  registry.projects[name] = entry;
  writeRegistry(registry);
  return entry;
}

/** Removes a project by name. Returns false when it did not exist. */
export function removeProject(name: string): boolean {
  const registry = readRegistry();
  if (!registry.projects[name]) {
    return false;
  }
  delete registry.projects[name];
  writeRegistry(registry);
  return true;
}
