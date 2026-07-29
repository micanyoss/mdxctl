import * as p from "@clack/prompts";
import { defineCommand } from "citty";
import pc from "picocolors";
import { removeProject } from "../registry.js";
import { pickProject, unwrap } from "../utils/prompts.js";
import { introChip } from "../utils/tui.js";

export default defineCommand({
  meta: {
    name: "remove",
    description: "Unregister a project (does not delete any files)",
  },
  args: {
    name: {
      type: "positional",
      description: "Project name (prompted when omitted)",
      required: false,
    },
  },
  async run({ args }) {
    p.intro(introChip(" mdxctl remove "));

    const project = await pickProject(args.name);

    const confirmed = unwrap(
      await p.confirm({
        message: `Unregister ${pc.green(project.name)} (${project.path})? Files are not deleted.`,
        initialValue: false,
      }),
    );

    if (!confirmed) {
      p.cancel("Aborted.");
      process.exit(0);
    }

    removeProject(project.name);
    p.outro(`Removed ${pc.green(project.name)} from the registry.`);
  },
});
