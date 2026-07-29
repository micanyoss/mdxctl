import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// `mdxctl start` links every registered project's docs folder into
// <docs-app>/.mdxctl/projects/<name> and points MDXCTL_PROJECTS_PATH at that
// directory. The default keeps standalone development working.
const projectsRoot = resolve(
  process.env.MDXCTL_PROJECTS_PATH ?? "./src/content/projects",
);

// Astro's glob loader does `new URL(base, projectRoot)`, which misinterprets
// Windows absolute paths ("C:/...") as a URL with scheme "c:". Handing it a
// proper file:// URL works on every platform.
//
// Entry ids come out as "<project>/<doc path>", with a project's index.mdx
// collapsing to just "<project>" — which is exactly the URL path we serve.
const docs = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: pathToFileURL(projectsRoot).href }),
  schema: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    order: z.number().optional(),
  }),
});

export const collections = { docs };
