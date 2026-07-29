#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { VERSION } from "./utils/version.js";

const main = defineCommand({
  meta: {
    name: "mdxctl",
    version: VERSION,
    description: "Manage and serve MDX docs projects from one place",
  },
  subCommands: {
    setup: () => import("./commands/setup.js").then((m) => m.default),
    start: () => import("./commands/start.js").then((m) => m.default),
    add: () => import("./commands/add.js").then((m) => m.default),
    remove: () => import("./commands/remove.js").then((m) => m.default),
    generate: () => import("./commands/generate.js").then((m) => m.default),
  },
});

runMain(main);
