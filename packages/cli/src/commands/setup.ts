import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import * as p from "@clack/prompts";
import { defineCommand } from "citty";
import pc from "picocolors";
import { addProject, getProject } from "../registry.js";
import { unwrap } from "../utils/prompts.js";
import { projectSlug, validateProjectName } from "../utils/slug.js";
import { accent, introChip } from "../utils/tui.js";

const SAMPLE_MDX = `---
title: Welcome
---

# Welcome

mdxctl is still in early development. More coming soon.
`;

const DEFAULT_MDXCTL_DIR = ".mdxctl";
const DEFAULT_DOCS_DIR = "docs";
const DEFAULT_PLANS_DIR = "plans";

export default defineCommand({
  meta: {
    name: "setup",
    description: "Register a project and scaffold .mdxctl/docs and .mdxctl/plans",
  },
  args: {
    name: {
      type: "positional",
      description: "Project name",
      required: false,
    },
    path: {
      type: "string",
      alias: "p",
      description: "mdxctl folder (created if missing)",
    },
  },
  async run({ args }) {
    p.intro(introChip(" mdxctl setup "));

    const cwdName = projectSlug(basename(process.cwd()));
    const name =
      args.name ||
      unwrap(
        await p.text({
          message: "Project name",
          placeholder: cwdName,
          defaultValue: cwdName,
          // Empty input is fine: clack substitutes defaultValue on submit,
          // so validate the name the input will resolve to.
          validate: (value) => {
            const effective = value || cwdName;
            const invalid = validateProjectName(effective);
            if (invalid) return invalid;
            if (getProject(effective)) return `"${effective}" is already registered`;
          },
        }),
      );

    const nameError = validateProjectName(name);
    if (nameError) {
      p.cancel(`Invalid project name "${name}": ${nameError}`);
      process.exit(1);
    }
    if (getProject(name)) {
      p.cancel(`"${name}" is already registered`);
      process.exit(1);
    }

    const mdxctlPath = resolve(
      args.path ||
        unwrap(
          await p.text({
            message: "mdxctl folder",
            placeholder: `./${DEFAULT_MDXCTL_DIR}`,
            defaultValue: `./${DEFAULT_MDXCTL_DIR}`,
          }),
        ),
    );
    const docsPath = join(mdxctlPath, DEFAULT_DOCS_DIR);
    const plansPath = join(mdxctlPath, DEFAULT_PLANS_DIR);

    for (const folderPath of [docsPath, plansPath]) {
      if (!existsSync(folderPath)) {
        mkdirSync(folderPath, { recursive: true });
        p.log.info(`Created ${pc.dim(folderPath)}`);
      }
    }

    const samplePath = join(docsPath, "index.mdx");
    if (!existsSync(samplePath)) {
      writeFileSync(samplePath, SAMPLE_MDX, "utf8");
      p.log.info(`Wrote sample doc ${pc.dim(samplePath)}`);
    }

    const entry = addProject(name, mdxctlPath);

    p.outro(
      `Registered ${pc.green(entry.name)}\n\n` +
        `Next: run ${accent("mdxctl start")} → ${accent(`https://mdxctl.localhost/${entry.name}`)}`,
    );
  },
});
