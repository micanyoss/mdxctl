#!/usr/bin/env node
import { defineCommand, runMain } from "citty";
import { showUpdateNotice } from "./utils/update.js";
import { VERSION } from "./utils/version.js";

const main = defineCommand({
  meta: {
    name: "mdxctl",
    version: VERSION,
    description: "Manage and serve MDX docs projects from one place",
  },
  subCommands: {
    init: () => import("./commands/init.js").then((m) => m.default),
    start: () => import("./commands/start.js").then((m) => m.default),
    add: () => import("./commands/add.js").then((m) => m.default),
    remove: () => import("./commands/remove.js").then((m) => m.default),
    generate: () => import("./commands/generate.js").then((m) => m.default),
  },
});

const commandNames = new Set(["init", "start", "run", "add", "remove", "generate"]);
const command = process.argv[2];
if (commandNames.has(command)) {
  await showUpdateNotice();
}

runMain(main);
