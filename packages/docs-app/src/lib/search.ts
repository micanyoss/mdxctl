/**
 * Builds the static search index that the header search dialog queries.
 *
 * Every doc is flattened into small, individually addressable records, the same
 * shape fumadocs uses:
 *
 *   page     one per document — matches the title/description
 *   heading  one per heading  — links to "#<slug>"
 *   text     one per block of prose under a heading
 *
 * Records are grouped back together by `pageId` in the UI, so a hit deep inside
 * a document still shows which page it belongs to. The index is emitted per
 * project (see src/pages/search-index/[project].json.ts) and fetched lazily the
 * first time a reader opens search.
 */
import { render } from "astro:content";
import type { MarkdownHeading } from "astro";
import type { DocPage } from "./projects";

export type SearchRecordType = "page" | "heading" | "text";

export interface SearchRecord {
  /** Unique within a project index. */
  id: string;
  /** Collection id of the owning document — the grouping key. */
  pageId: string;
  /** Title of the owning document, repeated on every record for grouping. */
  pageTitle: string;
  /** Link target, including the heading anchor for heading/text records. */
  url: string;
  type: SearchRecordType;
  /** Nearest enclosing heading ("" for page records and preamble text). */
  heading: string;
  /** The searchable text: title, heading text, or a block of prose. */
  content: string;
}

/** Longest prose block kept per record — keeps the shipped index small. */
const MAX_CONTENT = 600;

/** Strips MDX/markdown syntax so only the words a reader sees remain. */
function toPlainText(value: string): string {
  return (
    value
      // ![alt](src) before [text](href), so alt text isn't kept as a link label.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // {" "} and other single-expression JSX children carry no words.
      .replace(/\{["'`][^}]*["'`]\}/g, " ")
      .replace(/\{[^}]*\}/g, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/`+/g, "")
      // Emphasis markers, without eating the underscores in snake_case: as in
      // markdown proper, `_` only delimits emphasis at a word boundary.
      .replace(/\*{1,3}(?=\S)([^*]+?)(?<=\S)\*{1,3}/g, "$1")
      .replace(
        /(^|[\s(\["'])_{1,3}(?=\S)([^_]+?)(?<=\S)_{1,3}(?=$|[\s)\]"',.!?:;])/g,
        "$1$2",
      )
      .replace(/^\s*>\s?/gm, "")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function truncate(value: string): string {
  if (value.length <= MAX_CONTENT) return value;
  const cut = value.slice(0, MAX_CONTENT);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > MAX_CONTENT * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Drops frontmatter and the ESM import/export block at the top of an MDX file. */
function stripPreamble(body: string): string {
  let text = body.replace(/^\uFEFF/, "");
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) text = text.slice(text.indexOf("\n", end + 1) + 1);
  }
  return text.replace(/^\s*(?:import|export)\s[^\n]*(?:\n(?![\s\S])|\n)/gm, "");
}

interface Block {
  heading?: string;
  text?: string;
}

/**
 * Walks the MDX source and returns headings and prose blocks in document order.
 * Fenced code, JSX-only lines, tables and HTML comments are skipped: they add
 * bulk to the index without giving readers anything recognisable to match on.
 */
function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  const lines = stripPreamble(body).split(/\r?\n/);

  let fence: string | undefined;
  let inComment = false;
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length === 0) return;
    const text = toPlainText(paragraph.join(" "));
    paragraph = [];
    if (text.length > 1) blocks.push({ text });
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (fence) {
      if (line.startsWith(fence)) fence = undefined;
      continue;
    }
    const fenceMatch = /^(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      flush();
      fence = fenceMatch[1];
      continue;
    }

    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }
    if (line.startsWith("<!--")) {
      if (!line.includes("-->")) inComment = true;
      continue;
    }

    if (line === "") {
      flush();
      continue;
    }

    const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (heading) {
      flush();
      const text = toPlainText(heading[2]);
      if (text) blocks.push({ heading: text });
      continue;
    }

    // Table rows and horizontal rules read as noise once stripped of syntax.
    if (/^\|/.test(line) || /^([-*_])\1{2,}$/.test(line)) {
      flush();
      continue;
    }

    // List markers and blockquote carets are stripped per line, before the
    // lines are joined — otherwise they survive in the middle of a paragraph.
    paragraph.push(line.replace(/^(?:[-*+]|\d+[.)])\s+/, "").replace(/^>\s?/, ""));
  }

  flush();
  return blocks;
}

/**
 * Flattens one document into its page/heading/text records.
 *
 * `headings` comes from Astro's `render()` and supplies the real anchor slugs
 * (github-slugger, including its `-1`/`-2` de-duplication) in document order —
 * the markdown headings parsed out of the body are matched to it positionally.
 */
export function recordsForPage(
  page: DocPage,
  headings: MarkdownHeading[] = [],
): SearchRecord[] {
  const records: SearchRecord[] = [];
  const pageTitle = page.title;

  records.push({
    id: `${page.id}#`,
    pageId: page.id,
    pageTitle,
    url: page.url,
    type: "page",
    heading: "",
    content: page.description ? `${pageTitle} — ${page.description}` : pageTitle,
  });

  let heading = "";
  let anchor = "";
  let headingIndex = 0;
  let index = 0;

  for (const block of parseBlocks(page.entry.body ?? "")) {
    if (block.heading !== undefined) {
      const rendered = headings[headingIndex++];
      heading = rendered?.text ?? block.heading;
      anchor = rendered?.slug ?? "";

      // The first h1 is normally the page title again — no separate record.
      if (heading.toLowerCase() === pageTitle.toLowerCase()) continue;

      records.push({
        id: `${page.id}#${anchor || `h${headingIndex}`}`,
        pageId: page.id,
        pageTitle,
        url: anchor ? `${page.url}#${anchor}` : page.url,
        type: "heading",
        heading,
        content: heading,
      });
      continue;
    }

    if (!block.text) continue;
    records.push({
      id: `${page.id}#t${index++}`,
      pageId: page.id,
      pageTitle,
      url: anchor ? `${page.url}#${anchor}` : page.url,
      type: "text",
      heading,
      content: truncate(block.text),
    });
  }

  return records;
}

/** Builds the index for a whole project, resolving each page's anchor slugs. */
export async function buildSearchIndex(pages: DocPage[]): Promise<SearchRecord[]> {
  const perPage = await Promise.all(
    pages.map(async (page) => {
      const { headings } = await render(page.entry);
      return recordsForPage(page, headings);
    }),
  );
  return perPage.flat();
}
