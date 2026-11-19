const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const apiRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(apiRoot, "../..");
const read = (relative) => fs.readFileSync(path.resolve(repoRoot, relative), "utf8");
const apiPackage = JSON.parse(read("apps/api/package.json"));
const rootPackage = JSON.parse(read("package.json"));

const gitAttributesPath = path.resolve(repoRoot, ".gitattributes");
assert.ok(fs.existsSync(gitAttributesPath), "Migration line endings must be pinned across Windows and POSIX checkouts");
const gitAttributes = fs.readFileSync(gitAttributesPath, "utf8");
assert.match(gitAttributes, /^\/apps\/api\/prisma\/migrations\/\*\*\/migration\.sql text eol=lf$/m);
assert.match(gitAttributes, /^\/apps\/api\/prisma\/migrations\/migration_lock\.toml text eol=lf$/m);

assert.equal(apiPackage.type, "module", "Prisma 7 API must use the selected ESM path");
assert.equal(apiPackage.dependencies["@prisma/client"], "7.9.0");
assert.equal(apiPackage.dependencies["@prisma/adapter-pg"], "7.9.0");
assert.equal(apiPackage.dependencies.pg, "8.22.0");
assert.equal(apiPackage.devDependencies.prisma, "7.9.0");
assert.equal(apiPackage.devDependencies["@types/pg"], "8.20.0");
assert.equal(apiPackage.devDependencies.dotenv, "17.4.2");
assert.match(apiPackage.scripts.build, /prisma:generate.*tsc/);
assert.equal(apiPackage.scripts.predev, "prisma generate");
assert.equal(apiPackage.scripts["typecheck:scripts"], "tsc -p tsconfig.scripts.json --noEmit");
assert.equal(rootPackage.scripts["test:migration-integrity"], "node scripts/verify-migration-integrity.cjs");
assert.equal(apiPackage.scripts["prisma:deploy"], "prisma migrate deploy");
assert.equal(apiPackage.scripts["prisma:validate"], "prisma validate");
assert.match(apiPackage.scripts["test:prisma"], /smoke-supervisor\.cjs --prisma-contract-only/);
assert.match(apiPackage.scripts["test:prisma:worker"], /prisma-contract\.ts/);
assert.match(apiPackage.scripts["test:prisma:read"], /prisma-read-contract\.ts/);
assert.match(apiPackage.scripts["smoke:disposable"], /smoke-supervisor\.cjs/);
assert.equal(rootPackage.scripts["smoke:api"], "pnpm --filter api smoke:disposable");

const schema = read("apps/api/prisma/schema.prisma");
assert.match(schema, /provider\s*=\s*"prisma-client"/);
assert.match(schema, /output\s*=\s*"\.\.\/src\/generated\/prisma"/);
assert.doesNotMatch(schema, /url\s*=\s*env\("DATABASE_URL"\)/);

const config = read("apps/api/prisma.config.ts");
assert.match(config, /import "dotenv\/config"/);
assert.match(config, /schema:\s*"prisma\/schema\.prisma"/);
assert.match(config, /path:\s*"prisma\/migrations"/);
assert.match(config, /const databaseUrl = process\.env\.DATABASE_URL/);
assert.doesNotMatch(config, /env\("DATABASE_URL"\)/);

const server = read("apps/api/src/index.ts");
const seed = read("apps/api/scripts/seed-demo.ts");
const prismaModule = read("apps/api/src/lib/prisma.ts");
const prismaContract = read("apps/api/scripts/prisma-contract.ts");
const prismaReadContract = read("apps/api/scripts/prisma-read-contract.ts");
const smoke = read("apps/api/scripts/smoke.ts");
const disposableSmoke = read("apps/api/scripts/smoke-disposable.ts");
const smokeSupervisor = read("apps/api/scripts/smoke-supervisor.cjs");
const migrationPlan = read("docs/PRISMA_7_MIGRATION.md");
const operations = read("docs/OPERATIONS.md");
assert.doesNotMatch(server, /from "@prisma\/client"/);
assert.doesNotMatch(seed, /from "@prisma\/client"/);
assert.match(server, /from "\.\/lib\/prisma\.js"/);
assert.match(seed, /from "\.\.\/src\/lib\/prisma\.js"/);
assert.match(server, /SIGTERM/);
assert.match(server, /SIGBREAK/);
assert.match(server, /finally\s*{[\s\S]*?prisma\.\$disconnect\(\)/);
assert.match(server, /process\.env\.PORT/);
assert.match(server, /process\.env\.HOST/);
assert.match(prismaModule, /DATABASE_IDLE_TIMEOUT_MS\s*\?\?\s*"300000"/);
assert.match(prismaModule, /idleTimeoutMillis/);
assert.doesNotMatch(prismaReadContract, /\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\s*\(/);
assert.match(prismaReadContract, /\$queryRaw/);
assert.match(prismaContract, /cleanupError/);
assert.match(prismaContract, /await workload\.catch/);
assert.match(prismaContract, /PRISMA_CONTRACT_DISPOSABLE_DATABASE_NAME/);
assert.match(prismaContract, /disposable database name must match DATABASE_URL/);
assert.match(smoke, /path\.relative\(outboxRoot, resolvedOutboxFile\)/);
assert.match(smoke, /relativeOutboxPath\.startsWith\("\.\."\)/);
assert.doesNotMatch(smoke, /API_BASE_URL\s*\?\?\s*"http:\/\/localhost:3000"/);
assert.match(smoke, /SMOKE_DISPOSABLE_DATABASE_NAME/);
assert.match(smoke, /disposable database name must match DATABASE_URL/);
assert.match(smoke, /\^yourhome_prisma7_smoke_\[0-9\]\+_\[0-9\]\+\$/);
assert.match(smoke, /SMOKE_DISPOSABLE_CAPABILITY/);
assert.match(smoke, /\/internal\/disposable-smoke-context/);
assert.match(smoke, /disposable smoke target database identity mismatch/);
assert.match(disposableSmoke, /yourhome_prisma7_smoke_/);
assert.match(disposableSmoke, /SMTP_URL:\s*""/);
assert.match(disposableSmoke, /SMTP_HOST:\s*""/);
assert.match(disposableSmoke, /dropDatabase/);
assert.match(disposableSmoke, /from "node:net"/);
assert.match(disposableSmoke, /assertPortAvailable/);
assert.match(disposableSmoke, /isolated smoke port .* is already in use/);
assert.match(disposableSmoke, /HOST:\s*"127\.0\.0\.1"/);
assert.match(disposableSmoke, /STORAGE_PROVIDER:\s*"local"/);
assert.match(disposableSmoke, /S3_BUCKET:\s*""/);
assert.match(disposableSmoke, /SMOKE_DISPOSABLE_DATABASE_NAME:\s*databaseName/);
assert.match(disposableSmoke, /--prisma-contract-only/);
assert.match(disposableSmoke, /PRISMA_CONTRACT_DISPOSABLE_DATABASE_NAME:\s*databaseName/);
assert.match(disposableSmoke, /SMOKE_DISPOSABLE_CAPABILITY:\s*smokeCapability/);
assert.match(disposableSmoke, /randomBytes\(32\)/);
assert.match(disposableSmoke, /runCommand\(\["test:prisma:worker"\]/);
assert.match(disposableSmoke, /SMOKE_TEST_INTERRUPT_AFTER_CHILD_START_MS/);
assert.match(disposableSmoke, /scheduleTestInterrupt/);
assert.match(disposableSmoke, /signalChildStopPromise/);
assert.match(disposableSmoke, /await signalChildStopPromise/);
assert.match(disposableSmoke, /SIGINT/);
assert.match(disposableSmoke, /SIGTERM/);
assert.match(disposableSmoke, /SIGBREAK/);
assert.match(disposableSmoke, /child\.once\("error"/);
assert.match(disposableSmoke, /const onError = \(\) => finish\(false\)/);
const stopChildBody = disposableSmoke.match(/const stopChild =[\s\S]*?const stopActiveChildren/)?.[0] ?? "";
const windowsTreeKillIndex = stopChildBody.indexOf("await runTaskkill(pid)");
const gracefulSignalIndex = stopChildBody.indexOf('child.kill("SIGTERM")');
assert.ok(windowsTreeKillIndex >= 0, "Windows child cleanup must call taskkill /T");
assert.ok(
  gracefulSignalIndex < 0 || windowsTreeKillIndex < gracefulSignalIndex,
  "Windows child-tree termination must happen before signaling only the pnpm wrapper",
);
assert.match(disposableSmoke, /AggregateError/);
assert.match(apiPackage.scripts["test:prisma"], /node scripts\/smoke-supervisor\.cjs --prisma-contract-only/);
assert.match(apiPackage.scripts["smoke:disposable"], /node scripts\/smoke-supervisor\.cjs/);
assert.match(smokeSupervisor, /detached:\s*true/);
assert.match(smokeSupervisor, /SMOKE_SUPERVISOR_PARENT_PID/);
assert.match(smokeSupervisor, /SMOKE_SUPERVISOR_INTERRUPT_FILE/);
assert.match(smokeSupervisor, /SMOKE_TEST_EXIT_SUPERVISOR_AFTER_DATABASE_CREATE/);
assert.match(disposableSmoke, /--supervised-worker/);
assert.match(disposableSmoke, /monitorSupervisor/);
assert.match(disposableSmoke, /Windows disposable smoke worker requires its detached supervisor/);
assert.match(disposableSmoke, /detached:\s*process\.platform !== "win32"/);
assert.match(disposableSmoke, /waitForProcessGroupExit/);
assert.match(disposableSmoke, /process\.kill\(-pid, "SIGTERM"\)/);
assert.match(disposableSmoke, /process\.kill\(-pid, "SIGKILL"\)/);
assert.match(migrationPlan, /PRISMA_CONTRACT_DISPOSABLE_DATABASE_NAME="\$verify_db"/);
assert.match(
  migrationPlan,
  /DATABASE_URL="\$populated_url" PRISMA_CONTRACT_DISPOSABLE_DATABASE_NAME="\$populated_db" pnpm --filter api test:prisma:worker/,
);
assert.match(migrationPlan, /populated_db="\$\(new_disposable_db yourhome_prisma7_smoke\)"/);
assert.doesNotMatch(migrationPlan, /new_disposable_db yourhome_prisma7_smoke_populated/);
assert.doesNotMatch(
  migrationPlan,
  /DATABASE_URL="\$populated_url" pnpm --filter api exec tsx scripts\/prisma-contract\.ts/,
);
assert.match(migrationPlan, /node scripts\/smoke-supervisor\.cjs --prisma-contract-only/);
assert.doesNotMatch(migrationPlan, /tsx --env-file=\.env scripts\/smoke-disposable\.ts --prisma-contract-only/);
assert.doesNotMatch(
  migrationPlan,
  /DATABASE_URL="\$verify_url" pnpm --filter api exec tsx scripts\/prisma-contract\.ts/,
);
assert.match(operations, /Both `pnpm smoke:api` and `pnpm test:prisma` route through the detached outer supervisor/);
assert.match(operations, /Windows process trees or POSIX process groups/);
assert.doesNotMatch(seed, /process\.exit\(1\)/);
assert.match(seed, /process\.exitCode\s*=\s*1/);

const launcher = read("scripts/test-run.ps1");
assert.match(server, /SMOKE_DISPOSABLE_CAPABILITY/);
assert.match(server, /\/internal\/disposable-smoke-context/);
assert.match(server, /disposable database name must match DATABASE_URL for smoke capability/);
assert.match(launcher, /pnpm --filter api prisma:deploy/);
assert.match(launcher, /pnpm --filter api test:prisma:read/);
assert.doesNotMatch(launcher, /pnpm --filter api test:prisma(?:\s|['"])/);

console.log("[prisma7-config-test] PASS: Prisma 7 configuration and lifecycle contracts are present.");
