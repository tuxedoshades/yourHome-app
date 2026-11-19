import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
let mobileDir = path.join(repoRoot, "apps", "mobile");
let toolRoot = repoRoot;

if (process.platform === "win32") {
  const shortDrive = "Y:";
  const substOutput = execFileSync("subst.exe", [], { encoding: "utf8" });
  const mapping = substOutput.split(/\r?\n/).find((line) => line.toUpperCase().startsWith(`${shortDrive}\\:`));

  if (mapping) {
    const mappingTarget = path.resolve(mapping.split("=>", 2)[1].trim()).replace(/[\\/]+$/, "");
    const normalizedRepoRoot = repoRoot.replace(/[\\/]+$/, "");
    if (mappingTarget.toLowerCase() !== normalizedRepoRoot.toLowerCase()) {
      throw new Error(`Drive ${shortDrive} is already mapped somewhere else: ${mapping}`);
    }
  }
  if (!mapping) {
    execFileSync("subst.exe", [shortDrive, repoRoot], { stdio: "inherit" });
  }

  mobileDir = `${shortDrive}\\apps\\mobile`;
  toolRoot = `${shortDrive}\\`;
}

const expo = path.join(toolRoot, "node_modules", ".bin", process.platform === "win32" ? "expo.cmd" : "expo");

if (!existsSync(expo)) {
  throw new Error(`Expo CLI is missing at ${expo}. Install dependencies before building.`);
}

for (const platform of ["ios", "android"]) {
  const outputDir = path.join(mobileDir, "dist", platform);
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : expo;
  const args =
    process.platform === "win32"
      ? ["/d", "/s", "/c", expo, "export", "--platform", platform, "--output-dir", outputDir]
      : ["export", "--platform", platform, "--output-dir", outputDir];
  const result = spawnSync(command, args, {
    cwd: mobileDir,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
