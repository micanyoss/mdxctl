// @ts-check
import mdx from "@astrojs/mdx";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";
import { transformerFenceMeta } from "./src/lib/shiki-meta.ts";

export default defineConfig({
  integrations: [mdx()],
  devToolbar: {
    enabled: false,
  },
  markdown: {
    // Dual themes emit both palettes as CSS variables on every token, so the
    // header's light/dark toggle switches code colours with no flash and no
    // client-side re-highlighting. `defaultColor: false` is what suppresses the
    // hardcoded light `color:` — without it, dark mode would keep light ink.
    // The matching variable swap lives in styles/global.css.
    shikiConfig: {
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
      defaultColor: false,
      transformers: [transformerFenceMeta()],
    },
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        // Stable specifiers for the bundled component library, so MDX files
        // living outside this project (linked in by `mdxctl start`) can still
        // import components:  import Callout from "@mdxctl/Callout.astro"
        //
        // Vite aliases are global rather than importer-relative, which is why
        // this resolves from a user's docs folder anywhere on disk. "@components"
        // stays as a back-compat alias for docs written before the rename.
        "@mdxctl": fileURLToPath(new URL("./src/components", import.meta.url)),
        "@components": fileURLToPath(new URL("./src/components", import.meta.url)),
      },
    },
  },
});
