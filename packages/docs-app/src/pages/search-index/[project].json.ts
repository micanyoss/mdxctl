/**
 * Static search index, one file per project:
 *
 *   /search-index/<project>.json
 *
 * The dialog fetches this the first time a reader opens search, then feeds the
 * records into an Orama instance in the browser. Keeping it per project means a
 * reader only ever downloads the docs they are actually looking at, and the
 * whole thing stays a plain static asset — no server runtime needed, so it
 * works the same under `astro dev` and a built site.
 */
import type { APIRoute } from "astro";
import { getProjects } from "../../lib/projects";
import { buildSearchIndex } from "../../lib/search";

export async function getStaticPaths() {
  const projects = await getProjects();
  return projects.map((project) => ({
    params: { project: project.slug },
    props: { project },
  }));
}

export const GET: APIRoute = async ({ props }) => {
  const { project } = props as { project: Awaited<ReturnType<typeof getProjects>>[number] };
  const records = await buildSearchIndex(project.pages);

  return new Response(JSON.stringify({ project: project.slug, records }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Content is keyed by project name, not by revision, so revalidate.
      "cache-control": "no-cache",
    },
  });
};
