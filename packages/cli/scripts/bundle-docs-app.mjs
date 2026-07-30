import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cliDir = resolve(scriptDir, "..");
const sourceDir = resolve(cliDir, "../docs-app");
const targetDir = join(cliDir, "docs-app");

if (!existsSync(join(sourceDir, "astro.config.mjs"))) {
  throw new Error(`Could not find docs app source at ${sourceDir}`);
}

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });

for (const entry of ["astro.config.mjs", "public", "src"]) {
  cpSync(join(sourceDir, entry), join(targetDir, entry), { recursive: true });
}

console.log(`Bundled docs app in ${targetDir}`);
