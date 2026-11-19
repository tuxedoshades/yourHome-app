const { createHash } = require("node:crypto");
const { existsSync, readdirSync, readFileSync, statSync } = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const requiredFiles = [
  "package.json",
  "pnpm-lock.yaml",
  "apps/mobile/package.json",
  "apps/mobile/app.json",
  "apps/mobile/app.config.js",
  "apps/mobile/eas.json",
  "apps/mobile/babel.config.js",
  "apps/mobile/metro.config.js",
];
const recursiveRoots = ["apps/mobile/assets", "apps/mobile/android", "patches"];
const ignoredDirectoryNames = new Set([".cxx", ".gradle", ".idea", ".kotlin", "build", "node_modules"]);
const ignoredFileNames = new Set(["local.properties"]);
const ignoredFileExtensions = new Set([".log"]);

const files = [];
const addTree = (relativePath) => {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) return;
  const stat = statSync(absolutePath);
  if (stat.isFile()) {
    if (!ignoredFileNames.has(path.basename(relativePath)) && !ignoredFileExtensions.has(path.extname(relativePath))) {
      files.push(relativePath);
    }
    return;
  }
  if (!stat.isDirectory() || ignoredDirectoryNames.has(path.basename(relativePath))) return;
  for (const entry of readdirSync(absolutePath).sort()) addTree(path.join(relativePath, entry));
};

for (const relativePath of requiredFiles) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    throw new Error(`Missing required Android native input: ${relativePath}`);
  }
  files.push(relativePath);
}
for (const relativePath of recursiveRoots) addTree(relativePath);

const hash = createHash("sha256");
for (const relativePath of [...new Set(files)].sort()) {
  const normalizedPath = relativePath.split(path.sep).join("/");
  hash.update(normalizedPath);
  hash.update("\0");
  hash.update(readFileSync(path.join(repoRoot, relativePath)));
  hash.update("\0");
}

process.stdout.write(`${hash.digest("hex")}\n`);
