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
