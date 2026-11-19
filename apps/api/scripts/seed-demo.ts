import { Prisma } from "../src/generated/prisma/client.js";
import { prisma } from "../src/lib/prisma.js";
import { randomBytes, scryptSync } from "node:crypto";

const DEMO = {
  adminEmail: process.env.DEMO_ADMIN_EMAIL ?? "admin-demo@yourhome.local",
  adminPassword: process.env.DEMO_ADMIN_PASSWORD ?? "AdminPass!12345",
  homeownerEmail: process.env.DEMO_HOMEOWNER_EMAIL ?? "owner-demo@yourhome.local",
  homeownerPassword: process.env.DEMO_HOMEOWNER_PASSWORD ?? "HomeownerPass!12345",
  addressLine1: "221 Demo Ave",
  city: "Miami",
  state: "FL",
  zip: "33101",
};

const normalizeAddress = (input: { addressLine1: string; city: string; state: string; zip: string }) =>
  `${input.addressLine1}|${input.city}|${input.state}|${input.zip}`.trim().toLowerCase();

const hashPassword = (password: string) => {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
};

async function upsertUser(params: { email: string; password: string; role: string; verificationStatus: string }) {
  const existing = await prisma.user.findUnique({ where: { email: params.email } });
  const passwordHash = hashPassword(params.password);

  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        role: params.role,
        verificationStatus: params.verificationStatus,
      },
    });
  }

  return prisma.user.create({
    data: {
      email: params.email,
      passwordHash,
      role: params.role,
      verificationStatus: params.verificationStatus,
    },
  });
}

async function run() {
  console.log("Seeding YourHome demo data...");

  const admin = await upsertUser({
    email: DEMO.adminEmail,
    password: DEMO.adminPassword,
    role: "admin",
    verificationStatus: "verified",
  });

  const homeowner = await upsertUser({
    email: DEMO.homeownerEmail,
    password: DEMO.homeownerPassword,
    role: "homeowner",
    verificationStatus: "verified",
  });

  const normalizedAddress = normalizeAddress(DEMO);
  const property =
    (await prisma.property.findFirst({ where: { normalizedAddress } })) ??
    (await prisma.property.create({
      data: {
        addressLine1: DEMO.addressLine1,
        city: DEMO.city,
        state: DEMO.state,
        zip: DEMO.zip,
        normalizedAddress,
      },
    }));

  await prisma.property.update({
    where: { id: property.id },
    data: { ownerUserId: homeowner.id },
  });

  let submission = await prisma.verificationSubmission.findFirst({
    where: { userId: homeowner.id, propertyId: property.id },
    orderBy: { submittedAt: "desc" },
  });

  if (!submission) {
    submission = await prisma.verificationSubmission.create({
      data: {
        userId: homeowner.id,
        propertyId: property.id,
        status: "approved",
        docsJson: JSON.stringify({
          documentType: "utility_bill",
          ownerNameOnDocument: "Demo Homeowner",
          issueDate: "2026-02-01",
          fileUrl: "https://example.com/demo-proof.pdf",
          shortNote: "Initial demo ownership proof",
          consentConfirmed: true,
        }),
        reviewedBy: admin.id,
        reviewedAt: new Date(),
        reviewNotes: "Demo approved",
      },
    });
  } else {
    submission = await prisma.verificationSubmission.update({
      where: { id: submission.id },
      data: {
        status: "approved",
        reviewedBy: admin.id,
        reviewedAt: new Date(),
        reviewNotes: "Demo approved",
      },
    });
  }

  let listing = await prisma.listing.findFirst({
    where: { createdByUserId: homeowner.id, propertyId: property.id },
    orderBy: { createdAt: "desc" },
  });

  if (!listing) {
    listing = await prisma.listing.create({
      data: {
        propertyId: property.id,
        createdByUserId: homeowner.id,
        status: "needs_more_info",
        title: "Demo home near downtown",
        description: "Demo listing pre-seeded for needs_more_info -> resubmission walkthrough.",
        price: new Prisma.Decimal(449000),
        photosJson: JSON.stringify(["https://images.unsplash.com/photo-1560185008-b033106af5c3"]),
        trustBadge: "none",
      },
    });
  } else {
    listing = await prisma.listing.update({
      where: { id: listing.id },
      data: {
        status: "needs_more_info",
        title: "Demo home near downtown",
        description: "Demo listing pre-seeded for needs_more_info -> resubmission walkthrough.",
        price: new Prisma.Decimal(449000),
        photosJson: JSON.stringify(["https://images.unsplash.com/photo-1560185008-b033106af5c3"]),
        trustBadge: "none",
      },
    });
  }

  await prisma.auditLog.createMany({
    data: [
      {
        actorUserId: admin.id,
        action: "demo_seed_ran",
        entityType: "user",
        entityId: admin.id,
        afterJson: JSON.stringify({ email: admin.email }),
      },
      {
        actorUserId: admin.id,
        action: "demo_seed_ran",
        entityType: "user",
        entityId: homeowner.id,
        afterJson: JSON.stringify({ email: homeowner.email }),
      },
      {
        actorUserId: admin.id,
        action: "demo_seed_ran",
        entityType: "listing",
        entityId: listing.id,
        afterJson: JSON.stringify({ status: listing.status }),
      },
    ],
  });

  console.log("✅ Demo seed complete");
  console.log(`Admin: ${DEMO.adminEmail} / ${DEMO.adminPassword}`);
  console.log(`Homeowner: ${DEMO.homeownerEmail} / ${DEMO.homeownerPassword}`);
  console.log(`Property ID: ${property.id}`);
  console.log(`Verification Submission ID: ${submission.id} (approved)`);
  console.log(`Listing ID: ${listing.id} (needs_more_info)`);
}

run()
  .catch((err) => {
    console.error("❌ Demo seed failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
