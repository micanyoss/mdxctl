/**
 * Shiki transformers that carry fence metadata into the rendered markup.
 *
 * Astro's `rehypeShiki` REPLACES the original `<pre>` node with Shiki's own
 * output (see @astrojs/markdown-remark `highlight.js`), so the `metastring`
 * that `@astrojs/mdx` attaches to the `<code>` node never survives to a
 * `components={{ pre }}` override. The only supported channel is
 * `this.options.meta.__raw`, which Shiki hands to transformers — so we read the
 * fence header here and re-attach what we need as data attributes that
 * CodeBlock.astro can pick up as plain props.
 *
 * Supported fence syntax:
 *
 *     ```ts title="src/cli.ts" {2,4-6}
 *
 * - title="..."  (or title='...')  → data-title on the <pre>
 * - {2,4-6}                        → class="line--highlighted" on those lines
 *
 * Types are declared structurally rather than imported from "shiki": shiki is
 * only a transitive dependency of astro here, so a direct import would not
 * resolve under pnpm's strict node_modules layout.
 */

interface HastElement {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children: unknown[];
}

interface TransformerContext {
  readonly source: string;
  options: {
    lang?: string;
    meta?: { __raw?: string };
  };
  addClassToHast: (hast: HastElement, className: string | string[]) => HastElement;
}

export interface ShikiMetaTransformer {
  name: string;
  pre?: (this: TransformerContext, node: HastElement) => void;
  line?: (this: TransformerContext, node: HastElement, line: number) => void;
}

const TITLE_PATTERN = /\btitle\s*=\s*("([^"]*)"|'([^']*)')/;
const HIGHLIGHT_PATTERN = /\{([\d,\s-]+)\}/;

/** `title="src/cli.ts"` → `src/cli.ts` */
export function parseTitle(meta: string): string | undefined {
  const match = TITLE_PATTERN.exec(meta);
  if (!match) return undefined;
  const value = (match[2] ?? match[3] ?? "").trim();
  return value || undefined;
}

/**
 * `{2,4-6}` → Set {2, 4, 5, 6}. 1-based, matching how editors and every other
 * docs framework number fence lines. Reversed ranges and garbage are ignored
 * rather than thrown on: a typo in a fence header should not fail the build.
 */
export function parseHighlightedLines(meta: string): Set<number> {
  const lines = new Set<number>();
  const match = HIGHLIGHT_PATTERN.exec(meta);
  if (!match) return lines;

  for (const part of match[1].split(",")) {
    const range = part.trim();
    if (!range) continue;

    const bounds = range.split("-");
    if (bounds.length === 1) {
      const single = Number(bounds[0]);
      if (Number.isInteger(single) && single > 0) lines.add(single);
      continue;
    }
    if (bounds.length !== 2) continue;

    const start = Number(bounds[0]);
    const end = Number(bounds[1]);
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    if (start < 1 || end < start) continue;
    // A fat-fingered `{1-99999}` should not spin for ages.
    for (let line = start; line <= Math.min(end, start + 999); line++) {
      lines.add(line);
    }
  }

  return lines;
}

/**
 * Single transformer covering both features. The `line` hook runs once per
 * line and before `pre`, so the parsed range set is memoised per code block
 * against the options object Shiki threads through the whole pipeline.
 */
export function transformerFenceMeta(): ShikiMetaTransformer {
  const cache = new WeakMap<object, Set<number>>();

  return {
    name: "mdxctl:fence-meta",

    line(node, line) {
      const options = this.options;
      let highlighted = cache.get(options);
      if (!highlighted) {
        highlighted = parseHighlightedLines(options.meta?.__raw ?? "");
        cache.set(options, highlighted);
      }
      if (highlighted.has(line)) {
        this.addClassToHast(node, "line--highlighted");
      }
    },

    pre(node) {
      const meta = this.options.meta?.__raw ?? "";
      const title = parseTitle(meta);
      if (title) node.properties["data-title"] = title;
      if (this.options.lang) node.properties["data-lang"] = this.options.lang;
      // Marks blocks that went through this pipeline, so CodeBlock can tell a
      // highlighted fence apart from a stray <pre> written as raw HTML.
      node.properties["data-mdxctl-code"] = "";
    },
  };
}
