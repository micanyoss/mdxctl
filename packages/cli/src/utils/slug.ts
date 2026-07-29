/**
 * Project names double as the first URL segment in the docs viewer, where
 * Astro's content loader slugifies every path segment. Keeping one shared
 * transform means `mdxctl` prints URLs that actually resolve.
 */
export function projectSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\p{M}\-_ ]/gu, "")
    .replace(/ /g, "-");
}

/** True when a name can be used verbatim as a URL segment. */
export function isCleanProjectName(name: string): boolean {
  return name.length > 0 && projectSlug(name) === name;
}

/**
 * Validation message for a project name, or undefined when it's fine.
 * Shared by `setup` and `add` so both reject the same shapes.
 */
export function validateProjectName(name: string): string | undefined {
  if (!name) return "A name is required";
  if (!isCleanProjectName(name)) {
    return `Use lowercase letters, digits, "-" or "_" (e.g. ${projectSlug(name) || "my-project"})`;
  }
  return undefined;
}
