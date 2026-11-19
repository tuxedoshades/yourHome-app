# YourHome Prisma 7 Migration Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Upgrade the YourHome API from resolved Prisma `6.19.2` to Prisma `7.9.0` without changing the data model or migration history, while moving to Prisma 7's generated client, PostgreSQL driver adapter, explicit configuration, and supported ESM runtime.

**Architecture:** Keep PostgreSQL 16 and the five existing SQL migrations unchanged. Move Prisma CLI settings into `apps/api/prisma.config.ts`, generate the Rust-free client into ignored source output, and expose one shared `PrismaClient` configured with `@prisma/adapter-pg`. Add static migration contracts plus a live database contract before using the migrated API in the full stack.

**Tech Stack:** Node `24.18.0`, TypeScript `5.9.x`, pnpm `10.17.1`, Prisma ORM/Client/adapter `7.9.0`, `pg` `8.22.0`, `@types/pg` `8.20.0`, `dotenv` `17.4.2`, PostgreSQL `16-alpine`, Fastify 5, PowerShell lifecycle scripts.

---

## Execution gate

This document is planning-only. Do **not** implement Prisma 7 on the currently pushed `upgrade/expo-sdk-55` branch while its signed physical-iPhone acceptance is still pending.

Recommended execution base:

1. Complete SDK-55 physical-iPhone acceptance.
2. Merge or otherwise designate the accepted SDK-55 commit as the base.
3. Create `upgrade/prisma-7` from that accepted base.
4. Confirm separately where Prisma work should be committed and pushed; never persist automatically.

If early implementation is explicitly approved, branch from `origin/upgrade/expo-sdk-55` and treat Prisma acceptance as provisional until the cumulative SDK-55 physical-iPhone gate passes.

## Current state and verified assumptions

- `apps/api/package.json` declares `^6.15.0`; the lockfile resolves `prisma` and `@prisma/client` to `6.19.2`.
- npm currently reports Prisma `7.9.0`; its Node engine is `^20.19 || ^22.12 || >=24.0`.
- Node `24.18.0` and TypeScript `5.9.x` satisfy Prisma 7 requirements.
- API package is currently CommonJS. Prisma 7 still supports explicit CommonJS generation through `moduleFormat = "cjs"`, but this plan intentionally follows Prisma's recommended ESM migration rather than compatibility mode; ESM is a design choice, not a fabricated installation requirement.
- Database is PostgreSQL `16-alpine` with a persistent Docker volume.
- `apps/api/prisma/schema.prisma` contains 11 models and no Prisma enums.
- Five tracked migrations exist. This runtime/tooling upgrade must add **no migration SQL** and modify none of those files.
- Prisma consumers are `apps/api/src/index.ts` and `apps/api/scripts/seed-demo.ts`.
- `apps/api/scripts/who-admin.js` is an ignored local helper. Do not modify or commit it; replace its local usage separately if still needed.
- Generated directories are already ignored by `**/generated/`.
- There is no repository CI workflow. Clean-generation guarantees must live in package scripts and lifecycle tests.
- `scripts/test-run.ps1` generates the client and deploys migrations before starting the API.
- API database behavior is covered indirectly by `apps/api/scripts/smoke.ts`; there is no focused Prisma contract test yet.

## Chosen design

1. **ESM API package:** deliberately choose Prisma's recommended path: set `apps/api/package.json` to `"type": "module"`; override API TypeScript settings to `ESNext`/`Bundler`/`ES2023`. If compiled-runtime acceptance exposes an unresolvable repository incompatibility, reconsider explicit `moduleFormat = "cjs"` through review rather than silently mixing module formats.
2. **New generator:** use `provider = "prisma-client"` with output `../src/generated/prisma` and ESM `.js` import specifiers.
3. **Explicit CLI config:** add `apps/api/prisma.config.ts`; move `DATABASE_URL`, schema path, migration path, and seed command there.
4. **Driver adapter:** add direct `@prisma/adapter-pg@7.9.0` and `pg@8.22.0` runtime dependencies plus `@types/pg@8.20.0`; instantiate Prisma through one shared module.
5. **Pool behavior:** preserve a finite 5-second connection timeout, Prisma 6's 300-second idle timeout, and an explicit pool size (local default 10) because Prisma 7 adopts `pg` driver defaults rather than Prisma 6 engine defaults.
6. **Generated output:** keep generated code ignored; every clean build runs `prisma generate` before `tsc`.
7. **No data-model change:** do not run `prisma migrate dev` for this upgrade and do not create a migration directory.
8. **Test-first:** add a red static configuration contract and a red live database contract before completing implementation.

## Files expected to change

**Create**

- `apps/api/prisma.config.ts`
- `apps/api/src/lib/prisma.ts`
- `apps/api/scripts/prisma7-config-test.cjs`
- `apps/api/scripts/prisma-contract.ts`
- `apps/api/tsconfig.scripts.json`

**Modify**

- `apps/api/package.json`
- `apps/api/tsconfig.json`
- `apps/api/prisma/schema.prisma`
- `apps/api/src/index.ts`
- `apps/api/scripts/seed-demo.ts`
- `apps/api/scripts/smoke.ts`
- `apps/api/.env.example`
- `package.json`
- `scripts/test-run.ps1`
- `scripts/test-run-test.ps1`
- `README.md`
- `docs/OPERATIONS.md`
- `pnpm-lock.yaml` (only through pnpm)

**Must not change**

- `apps/api/prisma/migrations/**`
- `apps/api/prisma/migrations/migration_lock.toml`
- Production/development data except disposable contract rows that are removed in `finally`
- SDK-55 mobile files
- Ignored `apps/api/scripts/who-admin.js`

---

### Task 1: Establish the accepted base and preserve the database

**Objective:** Start from an explicitly accepted base and create reversible data/migration evidence before dependency changes.

**Files:** None.

**Step 1: Confirm the base and working tree**

```bash
git status --short --branch
git log -1 --oneline
git branch --show-current
```

Expected: accepted SDK-55 base, clean tree, and no unrelated changes.

**Step 1a: Resolve the deployment topology and connection budget**

Before dependency or runtime edits, ask whether production connects directly to PostgreSQL or through PgBouncer/another pooler, whether its TLS chain needs non-default handling, and how many connections one API instance may own. Either record deployment-specific values or obtain explicit approval for a **local-only provisional implementation** using `DATABASE_POOL_MAX=10`, `DATABASE_CONNECTION_TIMEOUT_MS=5000`, and `DATABASE_IDLE_TIMEOUT_MS=300000`. Do not deploy Prisma 7 to production while this decision is unresolved, and never disable TLS verification merely to make a test pass.

**Step 2: Ask for branch creation approval**

Recommended branch: `upgrade/prisma-7`. Do not create it without explicit approval.

**Step 3: Close launcher-owned application processes, then start only PostgreSQL**

```bash
pnpm test:close
docker compose -f infra/docker-compose.yml up -d --wait --wait-timeout 120 postgres
```

Expected: stale YourHome API/Metro/Expo process trees are closed and `yourhome-postgres` is healthy.

**Step 4: Capture a local backup and migration checksums**

```bash
mkdir -p .hermes/backups
docker exec yourhome-postgres pg_dump -U yourhome -d yourhome -Fc > .hermes/backups/prisma7-preupgrade.dump
sha256sum apps/api/prisma/migrations/*/migration.sql apps/api/prisma/migrations/migration_lock.toml > .hermes/backups/prisma7-migrations.sha256
test -s .hermes/backups/prisma7-preupgrade.dump
```

Define and run the aggregate-only fingerprint helper before any implementation:

```bash
snapshot_db() {
  local database="$1"
  local output="$2"
  : > "$output"
  for table in User EmailVerificationCode Property VerificationSubmission Listing AuditLog AuthThrottle RefreshToken UserEntitlement MaintenancePlan MaintenanceTask _prisma_migrations; do
    docker exec yourhome-postgres psql -U yourhome -d "$database" -Atc "SELECT '$table|' || count(*) || '|' || md5(COALESCE(string_agg(row_hash, '' ORDER BY row_hash), '')) FROM (SELECT md5(to_jsonb(t)::text) AS row_hash FROM \"$table\" AS t) AS rows;" >> "$output"
  done
  sort -o "$output" "$output"
}
snapshot_db yourhome .hermes/backups/prisma7-source-baseline.fingerprint
test "$(wc -l < .hermes/backups/prisma7-source-baseline.fingerprint)" -eq 12
```

Expected: non-empty ignored backup/checksum evidence and 12 aggregate fingerprint lines containing no row values.

**Step 5: Record the Prisma 6 baseline**

```bash
pnpm --filter api exec prisma version
pnpm --filter api exec prisma validate
pnpm --filter api exec prisma migrate status
pnpm --filter api build
```

Expected: Prisma `6.19.2`, valid schema, five applied migrations, and successful API build.

**Suggested commit boundary:** none; evidence is ignored. Ask before creating the implementation branch.

---

### Task 2: Add a failing Prisma 7 configuration contract

**Objective:** Make the required package, generator, config, adapter, import, and lifecycle shape executable before changing implementation.

**Files:**

- Create: `apps/api/scripts/prisma7-config-test.cjs`
- Modify: `apps/api/package.json`
- Modify: `package.json`

**Step 1: Create the static contract**

Use this structure in `apps/api/scripts/prisma7-config-test.cjs`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const apiRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(apiRoot, "../..");
const read = (relative) => fs.readFileSync(path.resolve(repoRoot, relative), "utf8");
const apiPackage = JSON.parse(read("apps/api/package.json"));

assert.equal(apiPackage.type, "module", "Prisma 7 API must use the supported ESM path");
assert.equal(apiPackage.dependencies["@prisma/client"], "7.9.0");
assert.equal(apiPackage.dependencies["@prisma/adapter-pg"], "7.9.0");
assert.equal(apiPackage.dependencies.pg, "8.22.0");
assert.equal(apiPackage.devDependencies.prisma, "7.9.0");
assert.equal(apiPackage.devDependencies["@types/pg"], "8.20.0");
assert.equal(apiPackage.devDependencies.dotenv, "17.4.2");
assert.match(apiPackage.scripts.build, /prisma:generate.*tsc/);
assert.equal(apiPackage.scripts.predev, "prisma generate");
assert.equal(apiPackage.scripts["typecheck:scripts"], "tsc -p tsconfig.scripts.json --noEmit");
assert.equal(apiPackage.scripts["prisma:deploy"], "prisma migrate deploy");
assert.equal(apiPackage.scripts["prisma:validate"], "prisma validate");

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
assert.doesNotMatch(server, /from "@prisma\/client"/);
assert.doesNotMatch(seed, /from "@prisma\/client"/);
assert.match(server, /from "\.\/lib\/prisma\.js"/);
assert.match(seed, /from "\.\.\/src\/lib\/prisma\.js"/);
assert.match(server, /SIGTERM/);
assert.match(prismaModule, /DATABASE_IDLE_TIMEOUT_MS\s*\?\?\s*"300000"/);
assert.match(prismaModule, /idleTimeoutMillis/);

const launcher = read("scripts/test-run.ps1");
assert.match(launcher, /pnpm --filter api prisma:deploy/);
assert.match(launcher, /pnpm --filter api test:prisma:read/);

console.log("[prisma7-config-test] PASS: Prisma 7 configuration and lifecycle contracts are present.");
```

**Step 2: Add scripts**

In `apps/api/package.json`:

```json
"test:prisma-config": "node scripts/prisma7-config-test.cjs"
```

In root `package.json`:

```json
"test:prisma-config": "pnpm --filter api test:prisma-config"
```

**Step 3: Run the test and verify RED**

```bash
pnpm test:prisma-config
```

Expected: FAIL first on `type` being `commonjs` or missing Prisma 7 dependencies/config.

**Step 4: Verify no unrelated file changed**

```bash
git status --short
git diff --check
```

**Suggested commit:** `test(api): add Prisma 7 migration contract` — only after explicit approval.

---

### Task 3: Upgrade packages and convert the API package to ESM

**Objective:** Install one aligned Prisma 7.9.0 toolchain and satisfy its runtime/module prerequisites.

**Files:**

- Modify: `apps/api/package.json`
- Modify: `apps/api/tsconfig.json`
- Create: `apps/api/tsconfig.scripts.json`
- Modify: `pnpm-lock.yaml`

**Step 1: Update dependencies through pnpm**

```bash
pnpm --filter api add --save-exact @prisma/client@7.9.0 @prisma/adapter-pg@7.9.0 pg@8.22.0
pnpm --filter api add --save-exact --save-dev prisma@7.9.0 @types/pg@8.20.0 dotenv@17.4.2
```

Do not hand-edit `pnpm-lock.yaml`.

**Step 2: Set the API package module type**

Change `apps/api/package.json` from:

```json
"type": "commonjs"
```

to:

```json
"type": "module"
```

**Step 3: Override API compiler settings**

Use:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler"
  },
  "include": ["src"]
}
```

Do not change the root TypeScript module mode; only the API package needs this migration.

**Step 4: Type-check API operational scripts explicitly**

Create `apps/api/tsconfig.scripts.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "."
  },
  "include": ["src/**/*.ts", "scripts/**/*.ts"]
}
```

Add to `apps/api/package.json`:

```json
"typecheck:scripts": "tsc -p tsconfig.scripts.json --noEmit"
```

This closes the existing gap where `seed-demo.ts`, `smoke.ts`, and migration contracts are outside the normal API build.

**Step 5: Re-run the contract**

```bash
pnpm test:prisma-config
```

Expected: still FAIL because schema, config, and imports have not been migrated yet.

**Step 6: Inspect dependency alignment**

```bash
pnpm --filter api list prisma @prisma/client @prisma/adapter-pg pg @types/pg dotenv --depth 0
```

Expected: exact versions `7.9.0`, `7.9.0`, `7.9.0`, `8.22.0`, `8.20.0`, and `17.4.2`.

---

### Task 4: Move Prisma CLI and generator configuration to Prisma 7

**Objective:** Generate the new Rust-free client into an explicit ignored output path and load datasource/seed settings through `prisma.config.ts`.

**Files:**

- Create: `apps/api/prisma.config.ts`
- Modify: `apps/api/prisma/schema.prisma:1-8`
- Modify: `apps/api/package.json:6-15`

**Step 1: Create `apps/api/prisma.config.ts`**

```ts
import "dotenv/config";
import { defineConfig } from "prisma/config";

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx scripts/seed-demo.ts",
  },
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
```

The config belongs beside `apps/api/package.json`, where filtered Prisma commands run. Non-throwing `process.env` access is deliberate: clean `prisma generate`/build workflows do not need a database and must work without `.env`; migrate/studio commands still require `DATABASE_URL`.

**Step 2: Replace only the schema header**

```prisma
generator client {
  provider               = "prisma-client"
  output                 = "../src/generated/prisma"
  moduleFormat           = "esm"
  generatedFileExtension = "ts"
  importFileExtension    = "js"
}

datasource db {
  provider = "postgresql"
}
```

Do not change any model, relation, index, default, field, or migration.

**Step 3: Centralize API Prisma scripts**

Ensure `apps/api/package.json` contains:

```json
"build": "pnpm prisma:generate && tsc -p tsconfig.json",
"predev": "prisma generate",
"prisma:generate": "prisma generate",
"prisma:validate": "prisma validate",
"prisma:migrate": "prisma migrate dev",
"prisma:deploy": "prisma migrate deploy",
"prisma:status": "prisma migrate status",
"prisma:studio": "prisma studio",
"prisma:seed": "pnpm prisma:generate && prisma db seed",
"seed:demo": "pnpm prisma:generate && tsx --env-file=.env scripts/seed-demo.ts",
"typecheck:scripts": "tsc -p tsconfig.scripts.json --noEmit"
```

`predev`, build, seed, and focused test entry points must generate explicitly because `src/generated/prisma` is ignored and Prisma 7 no longer auto-generates during migrate/seed workflows. Do not use `postinstall` while the Prisma CLI remains a dev dependency; production-only installs would not have the generator available.

**Step 4: Validate and generate**

```bash
pnpm --filter api prisma:validate
pnpm --filter api prisma:generate
```

Expected: valid schema and generated TypeScript under `apps/api/src/generated/prisma/`.

**Step 5: Verify generated code stays ignored**

```bash
git status --short --untracked-files=all
git check-ignore apps/api/src/generated/prisma/client.ts
```

Expected: generated files do not appear in Git status and `git check-ignore` identifies the generated ignore rule.

**Step 6: Prove migrations were untouched**

```bash
sha256sum -c .hermes/backups/prisma7-migrations.sha256
git diff --exit-code -- apps/api/prisma/migrations
```

Expected: all checksums OK and no migration diff.

---

### Task 5: Add a failing live Prisma adapter contract

**Objective:** Define minimum real-database behavior before replacing application client construction.

**Files:**

- Create: `apps/api/scripts/prisma-contract.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json`

**Step 1: Create `apps/api/scripts/prisma-contract.ts`**

```ts
import assert from "node:assert/strict";
import { Pool } from "pg";
import { Prisma } from "../src/generated/prisma/client.js";

const applicationName = `yourhome-prisma-contract-${process.pid}`;
process.env.DATABASE_APPLICATION_NAME = applicationName;
const { prisma } = await import("../src/lib/prisma.js");

const key = `prisma7-contract:${process.pid}:${Date.now()}`;

async function run() {
  const rows = await prisma.$queryRaw<Array<{ value: number }>>`SELECT 1::int AS value`;
  assert.equal(rows[0]?.value, 1, "PostgreSQL query adapter must return SELECT 1");

  assert.equal(new Prisma.Decimal("449000.25").toFixed(2), "449000.25");

  await prisma.authThrottle.create({
    data: { key, count: 1, windowStart: new Date() },
  });

  await prisma.$transaction(async (tx) => {
    await tx.authThrottle.update({ where: { key }, data: { count: 2 } });
    const record = await tx.authThrottle.findUnique({ where: { key } });
    assert.equal(record?.count, 2, "interactive transaction must observe its update");
  });

  const [, batchRecord] = await prisma.$transaction([
    prisma.authThrottle.update({ where: { key }, data: { count: 3 } }),
    prisma.authThrottle.findUnique({ where: { key } }),
  ]);
  assert.equal(batchRecord?.count, 3, "batch transaction must preserve statement order");

  const poolMax = Number(process.env.DATABASE_POOL_MAX ?? "10");
  const control = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const workload = Promise.all(
      Array.from({ length: poolMax + 3 }, () =>
        prisma.$queryRaw`SELECT 1::int AS value FROM pg_sleep(0.5)`,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    const result = await control.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM pg_stat_activity WHERE application_name = $1",
      [applicationName],
    );
    const activeConnections = Number(result.rows[0]?.count ?? 0);
    assert.ok(activeConnections > 0, "pool probe must observe active adapter connections");
    assert.ok(activeConnections <= poolMax, "adapter must honor pool ceiling");
    await workload;
  } finally {
    await control.end();
  }

  console.log("[prisma-contract] PASS: query, Decimal, CRUD, transaction, and pool ceiling work.");
}

run()
  .catch((error) => {
    console.error("[prisma-contract] FAIL:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.authThrottle.deleteMany({ where: { key } }).catch(() => undefined);
    await prisma.$disconnect();
  });
```

**Step 2: Add scripts**

API package:

```json
"test:prisma": "pnpm build && node scripts/smoke-supervisor.cjs --prisma-contract-only",
"test:prisma:worker": "tsx scripts/prisma-contract.ts",
"test:prisma:read": "pnpm prisma:generate && tsx --env-file=.env scripts/prisma-read-contract.ts"
```

`test:prisma:worker` is internal and must fail closed unless `DATABASE_URL` and `PRISMA_CONTRACT_DISPOSABLE_DATABASE_NAME` identify the same strict-prefix disposable database. The public `test:prisma` command owns database creation, migration deployment, worker execution, descendant cleanup, and database deletion.

Root package:

```json
"test:prisma": "pnpm --filter api test:prisma"
```

**Step 3: Run and verify RED**

```bash
pnpm test:prisma
```

Expected: FAIL because `apps/api/src/lib/prisma.ts` does not yet exist.

---

### Task 6: Implement the shared PostgreSQL adapter client and migrate consumers

**Objective:** Replace all tracked direct `@prisma/client` construction with one explicit Prisma 7 adapter client.

**Files:**

- Create: `apps/api/src/lib/prisma.ts`
- Modify: `apps/api/src/index.ts:1-15,3309-3324`
- Modify: `apps/api/scripts/seed-demo.ts:1-5`
- Modify: `apps/api/scripts/smoke.ts:1-100`
- Modify: `apps/api/.env.example`

**Step 1: Create `apps/api/src/lib/prisma.ts`**

```ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const poolMax = Number(process.env.DATABASE_POOL_MAX ?? "10");
const connectionTimeoutMillis = Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? "5000");
const idleTimeoutMillis = Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? "300000");
if (!Number.isInteger(poolMax) || poolMax < 1) {
  throw new Error("DATABASE_POOL_MAX must be a positive integer");
}
if (!Number.isInteger(connectionTimeoutMillis) || connectionTimeoutMillis < 1) {
  throw new Error("DATABASE_CONNECTION_TIMEOUT_MS must be a positive integer");
}
if (!Number.isInteger(idleTimeoutMillis) || idleTimeoutMillis < 1) {
  throw new Error("DATABASE_IDLE_TIMEOUT_MS must be a positive integer");
}

const adapter = new PrismaPg({
  connectionString: databaseUrl,
  max: poolMax,
  connectionTimeoutMillis,
  idleTimeoutMillis,
  application_name: process.env.DATABASE_APPLICATION_NAME ?? "yourhome-api",
});

export const prisma = new PrismaClient({ adapter });
```

**Step 2: Migrate the API server import**

In `apps/api/src/index.ts`:

```ts
import { prisma } from "./lib/prisma.js";
```

Remove:

```ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
```

Preserve the existing `SIGINT` disconnect behavior and add equivalent `SIGTERM` cleanup so the adapter pool is closed on normal service termination. Ensure each signal handler runs only once.

**Step 3: Migrate the seed imports**

In `apps/api/scripts/seed-demo.ts`:

```ts
import { Prisma } from "../src/generated/prisma/client.js";
import { prisma } from "../src/lib/prisma.js";
```

Remove its direct `PrismaClient` import and construction. Preserve the existing `finally` disconnect.

**Step 3a: Cover the real email-confirmation batch transaction in disposable API smoke**

In `apps/api/scripts/smoke.ts`, add `unlinkSync` to the existing `node:fs` import. Immediately after homeowner registration and before admin login, add:

```ts
  const emailVerificationStart = await http<{
    delivery?: { mode?: string; filePath?: string };
  }>("/verification/email/start", {
    method: "POST",
    body: JSON.stringify({ email: homeownerEmail }),
  });
  assert(emailVerificationStart.status === 202, `email verification start expected 202, got ${emailVerificationStart.status}`);
  const delivery = emailVerificationStart.data.delivery;
  assert(delivery?.mode === "local_outbox", "disposable smoke must use local email outbox");
  const outboxFile = delivery.filePath;
  assert(outboxFile && existsSync(outboxFile), "email verification outbox file must exist");

  let verificationCode = "";
  try {
    const outbox = JSON.parse(readFileSync(outboxFile, "utf8")) as { code?: unknown };
    assert(typeof outbox.code === "string" && outbox.code.length === 6, "outbox must contain a six-digit verification code");
    verificationCode = outbox.code;
  } finally {
    if (existsSync(outboxFile)) unlinkSync(outboxFile);
  }
  assert(verificationCode.length === 6, "verification code must be loaded before confirmation");

  const emailVerificationConfirm = await http<{ verified?: boolean }>("/verification/email/confirm", {
    method: "POST",
    body: JSON.stringify({ email: homeownerEmail, code: verificationCode }),
  });
  assert(emailVerificationConfirm.status === 200 && emailVerificationConfirm.data.verified, `email verification confirm expected 200, got ${emailVerificationConfirm.status}`);
```

Renumber the later smoke comments. This validates the exact array-form `$transaction` path in `POST /verification/email/confirm`, not only a synthetic adapter transaction. Run it only against the disposable smoke database, with SMTP disabled so no real email is sent.

**Step 4: Document optional pool settings**

Append to `apps/api/.env.example`:

```dotenv
DATABASE_POOL_MAX="10"
DATABASE_CONNECTION_TIMEOUT_MS="5000"
DATABASE_IDLE_TIMEOUT_MS="300000"
DATABASE_APPLICATION_NAME="yourhome-api"
```

Do not add a real database URL or credentials.

**Step 5: Run the guarded disposable live contract GREEN**

With PostgreSQL healthy:

```bash
pnpm test:prisma
```

Expected: the public command creates a `yourhome_prisma7_smoke_*` database, deploys all five migrations there, passes query, Decimal, CRUD, transaction, pool, cleanup, and disconnect checks, and removes the database. It must not write to the configured persistent database.

**Step 5a: Prove connection failure honors the configured timeout**

```bash
failure_db="yourhome_prisma7_smoke_1000000000000_1000"
failure_url="$(DATABASE_HOST=192.0.2.1 DATABASE_NAME="$failure_db" node --env-file=apps/api/.env -e 'const url = new URL(process.env.DATABASE_URL); url.hostname = process.env.DATABASE_HOST; url.pathname = `/${process.env.DATABASE_NAME}`; process.stdout.write(url.toString())')"
set +e
DATABASE_URL="$failure_url" PRISMA_CONTRACT_DISPOSABLE_DATABASE_NAME="$failure_db" DATABASE_CONNECTION_TIMEOUT_MS=1000 timeout 5s pnpm --filter api test:prisma:worker
status=$?
set -e
unset failure_db failure_url
test "$status" -ne 0 -a "$status" -ne 124
```

Expected: the probe fails with a database connection error before the outer five-second timeout; exit `124` is a failure because it means the adapter timeout was not honored.

**Step 6: Run static contract GREEN**

```bash
pnpm test:prisma-config
pnpm --filter api typecheck:scripts
```

If this still fails, fix the implementation rather than weakening the contract.

**Step 7: Compile the generated ESM client and API**

```bash
pnpm --filter api build
node --check apps/api/dist/index.js
```

Expected: successful generate/compile and valid ESM JavaScript.

**Local helper note:** ignored `apps/api/scripts/who-admin.js` will no longer be compatible with `require("@prisma/client")`. Do not edit it during the migration. If the user still needs it, replace it later with a tracked `tsx --env-file=.env` script that imports `src/lib/prisma.js`.

**Suggested commit:** `feat(api): migrate Prisma runtime to version 7` — only after explicit approval.

---

### Task 7: Integrate Prisma 7 verification into the full-stack lifecycle

**Objective:** Ensure clean Test runs generate, deploy, and exercise the Prisma 7 adapter before API startup.

**Files:**

- Modify: `scripts/test-run.ps1:426-432`
- Modify: `scripts/test-run-test.ps1:50-150`

**Step 1: Write failing launcher assertions**

Update `scripts/test-run-test.ps1` to require:

```powershell
'& pnpm --filter api prisma:generate'
'& pnpm --filter api prisma:deploy'
'& pnpm --filter api test:prisma:read'
```

Also load `apps/api/package.json` and assert:

- `build` runs generation before `tsc`;
- `prisma:deploy` is exactly `prisma migrate deploy`;
- `test:prisma` is guarded and disposable, while `test:prisma:read` is the persistent-database preflight.

Replace the obsolete failure message about unlocking a Windows Prisma query-engine DLL. Prisma 7's generated runtime is Rust-engine-free; retain the ordering assertion because the stale API must stop before source generation so no owned process continues using an outdated generated client.

Run:

```bash
pnpm test:run:check
```

Expected: FAIL until the launcher uses the new scripts.

**Step 2: Centralize launcher commands**

Keep the stale API stopped before generation, then use:

```powershell
& pnpm --filter api prisma:generate
if ($LASTEXITCODE -ne 0) { throw 'Prisma client generation failed.' }
& pnpm --filter api prisma:deploy
if ($LASTEXITCODE -ne 0) { throw 'Prisma migration failed.' }
& pnpm --filter api test:prisma:read
if ($LASTEXITCODE -ne 0) { throw 'Prisma read-only adapter contract failed.' }
```

Do not add `migrate dev` to Test run.

**Step 3: Run launcher contracts GREEN**

```bash
pnpm test:prisma-config
pnpm test:run:check
```

Expected: both pass.

**Step 4: Verify no broad process or database cleanup was introduced**

Review the focused diff in `scripts/test-run.ps1` and `scripts/test-run-test.ps1`; lifecycle ownership behavior must remain unchanged.

---

### Task 8: Validate all five migrations against a disposable database

**Objective:** Prove a clean PostgreSQL database can reach the current schema with the unchanged migration history and then execute Prisma 7 runtime behavior.

**Files:** None.

**Step 1: Define guarded disposable-database helpers and create a unique database**

Run the remaining Task 8 steps in the same Git Bash shell so the cleanup trap remains active:

```bash
new_disposable_db() {
  local prefix="$1"
  case "$prefix" in yourhome_prisma7_smoke_*) ;; *) printf '%s\n' "Unsafe database prefix: $prefix" >&2; return 1 ;; esac
  local name="${prefix}_$(date +%Y%m%d%H%M%S)_$$"
  test -z "$(docker exec yourhome-postgres psql -U yourhome -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '$name'")" || { printf '%s\n' "Refusing database collision: $name" >&2; return 1; }
  docker exec yourhome-postgres createdb -U yourhome "$name" >/dev/null
  printf '%s' "$name"
}

database_url_for() {
  local name="$1"
  case "$name" in yourhome_prisma7_smoke_*) ;; *) printf '%s\n' "Unsafe database name: $name" >&2; return 1 ;; esac
  DATABASE_NAME="$name" node --env-file=apps/api/.env -e 'const url = new URL(process.env.DATABASE_URL); url.pathname = `/${process.env.DATABASE_NAME}`; process.stdout.write(url.toString())'
}

drop_disposable_db() {
  local name="$1"
  case "$name" in yourhome_prisma7_smoke_*) ;; *) printf '%s\n' "Refusing unsafe drop: $name" >&2; return 1 ;; esac
  docker exec yourhome-postgres dropdb --if-exists -U yourhome "$name"
}

export verify_db="$(new_disposable_db yourhome_prisma7_smoke)"
cleanup_verify() { drop_disposable_db "$verify_db"; }
trap cleanup_verify EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
export verify_url="$(database_url_for "$verify_db")"
```

Never print `verify_url`, pre-delete a database to make this step pass, or weaken the `yourhome_prisma7_smoke_` prefix guard.

**Step 2: Deploy the unchanged history**

```bash
DATABASE_URL="$verify_url" pnpm --filter api prisma:deploy
DATABASE_URL="$verify_url" pnpm --filter api prisma:status
```

Expected: all five migrations applied; database schema is up to date.

**Step 2a: Prove the deployed schema has zero model drift**

```bash
DATABASE_URL="$verify_url" pnpm --filter api exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

Expected: exit `0` and no SQL diff.

**Step 3: Run the adapter contract against the disposable database**

```bash
DATABASE_URL="$verify_url" PRISMA_CONTRACT_DISPOSABLE_DATABASE_NAME="$verify_db" pnpm --filter api test:prisma:worker
```

Expected: PASS and no remaining `prisma7-contract:*` row. This is an internal-worker rehearsal and is safe only because the same guarded helper created `verify_db`, its strict-prefix name matches `verify_url`, and the cleanup trap owns that database. Routine use must go through public `pnpm test:prisma`, which owns creation and cleanup itself.

**Step 4: Exercise the explicit seed path only on disposable data**

```bash
DATABASE_URL="$verify_url" pnpm --filter api prisma:seed
```

Expected: demo seed completes and disconnects. Do not run this acceptance probe against the preserved `yourhome` database because the current seed writes audit entries.

**Step 5: Verify migration immutability again**

```bash
sha256sum -c .hermes/backups/prisma7-migrations.sha256
git diff --exit-code -- apps/api/prisma/migrations
```

**Step 6: Drop only the guarded disposable database and clear the trap**

```bash
cleanup_verify
trap - EXIT INT TERM
unset verify_db verify_url
```

Never drop or reset the `yourhome` database or its Docker volume.

---

### Task 9: Validate a restored populated clone and preserve development data

**Objective:** Restore the pre-upgrade dump to a separate database, prove the populated contents are identical before and after Prisma 7 deployment, and leave the original `yourhome` database untouched.

**Files:** None unless a genuine compatibility bug is found.

**Step 1: Reuse the aggregate-only database fingerprint helper**

Run from Git Bash. Re-declare `snapshot_db` from Task 1 and the guarded `new_disposable_db`, `database_url_for`, and `drop_disposable_db` helpers from Task 8 if the shell session changed. The fingerprint helper records only table names, row counts, and hashes—not row contents.

```bash
snapshot_db() {
  local database="$1"
  local output="$2"
  : > "$output"
  for table in User EmailVerificationCode Property VerificationSubmission Listing AuditLog AuthThrottle RefreshToken UserEntitlement MaintenancePlan MaintenanceTask _prisma_migrations; do
    docker exec yourhome-postgres psql -U yourhome -d "$database" -Atc "SELECT '$table|' || count(*) || '|' || md5(COALESCE(string_agg(row_hash, '' ORDER BY row_hash), '')) FROM (SELECT md5(to_jsonb(t)::text) AS row_hash FROM \"$table\" AS t) AS rows;" >> "$output"
  done
  sort -o "$output" "$output"
}
```

**Step 2: Prove the preserved source still matches its pre-implementation baseline**

```bash
snapshot_db yourhome .hermes/backups/prisma7-source-current.fingerprint
diff -u .hermes/backups/prisma7-source-baseline.fingerprint .hermes/backups/prisma7-source-current.fingerprint
```

Expected: no differences; no field values or credentials are printed.

**Step 3: Restore the backup into a separate populated clone**

```bash
export populated_db="$(new_disposable_db yourhome_prisma7_smoke)"
cleanup_populated() { drop_disposable_db "$populated_db"; }
trap cleanup_populated EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
export populated_url="$(database_url_for "$populated_db")"
docker exec -i yourhome-postgres pg_restore -U yourhome -d "$populated_db" --no-owner --no-privileges < .hermes/backups/prisma7-preupgrade.dump
snapshot_db "$populated_db" .hermes/backups/prisma7-clone-before.fingerprint
diff -u .hermes/backups/prisma7-source-baseline.fingerprint .hermes/backups/prisma7-clone-before.fingerprint
```

Expected: restore succeeds and source/clone fingerprints are identical.

**Step 4: Deploy Prisma 7 tooling to the populated clone**

```bash
DATABASE_URL="$populated_url" pnpm --filter api prisma:deploy
DATABASE_URL="$populated_url" pnpm --filter api prisma:status
DATABASE_URL="$populated_url" pnpm --filter api exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

Expected: no pending migration, zero schema diff, and no generated SQL.

**Step 5: Prove deployment preserved populated content**

```bash
snapshot_db "$populated_db" .hermes/backups/prisma7-clone-after.fingerprint
diff -u .hermes/backups/prisma7-source-baseline.fingerprint .hermes/backups/prisma7-clone-after.fingerprint
```

Expected: fingerprints remain identical after deployment.

**Step 6: Run read/write runtime behavior only against the clone**

```bash
DATABASE_URL="$populated_url" PRISMA_CONTRACT_DISPOSABLE_DATABASE_NAME="$populated_db" pnpm --filter api test:prisma:worker
```

Expected: PASS and the temporary contract row is removed. The worker accepts this internal rehearsal only because the guarded clone name, URL database, explicit context, and cleanup trap agree exactly. Re-run the fingerprint comparison afterward; it must still match.

**Step 7: Drop only the guarded populated clone and clear the trap**

```bash
cleanup_populated
trap - EXIT INT TERM
unset populated_db populated_url
```

Do not seed, smoke-test, reset, drop, or directly migrate the preserved `yourhome` database outside the normal launcher preflight.

---

### Task 10: Run clean-build, API, and full-stack acceptance

**Objective:** Verify the exact final tree in clean-generation, compiled, API, Android, web, and iOS development-client paths.

**Files:** None unless a verified failure requires a scoped fix.

**Step 1: Run focused gates**

```bash
pnpm install --frozen-lockfile
pnpm test:prisma-config
pnpm --filter api prisma:validate
pnpm --filter api prisma:generate
pnpm --filter api typecheck:scripts
pnpm test:prisma
pnpm test:run:check
```

Expected: all pass.

**Step 2: Prove generation is not accidentally relying on stale files**

Delete only ignored generated output, then rebuild:

```bash
rm -rf apps/api/src/generated/prisma
DATABASE_URL='' pnpm --filter api build
```

Expected: build regenerates the client and succeeds without a datasource URL. Confirm the path is ignored and no tracked file was removed.

**Step 3: Run repository quality gates**

```bash
pnpm run build
pnpm run lint
pnpm run format
git diff --check
git diff --cached --check
```

Note in the report that current lint/format scripts are placeholders.

**Step 4: Run API smoke against a disposable database**

Re-declare the guarded Task 8 helpers if the shell session changed, then run:

```bash
export smoke_db="$(new_disposable_db yourhome_prisma7_smoke)"
export compiled_api_pid_file=".hermes/runtime/prisma7-compiled-api.pid"
mkdir -p "$(dirname "$compiled_api_pid_file")"
stop_compiled_api() {
  if test -f "$compiled_api_pid_file"; then
    local api_pid
    api_pid="$(<"$compiled_api_pid_file")"
    kill -TERM "$api_pid" 2>/dev/null || true
    for _ in $(seq 1 100); do
      kill -0 "$api_pid" 2>/dev/null || break
      sleep 0.1
    done
    ! kill -0 "$api_pid" 2>/dev/null || { printf '%s\n' "Compiled API did not stop after SIGTERM: $api_pid" >&2; return 1; }
    rm -f "$compiled_api_pid_file"
  fi
}
cleanup_smoke() { stop_compiled_api || return 1; drop_disposable_db "$smoke_db"; }
trap cleanup_smoke EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
export smoke_url="$(database_url_for "$smoke_db")"
DATABASE_URL="$smoke_url" pnpm --filter api prisma:deploy
```

Start the **compiled API** in a Hermes-managed background terminal (not with shell `&`) whose workdir is `apps/api` using:

```bash
printf '%s' "$$" > ../../.hermes/runtime/prisma7-compiled-api.pid
exec env DATABASE_URL="$smoke_url" SMTP_URL='' SMTP_HOST='' node --env-file=.env dist/index.js
```

Pass the exported variable to the Hermes-managed terminal without logging or expanding its value in the report. `--env-file=.env` supplies the normal API secrets/configuration; the pre-set disposable `DATABASE_URL` wins over `.env`, and empty SMTP variables force local-outbox delivery so the smoke test sends no real email.

After `/health` is ready, run:

```bash
pnpm smoke:api
```

Expected: the compiled ESM API starts successfully and smoke passes against the unique smoke database. This is the runtime-resolution check that `node --check` cannot provide.

Send `SIGTERM` to the exact recorded API PID, wait for the Hermes-managed process to exit, and prove the adapter released its pool:

```bash
stop_compiled_api
remaining_sessions="$(docker exec yourhome-postgres psql -U yourhome -d postgres -Atc "SELECT count(*) FROM pg_stat_activity WHERE datname = '$smoke_db' AND application_name = 'yourhome-api'")"
test "$remaining_sessions" -eq 0
unset remaining_sessions
```

Expected: the process exits within ten seconds through its one-shot `SIGTERM` handler, logs no shutdown error, and leaves zero matching PostgreSQL sessions. Then clean up through the guarded function and clear the trap:

```bash
cleanup_smoke
trap - EXIT INT TERM
unset smoke_db smoke_url compiled_api_pid_file
```

**Step 5: Run the full local stack**

```bash
pnpm test:run
```

Required checks:

- PostgreSQL healthy and all migrations applied;
- Prisma contract passes before API starts;
- API `/health` reports success;
- Android shows normal YourHome UI visibly;
- web shows normal YourHome UI visibly with no runtime errors;
- iOS development-client tunnel manifest and bundle work;
- normal YourHome UI is visibly open on the physical iPhone if Apple signing access is available.

Per YourHome acceptance policy, tunnel/manifest/bundle evidence alone is not a completed full Test run. If Apple access is still unavailable, report Prisma backend/Android/web validation as passing but leave cumulative physical-iPhone acceptance pending.

**Step 6: Close the stack safely**

```bash
pnpm test:close
```

Expected: launcher-owned API/Metro/Expo processes and PostgreSQL stop; reused emulator behavior and database volume preservation remain unchanged.

---

### Task 11: Update developer documentation

**Objective:** Replace stale Prisma 6-era instructions with the explicit Prisma 7 workflow and safety boundary.

**Files:**

- Modify: `README.md:80-88`
- Modify: `docs/OPERATIONS.md:3-15`

**Step 1: Update README migration commands**

Document:

```powershell
pnpm --filter api prisma:validate
pnpm --filter api prisma:generate
pnpm --filter api prisma:deploy
pnpm --filter api prisma:migrate -- --name <descriptive-name> # only for intentional model changes
pnpm --filter api prisma:seed
```

Explicitly state that the Prisma 7 runtime upgrade itself does not create a migration.

**Step 2: Update operations commands**

Add:

- Prisma config contract: `pnpm test:prisma-config`
- Prisma guarded disposable write/adapter contract: `pnpm test:prisma`
- Prisma persistent read-only preflight: `pnpm --filter api test:prisma:read`
- Migration status: `pnpm --filter api prisma:status`
- Deploy existing migrations: `pnpm --filter api prisma:deploy`
- Seed: `pnpm --filter api prisma:seed`
- Pool parity settings: `DATABASE_POOL_MAX`, `DATABASE_CONNECTION_TIMEOUT_MS`, and `DATABASE_IDLE_TIMEOUT_MS`

**Step 3: Document generated-client behavior**

State that `apps/api/src/generated/prisma` is ignored and must be produced through `prisma:generate` or API `build` on every clean checkout/build.

**Step 4: Run documentation/source contracts**

```bash
pnpm test:prisma-config
pnpm test:run:check
git diff --check
```

**Suggested commit:** `docs(api): document Prisma 7 operations` — only after explicit approval.

---

### Task 12: Independent review and persistence decision

**Objective:** Obtain independent evidence on data safety, ESM/runtime behavior, and lifecycle integration before any persistence action.

**Files:** None unless reviewers find a blocker.

**Step 1: Request three read-only reviews in parallel**

1. Prisma 7 config/generator/adapter/ESM correctness.
2. Migration/data preservation and disposable-database evidence.
3. Windows lifecycle, clean-generation, and full-stack regression coverage.

**Step 2: Fix every blocker with RED/GREEN evidence**

Do not weaken tests to accept incorrect behavior. Re-run the focused gate after each fix and then the full gate once.

**Step 3: Final security and artifact audit**

Verify:

- no `.env`, credentials, dump files, generated client, screenshots, or temporary databases are tracked;
- no migration SQL changed;
- no package version skew exists among `prisma`, `@prisma/client`, and `@prisma/adapter-pg`, and direct `pg`/`@types/pg` versions match the reviewed plan;
- local backup remains ignored;
- working tree contains only approved Prisma migration files.

**Step 4: Rehearse the application-only rollback**

Record the accepted pre-upgrade commit. In a temporary Git worktree at that commit, perform a frozen install, generate the Prisma 6 client, build the API, and run its health check against a freshly restored populated clone. The rollback must not apply reverse SQL or modify migration history.

Expected rollback procedure:

1. Stop the API process tree.
2. Restore the accepted pre-Prisma-7 application revision and lockfile.
3. Run `pnpm install --frozen-lockfile` and `pnpm --filter api prisma:generate`.
4. Run `pnpm --filter api build`.
5. Restart the API with the unchanged `DATABASE_URL`.
6. Verify `/health` and normal read behavior.

**Step 5: Ask the user where to persist**

Present explicit choices:

- leave changes uncommitted;
- create local commits only;
- push `upgrade/prisma-7`;
- prepare a PR after acceptance.

Never commit, push, or open a PR without the user's explicit selection.

---

## Acceptance checklist

- [ ] Execution starts from an explicitly accepted SDK-55 base.
- [ ] Prisma packages are aligned exactly at `7.9.0`.
- [ ] Direct `pg@8.22.0` and `@types/pg@8.20.0` are installed.
- [ ] Node/TypeScript versions satisfy Prisma 7.
- [ ] API package uses ESM and compiled output starts successfully.
- [ ] `prisma-client` generates to ignored `apps/api/src/generated/prisma`.
- [ ] Clean API build regenerates before TypeScript compilation.
- [ ] `prisma.config.ts` owns datasource, schema, migrations, and seed configuration.
- [ ] Runtime uses `@prisma/adapter-pg` through one shared client.
- [ ] Connection pool max, connection timeout, and 300-second idle timeout are explicit; pool/timeout contracts pass.
- [ ] Compiled API handles POSIX `SIGTERM` and directly delivered Windows `SIGBREAK`. Windows cross-terminal launchers use the documented exact-tree force-termination fallback and verify child-tree exit before disposable database cleanup.
- [ ] Static Prisma 7 contract passes.
- [ ] Live query/Decimal/CRUD/transaction contract passes and cleans up.
- [ ] All five existing migrations apply to a disposable database.
- [ ] Blank-database schema diff is zero.
- [ ] Restored populated-clone fingerprints match before and after deployment.
- [ ] Existing migration files and checksums are unchanged.
- [ ] Existing development database remains intact and queryable.
- [ ] API smoke passes.
- [ ] Root build and lifecycle checks pass.
- [ ] Android and web visibly render normal YourHome UI.
- [ ] Physical-iPhone full-stack acceptance is either passed or explicitly still Apple-gated.
- [ ] Independent reviews report no blockers.
- [ ] Application-only rollback is rehearsed without reverse SQL.
- [ ] User explicitly chooses persistence destination.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| ESM conversion breaks compiled API startup | Scope ESM overrides to `apps/api`, use `.js` relative specifiers, run `node --check`, compiled startup, and smoke tests. |
| Generated client is absent on a clean checkout | Keep it ignored but make API `build` run `prisma generate` before `tsc`; test after deleting ignored output. |
| Prisma 7 no longer loads `.env` implicitly | Use `import "dotenv/config"` in `prisma.config.ts`; retain explicit `tsx --env-file=.env` runtime scripts. |
| Adapter pool behavior differs from Prisma 6 | Preserve explicit local defaults: pool max `10`, connection timeout `5000ms`, and idle timeout `300000ms`; resolve production connection budget/pooler/TLS settings before implementation or limit the branch to local-only provisional work. |
| Runtime upgrade accidentally creates schema drift | Do not run `migrate dev`; checksum and diff all five migrations; deploy to a disposable database first. |
| Existing development data is damaged | Take ignored `pg_dump`, fingerprint data, never reset/drop `yourhome`, and only drop uniquely generated, prefix-guarded `yourhome_prisma7_smoke_*` disposable databases through cleanup traps. |
| Broad smoke test hides low-level adapter errors | Add a focused live contract for query, Decimal, CRUD, transaction, cleanup, and disconnect. |
| Ignored `who-admin.js` breaks locally | Do not touch it silently; flag it as a local-only compatibility note or replace later with explicit approval. |
| Production uses self-signed TLS/PgBouncer | Confirm deployment topology before implementation; Prisma 7 changed driver/SSL behavior and delegates pooling to `pg`. |
| Prisma work compounds unaccepted SDK-55 work | Do not execute until SDK-55 base is accepted unless user explicitly approves a stacked provisional branch. |

## Rollback strategy

This upgrade intentionally contains no DDL. Rollback is therefore **application-only**:

- retain the accepted pre-upgrade Git revision and lockfile;
- stop the Prisma 7 API before replacing application files;
- restore the accepted Prisma 6 package/config/runtime revision;
- reinstall from its frozen lockfile, regenerate Prisma 6, rebuild, and restart;
- keep PostgreSQL data, `_prisma_migrations`, and all five historical SQL files untouched;
- verify health and read behavior against a restored populated clone before relying on rollback in deployment;
- never run `migrate reset`, reverse SQL, or restore the backup over a healthy database merely to roll back application code.

## Open decisions before implementation

1. Has SDK-55 physical-iPhone acceptance completed, and which commit/branch is the accepted base?
2. Does production PostgreSQL use PgBouncer, a managed pooler, or self-signed TLS certificates?
3. Are local defaults `max=10`, connection timeout `5000ms`, and idle timeout `300000ms` acceptable, and what deployment-specific values are required before production use?
4. Should the ignored `who-admin.js` helper be retired or replaced with a tracked ESM/tsx admin-list script?
5. Where should reviewed Prisma 7 work be persisted: uncommitted, local commits, remote branch, or PR?

## Authoritative references

- Prisma 7 upgrade guide: https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7
- Prisma generators: https://www.prisma.io/docs/orm/prisma-schema/overview/generators
- Prisma Config reference: https://www.prisma.io/docs/orm/reference/prisma-config-reference
- Prisma seeding: https://www.prisma.io/docs/orm/prisma-migrate/workflows/seeding
- Prisma connection pooling: https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/connection-pool
- Prisma system requirements: https://www.prisma.io/docs/orm/reference/system-requirements
- npm `prisma@7.9.0`: https://www.npmjs.com/package/prisma/v/7.9.0
- npm `@prisma/client@7.9.0`: https://www.npmjs.com/package/@prisma/client/v/7.9.0
- npm `@prisma/adapter-pg@7.9.0`: https://www.npmjs.com/package/@prisma/adapter-pg/v/7.9.0
