import assert from "node:assert/strict";
import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";

const TEST_SECRET = "yourhome-jwt-security-contract-secret";

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

const authorization = (token: string) => ({ authorization: `Bearer ${token}` });

const app = Fastify({ logger: false });
await app.register(fastifyJwt, { secret: TEST_SECRET });

app.get(
  "/protected",
  {
    onRequest: async (request) => {
      await request.jwtVerify();
    },
  },
  async (request) => request.user,
);

try {
  await app.ready();

  const homeownerToken = app.jwt.sign(
    { id: "homeowner-1", email: "homeowner@example.test", role: "homeowner" },
    { expiresIn: "12h" },
  );
  const reviewerToken = app.jwt.sign(
    { id: "reviewer-1", email: "reviewer@example.test", role: "reviewer" },
    { expiresIn: "12h" },
  );

  const homeowner = await app.inject({
    method: "GET",
    url: "/protected",
    headers: authorization(homeownerToken),
  });
  assert.equal(homeowner.statusCode, 200, "a valid scalar-claim token must be accepted");
  assert.deepEqual(
    { id: homeowner.json().id, email: homeowner.json().email, role: homeowner.json().role },
    { id: "homeowner-1", email: "homeowner@example.test", role: "homeowner" },
    "the verified token must retain the homeowner's claims",
  );

  const reviewer = await app.inject({
    method: "GET",
    url: "/protected",
    headers: authorization(reviewerToken),
  });
  assert.equal(reviewer.statusCode, 200, "a second valid token must be accepted");
  assert.deepEqual(
    { id: reviewer.json().id, email: reviewer.json().email, role: reviewer.json().role },
    { id: "reviewer-1", email: "reviewer@example.test", role: "reviewer" },
    "verification must not mix claims between users",
  );

  const [tamperedHeader, tamperedPayload, tamperedSignature] = homeownerToken.split(".");
  assert.ok(tamperedHeader && tamperedPayload && tamperedSignature, "the test token must have three segments");
  const replacement = tamperedSignature.startsWith("a") ? "b" : "a";
  const tamperedToken = `${tamperedHeader}.${tamperedPayload}.${replacement}${tamperedSignature.slice(1)}`;
  const tampered = await app.inject({
    method: "GET",
    url: "/protected",
    headers: authorization(tamperedToken),
  });
  assert.equal(tampered.statusCode, 401, "a token with a modified signature must be rejected");

  const unsignedToken = `${encode({ alg: "none", typ: "JWT" })}.${encode({
    id: "unsigned-user",
    email: "unsigned@example.test",
    role: "homeowner",
  })}.`;
  const unsigned = await app.inject({
    method: "GET",
    url: "/protected",
    headers: authorization(unsignedToken),
  });
  assert.equal(unsigned.statusCode, 401, "an unsigned token using the none algorithm must be rejected");

  const missing = await app.inject({ method: "GET", url: "/protected" });
  assert.equal(missing.statusCode, 401, "a missing bearer token must be rejected");

  console.log("[jwt-security-contract] PASS: JWT verification preserves identity and rejects unsafe tokens.");
} finally {
  await app.close();
}
