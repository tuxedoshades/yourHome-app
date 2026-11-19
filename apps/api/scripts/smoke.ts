import { existsSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";

const loadLocalEnv = () => {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const idx = trimmed.indexOf("=");
    const key = trimmed.slice(0, idx).trim();
    const raw = trimmed.slice(idx + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    const value = raw.replace(/^['\"]|['\"]$/g, "");
    process.env[key] = value;
  }
};

loadLocalEnv();

const disposableDatabasePattern = /^yourhome_prisma7_smoke_[0-9]+_[0-9]+$/;
const API_BASE_URL = process.env.API_BASE_URL;
const disposableDatabaseName = process.env.SMOKE_DISPOSABLE_DATABASE_NAME;
const smokeCapability = process.env.SMOKE_DISPOSABLE_CAPABILITY ?? "";
const databaseUrl = process.env.DATABASE_URL;

if (!API_BASE_URL) throw new Error("API_BASE_URL is required for the internal disposable smoke worker");
if (!disposableDatabaseName || !disposableDatabasePattern.test(disposableDatabaseName)) {
  throw new Error("SMOKE_DISPOSABLE_DATABASE_NAME must be a guarded disposable database name");
}
if (!databaseUrl) throw new Error("DATABASE_URL is required for the internal disposable smoke worker");
if (!smokeCapability || !/^[a-f0-9]{64}$/.test(smokeCapability)) {
  throw new Error("SMOKE_DISPOSABLE_CAPABILITY must be a supervisor-generated 32-byte hexadecimal capability");
}

const parsedApiBaseUrl = new URL(API_BASE_URL);
if (parsedApiBaseUrl.protocol !== "http:" || !["localhost", "127.0.0.1", "::1"].includes(parsedApiBaseUrl.hostname)) {
  throw new Error("API_BASE_URL must use HTTP on a loopback host for the disposable smoke worker");
}

const parsedDatabaseUrl = new URL(databaseUrl);
const databaseNameFromUrl = decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\//, ""));
if (databaseNameFromUrl !== disposableDatabaseName) {
  throw new Error("disposable database name must match DATABASE_URL");
}
const ADMIN_BOOTSTRAP_KEY = process.env.ADMIN_BOOTSTRAP_KEY;
const EXISTING_ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const EXISTING_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

type Json = Record<string, unknown>;

type LoginResponse = {
  token?: string;
  refreshToken?: string;
  user?: { id: string; email: string; role: string };
  error?: string;
};

const now = Date.now();
const suffix = `${now}`;
const bootstrapAdminEmail = `admin+${suffix}@yourhome.local`;
const homeownerEmail = `owner+${suffix}@yourhome.local`;
const bootstrapAdminPassword = "AdminPass!12345";
const homeownerPassword = "HomeownerPass!12345";

async function http<T = Json>(path: string, options?: RequestInit): Promise<{ status: number; data: T }> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-yourhome-smoke-capability": smokeCapability,
      ...(options?.headers ?? {}),
    },
  });

  const text = await res.text();
  const data = text ? (JSON.parse(text) as T) : ({} as T);
  return { status: res.status, data };
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${message}`);
}

async function run() {
  console.log(`Smoke test starting against ${API_BASE_URL}`);

  assert(ADMIN_BOOTSTRAP_KEY, "ADMIN_BOOTSTRAP_KEY env var is required");

  const context = await http<{ databaseName?: string }>("/internal/disposable-smoke-context");
  assert(context.status === 200, `disposable smoke target context expected 200, got ${context.status}`);
  assert(context.data.databaseName === disposableDatabaseName, "disposable smoke target database identity mismatch");

  // 1) bootstrap first admin (or fall back to existing admin credentials)
  const bootstrap = await http<{ admin?: { email: string } | null; error?: string }>("/admin/bootstrap-first", {
    method: "POST",
    headers: { "x-bootstrap-key": ADMIN_BOOTSTRAP_KEY as string },
    body: JSON.stringify({ email: bootstrapAdminEmail, password: bootstrapAdminPassword }),
  });

  let adminEmailForLogin = bootstrapAdminEmail;
  let adminPasswordForLogin = bootstrapAdminPassword;

  if (bootstrap.status === 409) {
    assert(
      EXISTING_ADMIN_EMAIL && EXISTING_ADMIN_PASSWORD,
      "Admin already exists. Set ADMIN_EMAIL and ADMIN_PASSWORD env vars for smoke login.",
    );
    adminEmailForLogin = EXISTING_ADMIN_EMAIL;
    adminPasswordForLogin = EXISTING_ADMIN_PASSWORD;
    console.log(`Admin already exists; using existing admin login: ${adminEmailForLogin}`);
  } else {
    assert(bootstrap.status === 201, `bootstrap status expected 201/409, got ${bootstrap.status}`);
    console.log(`Bootstrapped admin: ${bootstrapAdminEmail}`);
  }

  // 2) register homeowner candidate
  const regOwner = await http<{ token?: string; refreshToken?: string; user?: { id: string } }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email: homeownerEmail, password: homeownerPassword }),
  });
  assert(
    regOwner.status === 201 && regOwner.data.token && regOwner.data.refreshToken,
    `owner register expected 201, got ${regOwner.status}`,
  );

  // 2a) verify homeowner email through the local outbox
  const emailVerificationStart = await http<{
    delivery?: { mode?: string; filePath?: string };
  }>("/verification/email/start", {
    method: "POST",
    body: JSON.stringify({ email: homeownerEmail }),
  });
  assert(
    emailVerificationStart.status === 202,
    `email verification start expected 202, got ${emailVerificationStart.status}`,
  );
  const delivery = emailVerificationStart.data.delivery;
  assert(delivery?.mode === "local_outbox", "disposable smoke must use local email outbox");
  const outboxFile = delivery.filePath;
  assert(outboxFile, "email verification outbox file path must be present");
  const outboxRoot = path.resolve(process.cwd(), ".tmp", "email-outbox");
  const resolvedOutboxFile = path.resolve(outboxFile);
  const relativeOutboxPath = path.relative(outboxRoot, resolvedOutboxFile);
  assert(
    relativeOutboxPath.length > 0 && !relativeOutboxPath.startsWith("..") && !path.isAbsolute(relativeOutboxPath),
    "email verification outbox file must stay inside the local outbox directory",
  );
  assert(existsSync(resolvedOutboxFile), "email verification outbox file must exist");

  let verificationCode = "";
  try {
    const outbox = JSON.parse(readFileSync(resolvedOutboxFile, "utf8")) as { code?: unknown };
    assert(
      typeof outbox.code === "string" && outbox.code.length === 6,
      "outbox must contain a six-digit verification code",
    );
    verificationCode = outbox.code;
  } finally {
    if (existsSync(resolvedOutboxFile)) unlinkSync(resolvedOutboxFile);
  }
  assert(verificationCode.length === 6, "verification code must be loaded before confirmation");

  const emailVerificationConfirm = await http<{ verified?: boolean }>("/verification/email/confirm", {
    method: "POST",
    body: JSON.stringify({ email: homeownerEmail, code: verificationCode }),
  });
  assert(
    emailVerificationConfirm.status === 200 && emailVerificationConfirm.data.verified,
    `email verification confirm expected 200, got ${emailVerificationConfirm.status}`,
  );

  // 3) login as admin
  const adminLogin = await http<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: adminEmailForLogin, password: adminPasswordForLogin }),
  });

  assert(adminLogin.status === 200 && adminLogin.data.token, `admin login expected 200, got ${adminLogin.status}`);
  const adminToken = adminLogin.data.token;

  // 4) homeowner submits verification
  const verify = await http<{ submissionId?: string }>("/verification-submissions", {
    method: "POST",
    headers: { authorization: `Bearer ${regOwner.data.token}` },
    body: JSON.stringify({
      addressLine1: "123 Test St",
      city: "Miami",
      state: "FL",
      zip: "33101",
      docsJson: JSON.stringify({ type: "utility_bill", note: "smoke-test" }),
    }),
  });
  assert(verify.status === 201 && verify.data.submissionId, `verification submit expected 201, got ${verify.status}`);

  // 5) reviewer/admin requests more info on verification
  const verifyNeedMore = await http<{ status?: string }>(
    `/review/verification-submissions/${verify.data.submissionId}/decision`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        decision: "needs_more_info",
        reviewNotes: "Please upload a clearer and newer proof of ownership.",
      }),
    },
  );
  assert(verifyNeedMore.status === 200, `verification needs_more_info expected 200, got ${verifyNeedMore.status}`);

  // 6) homeowner resubmits verification
  const verifyResubmit = await http<{ status?: string }>(
    `/verification-submissions/${verify.data.submissionId}/resubmit`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${regOwner.data.token}` },
      body: JSON.stringify({
        docsJson: JSON.stringify({
          documentType: "property_tax_bill",
          ownerNameOnDocument: "Smoke Test Owner",
          issueDate: "2026-02-01",
          fileUrl: "https://example.com/proof.pdf",
          shortNote: "Updated with latest tax bill.",
          consentConfirmed: true,
        }),
      }),
    },
  );
  assert(verifyResubmit.status === 200, `verification resubmit expected 200, got ${verifyResubmit.status}`);

  // 7) reviewer/admin approves verification
  const approveVerification = await http<{ status?: string }>(
    `/review/verification-submissions/${verify.data.submissionId}/decision`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ decision: "approve", reviewNotes: "Verification approved after updated documents." }),
    },
  );
  assert(approveVerification.status === 200, `verification approve expected 200, got ${approveVerification.status}`);

  // 8) homeowner login (fresh claims) + refresh token rotation check
  const ownerLogin = await http<{ token?: string; refreshToken?: string; user?: { id: string } }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: homeownerEmail, password: homeownerPassword }),
  });
  assert(
    ownerLogin.status === 200 && ownerLogin.data.token && ownerLogin.data.refreshToken,
    `owner login expected 200, got ${ownerLogin.status}`,
  );

  const refresh = await http<{ token?: string; refreshToken?: string }>("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken: ownerLogin.data.refreshToken }),
  });
  assert(
    refresh.status === 200 && refresh.data.token && refresh.data.refreshToken,
    `auth refresh expected 200, got ${refresh.status}`,
  );

  // 9) find approved verification for homeowner property
  const approvedVerifications = await http<{ submissions?: { propertyId: string; userId: string }[] }>(
    "/review/verification-submissions?status=approved",
    {
      method: "GET",
      headers: { authorization: `Bearer ${adminToken}` },
    },
  );

  const homeownerApproved = (approvedVerifications.data.submissions ?? []).find(
    (s) => s.userId === ownerLogin.data.user?.id,
  );
  assert(homeownerApproved?.propertyId, "approved homeowner verification record not found for listing creation");

  // 10) homeowner creates listing
  const listing = await http<{ listingId?: string }>("/listings", {
    method: "POST",
    headers: { authorization: `Bearer ${ownerLogin.data.token}` },
    body: JSON.stringify({
      propertyId: homeownerApproved.propertyId,
      title: "Beautiful Test Home",
      description: "Smoke test listing for YourHome moderation flow and browse checks.",
      price: 450000,
      photosJson: JSON.stringify(["https://example.com/photo-1.jpg"]),
    }),
  });
  assert(listing.status === 201 && listing.data.listingId, `listing create expected 201, got ${listing.status}`);

  // 11) reviewer requests more info on listing
  const listingNeedMore = await http<{ status?: string }>(`/review/listings/${listing.data.listingId}/decision`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      decision: "needs_more_info",
      reviewNotes: "Please improve description clarity and update image quality.",
    }),
  });
  assert(listingNeedMore.status === 200, `listing needs_more_info expected 200, got ${listingNeedMore.status}`);

  // 12) homeowner resubmits listing
  const listingResubmit = await http<{ status?: string }>(`/listings/${listing.data.listingId}/resubmit`, {
    method: "POST",
    headers: { authorization: `Bearer ${ownerLogin.data.token}` },
    body: JSON.stringify({
      title: "Beautiful Test Home — Updated",
      description: "Updated description with clearer details, neighborhood highlights, and property condition.",
      price: 455000,
      photosJson: JSON.stringify(["https://example.com/photo-1-updated.jpg"]),
    }),
  });
  assert(listingResubmit.status === 200, `listing resubmit expected 200, got ${listingResubmit.status}`);

  // 13) reviewer approves listing
  const approveListing = await http<{ status?: string; trustBadge?: string }>(
    `/review/listings/${listing.data.listingId}/decision`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ decision: "approve", reviewNotes: "Looks good." }),
    },
  );
  assert(approveListing.status === 200, `listing approve expected 200, got ${approveListing.status}`);

  // 14) public browse includes approved listing
  const browse = await http<{ listings?: { id: string }[] }>("/listings", { method: "GET" });
  assert(browse.status === 200, `browse expected 200, got ${browse.status}`);
  const found = (browse.data.listings ?? []).some((l) => l.id === listing.data.listingId);
  assert(found, "approved listing not found in public browse endpoint");

  // 15) premium lock check (should be locked before entitlement)
  const entitlementBefore = await http<{ enabled?: boolean; plan?: string; reason?: string }>(
    "/property-manager/entitlement",
    {
      method: "GET",
      headers: { authorization: `Bearer ${ownerLogin.data.token}` },
    },
  );
  assert(entitlementBefore.status === 200, `entitlement before expected 200, got ${entitlementBefore.status}`);
  assert(entitlementBefore.data.enabled === false, "expected property manager entitlement to be disabled before grant");

  // 16) homeowner creates upgrade intent + checkout stub start
  const upgradeIntent = await http<{ ok?: boolean }>("/property-manager/upgrade-intent", {
    method: "POST",
    headers: { authorization: `Bearer ${ownerLogin.data.token}` },
    body: JSON.stringify({ source: "smoke_test", note: "requesting premium for smoke flow" }),
  });
  assert(upgradeIntent.status === 200, `upgrade intent expected 200, got ${upgradeIntent.status}`);

  const checkout = await http<{ ok?: boolean; checkoutUrl?: string; mode?: string }>(
    "/billing/property-manager/checkout-stub",
    {
      method: "POST",
      headers: { authorization: `Bearer ${ownerLogin.data.token}` },
      body: JSON.stringify({ source: "smoke_test" }),
    },
  );
  assert(checkout.status === 200 && checkout.data.ok, `checkout stub expected 200, got ${checkout.status}`);

  // 17) reviewer sees intent and progresses status
  const intents = await http<{
    intents?: { id: string; user?: { id?: string; email?: string } | null; status?: string }[];
  }>("/review/property-manager/upgrade-intents", {
    method: "GET",
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert(intents.status === 200, `upgrade intents load expected 200, got ${intents.status}`);
  const targetIntent = (intents.data.intents ?? []).find((intent) => intent.user?.email === homeownerEmail);
  assert(targetIntent?.id, "upgrade intent for homeowner not found");

  const markContacted = await http<{ ok?: boolean }>(
    `/review/property-manager/upgrade-intents/${targetIntent.id}/status`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: "contacted", note: "Reached out during smoke flow" }),
    },
  );
  assert(markContacted.status === 200, `mark contacted expected 200, got ${markContacted.status}`);

  const markConverted = await http<{ ok?: boolean }>(
    `/review/property-manager/upgrade-intents/${targetIntent.id}/status`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: "converted", note: "Converted during smoke flow" }),
    },
  );
  assert(markConverted.status === 200, `mark converted expected 200, got ${markConverted.status}`);

  // 18) reviewer grants premium entitlement
  const grantEntitlement = await http<{ ok?: boolean; enabled?: boolean }>(
    `/review/property-manager/entitlements/${ownerLogin.data.user?.id}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ enabled: true, note: "smoke test grant" }),
    },
  );
  assert(
    grantEntitlement.status === 200 && grantEntitlement.data.enabled === true,
    `grant entitlement expected 200, got ${grantEntitlement.status}`,
  );

  // 19) homeowner entitlement now active
  const entitlementAfter = await http<{ enabled?: boolean; plan?: string }>("/property-manager/entitlement", {
    method: "GET",
    headers: { authorization: `Bearer ${ownerLogin.data.token}` },
  });
  assert(entitlementAfter.status === 200, `entitlement after expected 200, got ${entitlementAfter.status}`);
  assert(entitlementAfter.data.enabled === true, "expected property manager entitlement to be enabled after grant");

  // 20) homeowner creates plan and completes task with required evidence
  const createPlan = await http<{ plan?: { id?: string; tasks?: { id: string }[] } }>("/property-manager/plans", {
    method: "POST",
    headers: { authorization: `Bearer ${ownerLogin.data.token}` },
    body: JSON.stringify({
      propertyId: homeownerApproved.propertyId,
      title: "HVAC filter replacement",
      description: "Recurring filter replacement task",
      cadenceMonths: 3,
      nextDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      source: "manual",
    }),
  });
  assert(
    createPlan.status === 201 && createPlan.data.plan?.id,
    `create maintenance plan expected 201, got ${createPlan.status}`,
  );
  const firstTaskId = createPlan.data.plan?.tasks?.[0]?.id;
  assert(firstTaskId, "expected initial maintenance task id");

  const completeTask = await http<{ ok?: boolean; nextTask?: { id?: string } }>(
    `/property-manager/tasks/${firstTaskId}/complete`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${ownerLogin.data.token}` },
      body: JSON.stringify({
        completionNote: "Completed during smoke flow",
        beforeEvidenceUrl: "https://example.com/before.jpg",
        afterEvidenceUrl: "https://example.com/after.jpg",
      }),
    },
  );
  assert(
    completeTask.status === 200 && completeTask.data.ok,
    `complete maintenance task expected 200, got ${completeTask.status}`,
  );

  // 21) verify reviewer listing view shows value-preservation evidence count
  const reviewerApprovedListings = await http<{
    listings?: { id: string; valuePreservation?: { completedWithEvidence?: number } }[];
  }>("/review/listings?status=approved", {
    method: "GET",
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assert(
    reviewerApprovedListings.status === 200,
    `review approved listings expected 200, got ${reviewerApprovedListings.status}`,
  );
  const approvedListing = (reviewerApprovedListings.data.listings ?? []).find((l) => l.id === listing.data.listingId);
  assert(approvedListing, "expected approved listing in reviewer listing queue");
  assert(
    (approvedListing.valuePreservation?.completedWithEvidence ?? 0) >= 1,
    "expected value-preservation evidence count >= 1",
  );

  // 22) logout revoke all devices
  const logoutAll = await http<{ ok?: boolean }>("/auth/logout", {
    method: "POST",
    headers: { authorization: `Bearer ${ownerLogin.data.token}` },
    body: JSON.stringify({ allDevices: true }),
  });
  assert(logoutAll.status === 200, `logout all expected 200, got ${logoutAll.status}`);

  // 23) verify old refresh token is revoked
  const refreshAfterLogout = await http<{ error?: string }>("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken: refresh.data.refreshToken }),
  });
  assert(refreshAfterLogout.status === 401, `refresh after logout expected 401, got ${refreshAfterLogout.status}`);

  console.log(
    "✅ Extended smoke test passed (moderation, resubmission, premium lifecycle, entitlement persistence, and evidence completion).",
  );
  console.log(`Created test homeowner: ${homeownerEmail}`);
}

run().catch((err) => {
  console.error("❌ Smoke test failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
