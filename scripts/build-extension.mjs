import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const extensionDir = resolve(root, "extension");
const distDir = resolve(extensionDir, "dist");
const configDir = resolve(extensionDir, "config");

function getTarget() {
  const target = process.argv[2] || "prod";
  if (!["dev", "stage", "prod"].includes(target)) {
    throw new Error("Invalid target. Use: dev | stage | prod");
  }
  return target;
}

function validateEndpoint(configSource) {
  const endpointMatch = configSource.match(/workerEndpoint:\s*"([^"]+)"/);
  const hostMatch = configSource.match(/workerHost:\s*"([^"]+)"/);
  if (!endpointMatch || !hostMatch) {
    throw new Error("Missing workerEndpoint/workerHost in config");
  }
  const endpoint = endpointMatch[1];
  const host = hostMatch[1];
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "https:") {
    throw new Error("workerEndpoint must use https");
  }
  if (parsed.hostname !== host) {
    throw new Error("workerEndpoint hostname must match workerHost");
  }
}

async function copyConfig(target) {
  const sourcePath = resolve(configDir, `env.${target}.js`);
  const destinationPath = resolve(configDir, "current.js");
  const source = await readFile(sourcePath, "utf8");
  validateEndpoint(source);
  await writeFile(destinationPath, source, "utf8");
}

async function buildScripts() {
  await build({
    entryPoints: [
      resolve(extensionDir, "content.js"),
      resolve(extensionDir, "background.js")
    ],
    bundle: true,
    format: "esm",
    minify: true,
    sourcemap: false,
    target: ["chrome114"],
    outdir: distDir,
    legalComments: "none",
    logLevel: "info"
  });
}

async function writeManifest() {
  const manifestPath = resolve(extensionDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  manifest.content_scripts = [
    {
      matches: ["<all_urls>"],
      js: ["content.js"],
      run_at: "document_idle"
    }
  ];
  manifest.background = {
    service_worker: "background.js",
    type: "module"
  };

  await writeFile(
    resolve(distDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );
}

async function main() {
  const target = getTarget();
  await copyConfig(target);
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  await buildScripts();
  await writeManifest();
  process.stdout.write(`Built production extension for target: ${target}\n`);
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
