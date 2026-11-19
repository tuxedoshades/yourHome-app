const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const repoRoot = path.resolve(__dirname, "..");
const rootRequire = createRequire(path.join(repoRoot, "__workspace-topology-probe.cjs"));
const mobileRequire = createRequire(path.join(repoRoot, "apps/mobile/__workspace-topology-probe.cjs"));
const mobileBuildSource = fs.readFileSync(path.join(repoRoot, "scripts/build-mobile.mjs"), "utf8");

assert.match(
  mobileBuildSource,
  /let toolRoot = repoRoot;/,
  "mobile builds must resolve hoisted CLI tools from the repository root on POSIX",
);
assert.ok(
  mobileBuildSource.includes("toolRoot = `${shortDrive}\\\\`;"),
  "mobile builds must resolve hoisted CLI tools from the mapped repository root on Windows",
);
assert.match(mobileBuildSource, /path\.join\(\s*toolRoot,\s*"node_modules"/);

const packageSpecifiers = [
  "react",
  "react-dom",
  "react-native/package.json",
  "react-native-web/package.json",
  "expo-router/package.json",
  "@expo/metro-runtime/package.json",
  "@expo/log-box/package.json",
];

for (const specifier of packageSpecifiers) {
  const rootPath = fs.realpathSync.native(rootRequire.resolve(specifier));
  const mobilePath = fs.realpathSync.native(mobileRequire.resolve(specifier));
  assert.equal(
    mobilePath,
    rootPath,
    `${specifier} has mixed workspace identities: mobile=${mobilePath}; root=${rootPath}`,
  );
}

console.log("[workspace-topology-test] PASS: mobile and renderer packages have one hoisted identity.");
