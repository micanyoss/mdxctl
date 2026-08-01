---
name: mdxctl
description: Write and serve project documentation as .mdx files with mdxctl. Use when asked to document a codebase, add or update docs pages, set up mdxctl, or run the docs site. Covers init, frontmatter, folder structure, writing rules, and the Callout/CodeBlock components.
---

# mdxctl

An agent-focused docs framework. You write plain `.mdx` files into a local folder; the user reads them in a rendered docs site.

## Setup

Only needed once per project. If a `.mdxctl/docs/` folder already exists, skip to Writing docs.

1. Install the CLI globally:

   ```bash
   npm install -g mdxctl
   ```

   Ignore any Node version warning during install, it does not affect usage.

2. Check what is already registered before picking a name. There is no `list` command; the registry is a JSON file keyed by project name:

   ```bash
   cat ~/.mdxctl/registry.json
   ```

   A missing file means nothing is registered yet. Every key under `projects` is a taken name, and its `path` shows the folder it points at. Use this to choose between the two commands below instead of guessing.

3. Register the project non-interactively. Pass both the name and the path so no prompts appear:

   ```bash
   mdxctl init <project-name> --path ./.mdxctl
   ```

   - `<project-name>` must be lowercase letters, digits, `-` or `_`. Default to the slugified repo folder name.
   - `--path` (alias `-p`) is the mdxctl folder. Default `./.mdxctl`.
   - This creates `.mdxctl/docs/`, `.mdxctl/plans/`, a sample `docs/index.mdx`, and editor type files.
   - `init` exits with an error if the name is already registered. If the registry already lists this project at this path, setup is done, skip ahead.

   If the `.mdxctl` folder exists on disk but is not in the registry (typical after a fresh clone, since `.mdxctl/` is often gitignored), use `add` instead. It registers an existing folder without scaffolding:

   ```bash
   mdxctl add <project-name> --path ./.mdxctl
   ```

4. Add this line to `AGENTS.md` (or `CLAUDE.md` if that is the file the project uses), only if it is not already there:

   ```
   Write documentation inside .mdxctl use skill: mdxctl
   ```

   Replace `.mdxctl` with the folder passed to `--path` if it differs.

Then tell the user to run the docs server themselves:

```bash
mdxctl start
```

It prints the docs URL. Do not run it yourself, it is a long-running process.

## Writing docs

All pages live under `<mdxctl-folder>/docs/`. Every page is a `.mdx` file with frontmatter:

```mdx
---
title: Authentication
description: How sessions are issued and verified
order: 2
---

Body content starts here.
```

- `title` — sidebar and page heading. Optional; falls back to the prettified filename. Always set it.
- `description` — one sentence under the title. Always set it.
- `order` — optional number to sort a page earlier in the sidebar. Pages with an `order` come first, low to high; pages without one follow, sorted alphabetically. A folder holding `a.mdx` (`order: 1`), `b.mdx` (`order: 2`) and `c.mdx` (no `order`) lists as A, B, C.

  Omit `order` unless ordering actually matters. It is compared before file paths, so an ordered page also hoists its parent folder: give one page in `zeta/` an `order` and `Zeta` jumps above `Alpha` in the sidebar.

Do not write an `# H1` in the body, the title supplies it. Start body headings at `##`.

### Folders

The file path is the URL path. `docs/api/webhooks.mdx` → `/<project>/api/webhooks`.

- `docs/index.mdx` is the project home page.
- A folder **with** an `index.mdx` becomes a clickable sidebar group: the index page's `title` labels the group, and the group itself opens that page.
- A folder **without** an `index.mdx` becomes a plain non-clickable label derived from the folder name, holding its children.

Prefer a folder with an `index.mdx` that introduces the group and links onward.

```
.mdxctl/docs/
├── index.mdx          → project home
├── deployment.mdx     → single page
└── api/
    ├── index.mdx      → clickable "API" group page
    └── webhooks.mdx   → child page
```

## Writing guidelines

- One page, one topic. If a page starts covering two things, split it.
- Group several closely related pages into a folder with an `index.mdx` rather than letting the top level sprawl.
- Lead with what the thing does and when to use it, then details.
- Prefer short paragraphs, concrete examples, and real code from the project over abstract prose.
- End **every** page with a `## Reference` section listing the source files the page documents, so a reader can jump to the code:

  ```mdx
  ## Reference

  - `src/auth/session.ts` — session creation and verification
  - `src/middleware/auth.ts` — route guard
  ```

## Components

### Code blocks

**Default to fenced blocks. Use `<CodeBlock>` only for dynamic code.**

Fences need **no import**. They already render with a filename bar, copy button and line highlighting.

````mdx
```ts title="src/cli.ts" {2,4-6}
import { defineCommand } from "citty";
const command = defineCommand({ meta: { name: "start" } });
```
````

- Language is the first word (any [Shiki language](https://shiki.style/languages); unknown ones fall back to plain text).
- `title="..."` shows a filename. Omit it and no header bar renders.
- `{2,4-6}` highlights lines, 1-based. Single lines and ranges can be mixed. A malformed range is silently ignored rather than failing the build.

Use `<CodeBlock>` only when the code cannot be typed as a fence, e.g. it is interpolated from a variable. A fence needs no escaping, whereas a `code` string has to survive both the MDX expression and the template literal.

```mdx
import CodeBlock from "@mdxctl/CodeBlock.astro";

<CodeBlock code={snippet} lang="ts" title="src/cli.ts" highlight="2" />
```

A range, with wrapping turned on:

```mdx
<CodeBlock code={snippet} lang="ts" title="src/cli.ts" highlight="2,4-6" wrap />
```

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `code` | `string` | — | The code to render. Required when importing it yourself. |
| `lang` | `string` | `"plaintext"` | Shiki language id, e.g. `"ts"`, `"bash"`, `"json"`. |
| `title` | `string` | — | Filename shown in the header bar. Omit it and no header renders. |
| `highlight` | `string` | — | Lines to highlight, same syntax as a fence but **without** the braces: `"2"` or `"2,4-6"`. |
| `wrap` | `boolean` | `false` | Soft-wrap long lines instead of scrolling horizontally. Pass bare (`wrap`) to enable. |

### Callouts

Use a callout for a caveat worth interrupting the reader for, not for ordinary emphasis.

```mdx
import Callout from "@mdxctl/Callout.astro";

<Callout type="warning">Requires Node 24 or newer.</Callout>
```

| Prop | Type | Default |
| --- | --- | --- |
| `type` | `"info" \| "success" \| "warning" \| "error"` | `"info"` |

### Imports

Everything except fences must be imported, from `@mdxctl/<Name>.astro`. Put imports directly after the frontmatter. If a component renders as nothing, a missing import is the first thing to check.
