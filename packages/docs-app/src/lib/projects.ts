import { getCollection, type CollectionEntry } from "astro:content";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Where `mdxctl start` links each project's docs folder. */
const projectsRoot = resolve(
  process.env.MDXCTL_PROJECTS_PATH ?? "./src/content/projects",
);

export type DocEntry = CollectionEntry<"docs">;

export interface DocPage {
  /** Collection id, which doubles as the URL path: "cli/guide/setup". */
  id: string;
  /** "/cli/guide/setup" */
  url: string;
  title: string;
  description?: string;
  /** Path segments below the project root ([] for the project home page). */
  segments: string[];
  /** True for any index.mdx, including an index inside a nested folder. */
  isIndex: boolean;
  /** True for the project's root index.mdx. */
  isHome: boolean;
  entry: DocEntry;
}

export interface PlanFile {
  /** Path relative to the project's plan folder, using URL-style separators. */
  path: string;
  name: string;
}

export interface Project {
  /** First URL segment — the registered name, slugified. */
  slug: string;
  /** Registered name (falls back to the slug when unknown). */
  name: string;
  /** Absolute path of the registered mdxctl folder, when known. */
  path?: string;
  addedAt?: string;
  /** All docs in this project, home first, then depth-first alphabetical. */
  pages: DocPage[];
  /** All .mdx files inside the project's plan folder. */
  planFiles: PlanFile[];
  home?: DocPage;
  /** True when the project comes from ~/.mdxctl/registry.json. */
  registered: boolean;
  /**
   * False when the project is registered but its docs folder was not linked
   * into this server — i.e. it was registered after `mdxctl start` ran.
   */
  linked: boolean;
}

interface RegistryEntry {
  name: string;
  path: string;
  addedAt: string;
}

/**
 * Same transform Astro's glob loader applies to path segments when it derives
 * an entry id, so a registered name can be matched to its URL segment.
 */
export function slugifySegment(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\p{M}\-_ ]/gu, "")
    .replace(/ /g, "-");
}

/** Reads ~/.mdxctl/registry.json. Missing or broken registry → no entries. */
export function readRegistry(): RegistryEntry[] {
  const registryPath =
    process.env.MDXCTL_REGISTRY_PATH ?? join(homedir(), ".mdxctl", "registry.json");
  if (!existsSync(registryPath)) return [];
  try {
    const raw = JSON.parse(readFileSync(registryPath, "utf8")) as {
      projects?: Record<string, RegistryEntry>;
    };
    return Object.values(raw.projects ?? {}).filter(
      (entry) => typeof entry?.name === "string" && typeof entry?.path === "string",
    );
  } catch {
    return [];
  }
}

/** "getting-started" → "Getting started" */
function prettify(segment: string): string {
  const words = segment.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function toPage(entry: DocEntry, projectSlug: string): DocPage {
  const rest = entry.id === projectSlug ? "" : entry.id.slice(projectSlug.length + 1);
  const segments = rest ? rest.split("/") : [];
  // Astro collapses every index.mdx ID to its containing directory, so a
  // nested `test/index.mdx` arrives as `<project>/test`, not
  // `<project>/test/index`. Check the linked source tree as well as Astro's
  // optional filePath metadata, which is not retained in every runtime mode.
  const sourceSaysIndex = entry.filePath?.replaceAll("\\", "/").endsWith("/index.mdx") ?? false;
  const indexPath = join(projectsRoot, projectSlug, ...segments, "index.mdx");
  const isIndex = sourceSaysIndex || existsSync(indexPath);
  const isHome = isIndex && segments.length === 0;
  return {
    id: entry.id,
    url: `/${entry.id}`,
    title:
      entry.data.title ??
      (isHome ? "Overview" : prettify(segments[segments.length - 1])),
    description: entry.data.description,
    segments,
    isIndex,
    isHome,
    entry,
  };
}

function comparePages(a: DocPage, b: DocPage): number {
  if (a.isHome !== b.isHome) return a.isHome ? -1 : 1;
  const orderA = a.entry.data.order ?? Number.MAX_SAFE_INTEGER;
  const orderB = b.entry.data.order ?? Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;
  // Files before folders at each level, then alphabetical.
  const depth = Math.min(a.segments.length, b.segments.length);
  for (let i = 0; i < depth; i++) {
    const lastA = i === a.segments.length - 1;
    const lastB = i === b.segments.length - 1;
    if (lastA !== lastB) return lastA ? -1 : 1;
    const cmp = a.segments[i].localeCompare(b.segments[i]);
    if (cmp !== 0) return cmp;
  }
  return a.segments.length - b.segments.length;
}

function getPlanFiles(projectPath: string): PlanFile[] {
  const planRoot = join(projectPath, "plan");
  if (!existsSync(planRoot)) return [];

  const files: PlanFile[] = [];
  const visit = (directory: string, segments: string[]) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        visit(join(directory, entry.name), [...segments, entry.name]);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".mdx")) {
        const path = [...segments, entry.name].join("/");
        files.push({ path, name: prettify(entry.name.slice(0, -4)) });
      }
    }
  };

  visit(planRoot, []);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Every project the viewer knows about: registered projects from the CLI
 * registry, plus any docs folder that showed up in the content collection
 * (standalone dev, or a link left over from a previous run).
 */
export async function getProjects(): Promise<Project[]> {
  const entries = await getCollection("docs");

  const byProject = new Map<string, DocEntry[]>();
  for (const entry of entries) {
    const slug = entry.id.split("/")[0];
    const list = byProject.get(slug);
    if (list) list.push(entry);
    else byProject.set(slug, [entry]);
  }

  const projects: Project[] = [];
  const seen = new Set<string>();

  for (const registered of readRegistry()) {
    const slug = slugifySegment(registered.name);
    seen.add(slug);
    const pages = (byProject.get(slug) ?? [])
      .map((entry) => toPage(entry, slug))
      .sort(comparePages);
    projects.push({
      slug,
      name: registered.name,
      path: registered.path,
      addedAt: registered.addedAt,
      pages,
      planFiles: getPlanFiles(registered.path),
      home: pages.find((page) => page.isHome),
      registered: true,
      linked: pages.length > 0 || existsSync(join(projectsRoot, registered.name)),
    });
  }

  for (const [slug, docEntries] of byProject) {
    if (seen.has(slug)) continue;
    const pages = docEntries.map((entry) => toPage(entry, slug)).sort(comparePages);
    projects.push({
      slug,
      name: slug,
      pages,
      planFiles: [],
      home: pages.find((page) => page.isHome),
      registered: false,
      linked: true,
    });
  }

  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getProject(slug: string): Promise<Project | undefined> {
  return (await getProjects()).find((project) => project.slug === slug);
}

/** "C:\a\b\c\.mdxctl" → "…\b\c\.mdxctl" — keeps the useful tail readable. */
export function shortenPath(path: string, keep = 3): string {
  const separator = path.includes("\\") ? "\\" : "/";
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= keep) return path;
  return `…${separator}${parts.slice(-keep).join(separator)}`;
}

export interface NavNode {
  /** Stable path used to preserve this folder's expanded state. */
  key: string;
  label: string;
  page?: DocPage;
  children: NavNode[];
}

/** Builds the sidebar tree for a project (home page excluded). */
export function buildNav(pages: DocPage[]): NavNode[] {
  const roots: NavNode[] = [];
  const folders = new Map<string, NavNode>();

  for (const page of pages) {
    if (page.isHome) continue;
    const pageSegments = page.segments;
    // Astro removes "index" from collection IDs. For a nested index page,
    // all remaining segments identify the directory that owns the page.
    const isFolderIndex = page.isIndex;
    const folderSegments = isFolderIndex ? pageSegments : pageSegments.slice(0, -1);
    let level = roots;
    let prefix = "";
    for (const segment of folderSegments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let node = folders.get(prefix);
      if (!node) {
        node = { key: prefix, label: prettify(segment), children: [] };
        folders.set(prefix, node);
        level.push(node);
      }
      level = node.children;
    }

    if (isFolderIndex && folderSegments.length > 0) {
      const folder = folders.get(folderSegments.join("/"));
      if (folder) {
        folder.label = page.title;
        folder.page = page;
      }
    } else {
      level.push({ key: page.segments.join("/"), label: page.title, page, children: [] });
    }
  }

  return roots;
}
