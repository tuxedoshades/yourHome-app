import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { createUploadStaticOptions, isAllowedUploadPath } from "../src/static-file-policy.js";

const fixtureRoot = await mkdtemp(path.join(tmpdir(), "yourhome-static-security-"));
const uploadsRoot = path.join(fixtureRoot, "uploads");
const privateRoot = path.join(uploadsRoot, "private");
const publicSubdirectory = path.join(uploadsRoot, "public");
const nestedRoot = path.join(uploadsRoot, "nested");
const outsideFile = path.join(fixtureRoot, "outside.txt");

await mkdir(privateRoot, { recursive: true });
await mkdir(publicSubdirectory, { recursive: true });
await mkdir(nestedRoot, { recursive: true });
await writeFile(path.join(uploadsRoot, "public.txt"), "public fixture", "utf8");
await writeFile(path.join(privateRoot, "secret.txt"), "private fixture", "utf8");
await writeFile(path.join(nestedRoot, "visible.txt"), "nested fixture", "utf8");
await writeFile(outsideFile, "outside fixture", "utf8");

assert.equal(isAllowedUploadPath("/nested/visible.txt"), true, "nested upload paths must remain available");
assert.equal(isAllowedUploadPath("/private\\secret.txt"), false, "literal backslashes must be rejected");
assert.equal(isAllowedUploadPath("/private\0secret.txt"), false, "NUL characters must be rejected");

const app = Fastify({ logger: false });
await app.register(
  fastifyStatic,
  createUploadStaticOptions(uploadsRoot, (pathname) => !pathname.startsWith("/private/")),
);

const expectRejected = async (url: string, description: string) => {
  const response = await app.inject({ method: "GET", url });
  assert.ok(
    response.statusCode >= 400 && response.statusCode < 500,
    `${description}: expected a 4xx response, received ${response.statusCode}`,
  );
  assert.notEqual(response.body, "private fixture", `${description}: private content must not be returned`);
  assert.notEqual(response.body, "outside fixture", `${description}: outside content must not be returned`);
};

try {
  await app.ready();

  const publicFile = await app.inject({ method: "GET", url: "/uploads/public.txt" });
  assert.equal(publicFile.statusCode, 200, "the canonical uploads URL must remain available");
  assert.equal(publicFile.body, "public fixture", "the canonical uploads URL must return the expected file");

  const nestedFile = await app.inject({ method: "GET", url: "/uploads/nested/visible.txt" });
  assert.equal(nestedFile.statusCode, 200, "nested uploads must remain available for future organization");
  assert.equal(nestedFile.body, "nested fixture", "nested uploads must return the expected file");

  await expectRejected("/uploads/private/secret.txt", "the canonical private path must honor allowedPath");
  await expectRejected(
    "/uploads/public/../private/secret.txt",
    "dot segments must not bypass the normalized allowedPath policy",
  );
  await expectRejected(
    "/uploads/public/%2E%2E/private/secret.txt",
    "encoded dot segments must not bypass the normalized allowedPath policy",
  );
  await expectRejected(
    "/uploads//private/secret.txt",
    "duplicate slashes must not bypass the normalized allowedPath policy",
  );
  await expectRejected(
    "/uploads/private%2Fsecret.txt",
    "encoded forward separators must not bypass route and path policy",
  );
  await expectRejected(
    "/uploads/private%5Csecret.txt",
    "encoded backslash separators must not bypass route and path policy",
  );

  await expectRejected("/uploads/../outside.txt", "dot segments must not escape the configured uploads root");
  await expectRejected(
    "/uploads/%2E%2E/outside.txt",
    "encoded dot segments must not escape the configured uploads root",
  );
  await expectRejected(
    "/uploads/public/../../outside.txt",
    "nested dot segments must not escape the configured uploads root",
  );

  console.log(
    "[static-file-security-contract] PASS: canonical uploads work and non-canonical paths cannot bypass policy or escape the static root.",
  );
} finally {
  await app.close();
  await rm(fixtureRoot, { recursive: true, force: true });
}
