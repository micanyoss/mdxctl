import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  findProjectForCwd,
  getProject,
  listProjects,
  readRegistry,
  type ProjectEntry,
} from "../registry.js";
import { accent } from "./tui.js";

/**
 * Unwraps a clack prompt result, exiting cleanly when the user cancels
 * (Ctrl+C / Esc), which clack signals by returning a symbol.
 */
export function unwrap<T>(value: T | symbol): T {
  if (typeof value === "symbol") {
    p.cancel("Aborted.");
    process.exit(0);
  }
  return value;
}

/**
 * Resolves which registered project to act on: the explicit name if given,
 * the only project when there's exactly one, otherwise an interactive select.
 * Exits with an error when the registry is empty or the name is unknown.
 */
export async function pickProject(name?: string): Promise<ProjectEntry> {
  const registry = readRegistry();
  const projects = listProjects(registry);

  if (projects.length === 0) {
    console.error(
      pc.red("No projects registered yet.") +
        "\nRun " +
        accent("mdxctl init") +
        " to register your first docs project.",
    );
    process.exit(1);
  }

  if (name) {
    const entry = getProject(name, registry);
    if (!entry) {
      console.error(
        pc.red(`Project "${name}" is not registered.`) +
          "\nRegistered projects: " +
          projects.map((proj) => pc.white(proj.name)).join(", "),
      );
      process.exit(1);
    }
    return entry;
  }

  if (projects.length === 1) {
    return projects[0];
  }

  const choice = unwrap(
    await p.select({
      message: "Select a project",
      // Default to the project of the folder the command was run in.
      initialValue: findProjectForCwd(process.cwd(), registry)?.name,
      options: projects.map((proj) => ({
        value: proj.name,
        label: proj.name,
        hint: proj.path,
      })),
    }),
  );
  return getProject(choice, registry) as ProjectEntry;
}
