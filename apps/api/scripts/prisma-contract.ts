import assert from "node:assert/strict";
import { Pool } from "pg";
import { Prisma } from "../src/generated/prisma/client.js";

const disposableDatabasePattern = /^yourhome_prisma7_smoke_[0-9]+_[0-9]+$/;
const disposableDatabaseName = process.env.PRISMA_CONTRACT_DISPOSABLE_DATABASE_NAME;
assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required");
assert.ok(disposableDatabaseName, "PRISMA_CONTRACT_DISPOSABLE_DATABASE_NAME is required");
assert.match(
  disposableDatabaseName,
  disposableDatabasePattern,
  "Prisma contract requires a guarded disposable database name",
);
const targetDatabaseName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\//, ""));
assert.equal(
  targetDatabaseName,
  disposableDatabaseName,
  "disposable database name must match DATABASE_URL for the Prisma contract",
);
const testPauseMs = Number(process.env.PRISMA_CONTRACT_TEST_PAUSE_MS ?? "0");
assert.ok(
  Number.isInteger(testPauseMs) && testPauseMs >= 0 && testPauseMs <= 60_000,
  "PRISMA_CONTRACT_TEST_PAUSE_MS must be between 0 and 60000",
);

const applicationName = `yourhome-prisma-contract-${process.pid}`;
process.env.DATABASE_APPLICATION_NAME = applicationName;
const { prisma } = await import("../src/lib/prisma.js");

const key = `prisma7-contract:${process.pid}:${Date.now()}`;

async function run() {
  if (testPauseMs > 0) {
    console.log(`[prisma-contract] test pause active in worker PID ${process.pid}`);
    await new Promise((resolve) => setTimeout(resolve, testPauseMs));
  }
  const rows = await prisma.$queryRaw<{ value: number }[]>`SELECT 1::int AS value`;
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
  let workload: Promise<unknown[]> | undefined;
  try {
    workload = Promise.all(
      Array.from(
        { length: Math.min(poolMax + 3, 16) },
        () => prisma.$queryRaw`SELECT 1::int AS value FROM pg_sleep(0.5)`,
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
    if (workload) await workload.catch(() => undefined);
    await control.end();
  }

  console.log("[prisma-contract] PASS: query, Decimal, CRUD, transactions, and pool ceiling work.");
}

run()
  .catch((error) => {
    console.error("[prisma-contract] FAIL:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma.authThrottle.deleteMany({ where: { key } });
    } catch (cleanupError) {
      console.error("[prisma-contract] cleanup failed:", cleanupError);
      process.exitCode = 1;
    } finally {
      await prisma.$disconnect();
    }
  });
