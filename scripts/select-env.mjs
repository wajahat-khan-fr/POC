import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";

const target = process.argv[2];
const allowed = new Set(["dev", "stage", "prod"]);

if (!allowed.has(target)) {
  console.error("Usage: node scripts/select-env.mjs <dev|stage|prod>");
  process.exit(1);
}

const root = process.cwd();
const source = resolve(root, "extension", "config", `env.${target}.js`);
const destination = resolve(root, "extension", "config", "current.js");

try {
  await copyFile(source, destination);
  console.log(`Selected extension environment: ${target}`);
  process.exit(0);
} catch (error) {
  console.error("Failed to switch environment.", error);
  process.exit(1);
}
