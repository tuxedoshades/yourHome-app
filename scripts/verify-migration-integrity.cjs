const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const migrationRoot = path.join(repoRoot, "apps", "api", "prisma", "migrations");
const manifestPath = path.join(repoRoot, "apps", "api", "prisma", "migrations.sha256");

const toRepoPath = (absolutePath) => path.relative(repoRoot, absolutePath).split(path.sep).join("/");

const migrationPaths = fs
  .readdirSync(migrationRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(migrationRoot, entry.name, "migration.sql"))
  .filter((migrationPath) => fs.existsSync(migrationPath));
migrationPaths.push(path.join(migrationRoot, "migration_lock.toml"));

const actualPaths = migrationPaths.map(toRepoPath).sort();
const manifestEntries = fs
  .readFileSync(manifestPath, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    const match = /^([0-9a-f]{64}) \*(.+)$/.exec(line);
    assert.ok(match, `Invalid migration manifest line: ${line}`);
    return { hash: match[1], path: match[2] };
  });

const manifestPaths = manifestEntries.map((entry) => entry.path).sort();
assert.deepEqual(
  manifestPaths,
  actualPaths,
  "Migration integrity manifest must cover every migration and migration_lock.toml exactly once",
);
assert.equal(new Set(manifestPaths).size, manifestPaths.length, "Migration manifest contains duplicates");

for (const entry of manifestEntries) {
  const bytes = fs.readFileSync(path.join(repoRoot, entry.path));
  const canonicalBytes = Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
  const actualHash = crypto.createHash("sha256").update(canonicalBytes).digest("hex");
  assert.equal(actualHash, entry.hash, `Migration integrity mismatch: ${entry.path}`);
}

console.log(`[migration-integrity] PASS: ${manifestEntries.length} protected files match.`);
