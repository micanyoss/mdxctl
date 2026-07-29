import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import * as p from "@clack/prompts";
import { defineCommand } from "citty";
import pc from "picocolors";
import { addProject, getProject } from "../registry.js";
import { unwrap } from "../utils/prompts.js";
import { validateProjectName } from "../utils/slug.js";
import { accent, introChip } from "../utils/tui.js";

export default defineCommand({
  meta: {
    name: "add",
    description: "Register an existing mdxctl folder",
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
      description: "Path to an existing mdxctl folder",
    },
  },
  async run({ args }) {
    p.intro(introChip(" mdxctl add "));

    const mdxctlPath = resolve(
      args.path ||
        unwrap(
          await p.text({
            message: "mdxctl folder",
            placeholder: "./.mdxctl",
            validate: (value) => {
              if (!value) return "A path is required";
              const root = resolve(value);
              if (!existsSync(root)) return "That folder does not exist";
              if (!existsSync(join(root, "docs"))) return "That folder has no docs subfolder";
            },
          }),
        ),
    );

    const name =
      args.name ||
      unwrap(
        await p.text({
          message: "Project name",
          placeholder: "my-project",
          validate: (value) => {
            const effective = value ?? "";
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

    if (!existsSync(mdxctlPath)) {
      console.error(pc.red(`mdxctl folder does not exist: ${mdxctlPath}`));
      process.exit(1);
    }
    if (!existsSync(join(mdxctlPath, "docs"))) {
      console.error(pc.red(`mdxctl folder has no docs subfolder: ${mdxctlPath}`));
      process.exit(1);
    }

    const entry = addProject(name, mdxctlPath);

    p.outro(
      `Registered ${pc.green(entry.name)}\n\n` +
        `Open it at ${accent(`https://mdxctl.localhost/${entry.name}`)} after ${accent("mdxctl start")}`,
    );
  },
});
