// @ts-check
import mdx from "@astrojs/mdx";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  integrations: [mdx()],
  devToolbar: {
    enabled: false,
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        // Stable specifier for the bundled component library, so MDX files
        // living outside this project (loaded via MDXCTL_DOCS_PATH) can still
        // import components:  import Callout from "@components/Callout.astro"
        "@components": fileURLToPath(new URL("./src/components", import.meta.url)),
      },
    },
  },
});
