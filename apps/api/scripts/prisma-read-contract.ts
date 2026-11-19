import assert from "node:assert/strict";
import { Pool } from "pg";
import { Prisma } from "../src/generated/prisma/client.js";

const applicationName = `yourhome-prisma-read-contract-${process.pid}`;
process.env.DATABASE_APPLICATION_NAME = applicationName;
const { prisma } = await import("../src/lib/prisma.js");

async function run() {
  const rows = await prisma.$queryRaw<{ value: number }[]>`SELECT 1::int AS value`;
  assert.equal(rows[0]?.value, 1, "PostgreSQL query adapter must return SELECT 1");
  assert.equal(new Prisma.Decimal("449000.25").toFixed(2), "449000.25");

  const poolMax = Number(process.env.DATABASE_POOL_MAX ?? "10");
  const probeConcurrency = Math.min(poolMax + 3, 16);
  const control = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  let workload: Promise<unknown[]> | undefined;

  try {
    workload = Promise.all(
      Array.from({ length: probeConcurrency }, () => prisma.$queryRaw`SELECT 1::int AS value FROM pg_sleep(0.5)`),
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

  console.log("[prisma-read-contract] PASS: read-only query, Decimal, and pool ceiling work.");
}

run()
  .catch((error) => {
    console.error("[prisma-read-contract] FAIL:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
