import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import fastifyStatic from "@fastify/static";
import { prisma } from "./lib/prisma.js";
import { createUploadStaticOptions } from "./static-file-policy.js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { z } from "zod";

const app = Fastify({ logger: true });
const uploadsDir = path.resolve(process.cwd(), "uploads");
const STORAGE_PROVIDER = (process.env.STORAGE_PROVIDER ?? "local").toLowerCase();
const S3_BUCKET = process.env.S3_BUCKET;
const S3_REGION = process.env.S3_REGION ?? "us-east-1";
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_PUBLIC_BASE_URL = process.env.S3_PUBLIC_BASE_URL;

const s3Client =
  STORAGE_PROVIDER === "s3"
    ? new S3Client({
        region: S3_REGION,
        ...(S3_ENDPOINT ? { endpoint: S3_ENDPOINT, forcePathStyle: true } : {}),
      })
    : null;

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET is required");

const ADMIN_BOOTSTRAP_KEY = process.env.ADMIN_BOOTSTRAP_KEY;
const disposableDatabasePattern = /^yourhome_prisma7_smoke_[0-9]+_[0-9]+$/;
const smokeDisposableCapability = process.env.SMOKE_DISPOSABLE_CAPABILITY;
const smokeDisposableDatabaseName = process.env.SMOKE_DISPOSABLE_DATABASE_NAME;
if (smokeDisposableCapability) {
  if (!/^[a-f0-9]{64}$/.test(smokeDisposableCapability)) {
    throw new Error("SMOKE_DISPOSABLE_CAPABILITY must be a 32-byte hexadecimal capability");
  }
  if (!smokeDisposableDatabaseName || !disposableDatabasePattern.test(smokeDisposableDatabaseName)) {
    throw new Error("SMOKE_DISPOSABLE_DATABASE_NAME must be an exact guarded database name for smoke capability");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for smoke capability");
  const targetDatabaseName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.replace(/^\//, ""));
  if (targetDatabaseName !== smokeDisposableDatabaseName) {
    throw new Error("disposable database name must match DATABASE_URL for smoke capability");
  }
} else if (smokeDisposableDatabaseName) {
  throw new Error("SMOKE_DISPOSABLE_CAPABILITY is required when SMOKE_DISPOSABLE_DATABASE_NAME is set");
}
const AUTH_OAUTH_DEV_MODE = String(process.env.AUTH_OAUTH_DEV_MODE ?? "false").toLowerCase() === "true";
const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;
if (process.env.NODE_ENV === "production" && !MAPBOX_ACCESS_TOKEN) {
  throw new Error("MAPBOX_ACCESS_TOKEN is required in production");
}
if (!MAPBOX_ACCESS_TOKEN) {
  app.log.warn("MAPBOX_ACCESS_TOKEN missing: /directory/poi-search will return 503 until configured");
}

const oauthProviderEnabled = {
  google: String(process.env.OAUTH_GOOGLE_ENABLED ?? "false").toLowerCase() === "true",
  apple: String(process.env.OAUTH_APPLE_ENABLED ?? "false").toLowerCase() === "true",
  facebook: String(process.env.OAUTH_FACEBOOK_ENABLED ?? "false").toLowerCase() === "true",
} as const;

const oauthProviderImplemented = {
  google: true,
  apple: false,
  facebook: false,
} as const;

void app.register(cors, {
  origin: true,
  credentials: true,
});
void app.register(fastifyStatic, createUploadStaticOptions(uploadsDir));
void app.register(jwt, { secret: JWT_SECRET });

type AppUser = {
  id: string;
  email: string;
  role: string;
  verificationStatus: string;
  emailVerifiedAt?: string | null;
  preferredLanguage?: string;
};

const getCurrentUser = (request: { user: unknown }): AppUser => request.user as AppUser;

const premiumEmailAllowlist = new Set(
  String(process.env.PROPERTY_MANAGER_PREMIUM_EMAILS ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean),
);

const premiumUserIdAllowlist = new Set(
  String(process.env.PROPERTY_MANAGER_PREMIUM_USER_IDS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean),
);

const getEntitlementOverride = async (userId: string) => {
  const persisted = await prisma.userEntitlement.findUnique({
    where: {
      userId_feature: {
        userId,
        feature: "property_manager",
      },
    },
    select: { enabled: true },
  });

  if (persisted && typeof persisted.enabled === "boolean") {
    return persisted.enabled;
  }

  // Backward compatibility for legacy audit-log-only overrides.
  const latest = await prisma.auditLog.findFirst({
    where: {
      action: "property_manager_entitlement_set",
      entityType: "user",
      entityId: userId,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!latest?.afterJson) return null;
  try {
    const parsed = JSON.parse(latest.afterJson) as { enabled?: boolean };
    if (typeof parsed.enabled === "boolean") return parsed.enabled;
    return null;
  } catch {
    return null;
  }
};

const hasPropertyManagerEntitlement = async (user: { id: string; role: string; email: string }) => {
  if (user.role === "admin" || user.role === "reviewer") return true;
  if (premiumUserIdAllowlist.has(String(user.id))) return true;
  if (premiumEmailAllowlist.has(String(user.email).toLowerCase())) return true;

  const override = await getEntitlementOverride(user.id);
  if (typeof override === "boolean") return override;
  return false;
};

const hashPassword = (password: string) => {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
};

const verifyPassword = (password: string, stored: string) => {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashedBuffer = Buffer.from(hash, "hex");
  const suppliedBuffer = scryptSync(password, salt, 64);
  return timingSafeEqual(hashedBuffer, suppliedBuffer);
};

const hashRefreshToken = (token: string) => createHash("sha256").update(token).digest("hex");
const hashSignal = (value: string) => createHash("sha256").update(value).digest("hex");
const hashEmailVerificationCode = (code: string) => createHash("sha256").update(code).digest("hex");
const makeChallengeId = () => randomBytes(12).toString("hex");
const makeEmailVerificationCode = () => `${Math.floor(Math.random() * 1_000_000)}`.padStart(6, "0");
const emailVerificationTtlMs = 10 * 60 * 1000;
const emailOutboxDir = path.resolve(process.cwd(), ".tmp", "email-outbox");
const emailFrom = process.env.EMAIL_FROM ?? "hello@yourhome.local";
const smtpUrl = process.env.SMTP_URL?.trim();
const smtpHost = process.env.SMTP_HOST?.trim();
const smtpPort = Number(process.env.SMTP_PORT ?? "587");
const smtpSecure = String(process.env.SMTP_SECURE ?? "false").toLowerCase() === "true";
const smtpUser = process.env.SMTP_USER?.trim();
const smtpPass = process.env.SMTP_PASS;
const emailTransport =
  smtpUrl || smtpHost
    ? nodemailer.createTransport(
        smtpUrl
          ? smtpUrl
          : {
              host: smtpHost,
              port: smtpPort,
              secure: smtpSecure,
              auth: smtpUser ? { user: smtpUser, pass: smtpPass } : undefined,
            },
      )
    : null;

const refreshCleanupRetentionDays = Number(process.env.REFRESH_TOKEN_CLEANUP_RETENTION_DAYS ?? "30");

const cleanupRefreshTokens = async () => {
  const now = new Date();
  const revokedCutoff = new Date(now.getTime() - refreshCleanupRetentionDays * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: revokedCutoff } }],
    },
  });
};

const createRefreshToken = async (userId: string) => {
  const rawToken = randomBytes(48).toString("hex");
  const tokenHash = hashRefreshToken(rawToken);
  const refreshTokenDays = Number(process.env.REFRESH_TOKEN_DAYS ?? "14");
  const expiresAt = new Date(Date.now() + refreshTokenDays * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
    },
  });

  return rawToken;
};

const serializeUser = (user: {
  id: string;
  email: string;
  role: string;
  verificationStatus: string;
  emailVerifiedAt?: Date | string | null;
  createdAt?: Date;
  preferredLanguage?: string | null;
}) => ({
  id: user.id,
  email: user.email,
  role: user.role,
  verificationStatus: user.verificationStatus,
  emailVerifiedAt: user.emailVerifiedAt ? new Date(user.emailVerifiedAt).toISOString() : null,
  preferredLanguage: user.preferredLanguage ?? "en",
  ...(user.createdAt ? { createdAt: user.createdAt.toISOString() } : {}),
});

const issueSession = async (
  reply: { jwtSign: (payload: object, options?: { expiresIn?: string }) => Promise<string> },
  user: {
    id: string;
    email: string;
    role: string;
    verificationStatus: string;
    emailVerifiedAt?: Date | string | null;
    createdAt?: Date;
  },
) => {
  const publicUser = serializeUser(user);
  const token = await reply.jwtSign(publicUser, { expiresIn: "12h" });
  const refreshToken = await createRefreshToken(user.id);
  return { token, refreshToken, user: publicUser };
};

const sendVerificationEmail = async (params: { email: string; code: string }) => {
  const subject = "YourHome verification code";
  const text = `YourHome verification code: ${params.code}\n\nThis code expires in 10 minutes.`;
  const html = `<p>YourHome verification code:</p><p style="font-size:32px;font-weight:700;letter-spacing:4px;">${params.code}</p><p>This code expires in 10 minutes.</p>`;

  if (emailTransport) {
    await emailTransport.sendMail({
      from: emailFrom,
      to: params.email,
      subject,
      text,
      html,
    });
    return { mode: "smtp" as const };
  }

  await fs.mkdir(emailOutboxDir, { recursive: true });
  const filePath = path.join(emailOutboxDir, `${Date.now()}-${params.email.replace(/[^a-z0-9]+/gi, "_")}.json`);
  await fs.writeFile(
    filePath,
    JSON.stringify(
      {
        to: params.email,
        from: emailFrom,
        subject,
        text,
        html,
        code: params.code,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  return { mode: "local_outbox" as const, filePath };
};

const createEmailVerification = async (email: string) => {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, emailVerifiedAt: true },
  });
  if (!user || user.emailVerifiedAt) {
    return {
      accepted: true as const,
      alreadyVerified: Boolean(user?.emailVerifiedAt),
      delivery: { mode: emailTransport ? "smtp" : "local_outbox" },
    };
  }

  const code = makeEmailVerificationCode();
  const expiresAt = new Date(Date.now() + emailVerificationTtlMs);
  await prisma.emailVerificationCode.deleteMany({ where: { userId: user.id, consumedAt: null } });
  await prisma.emailVerificationCode.create({
    data: {
      userId: user.id,
      email: user.email,
      codeHash: hashEmailVerificationCode(code),
      expiresAt,
    },
  });

  const delivery = await sendVerificationEmail({ email: user.email, code });
  return { accepted: true as const, alreadyVerified: false, delivery, expiresAt: expiresAt.toISOString() };
};

const revokeRefreshToken = async (rawToken: string) => {
  const tokenHash = hashRefreshToken(rawToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
};

const revokeAllRefreshTokensForUser = async (userId: string) => {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
};

const registerSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(10),
  phone: z.string().min(8).optional(),
});

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

const emailCheckSchema = z.object({
  email: z.string().email().toLowerCase(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(20).optional(),
  allDevices: z.boolean().optional(),
});

const supportedLanguageCodes = ["ar", "de", "en", "es", "fr", "ht", "it", "nl", "pt", "ru"] as const;

const languagePreferenceSchema = z.object({
  language: z.enum(supportedLanguageCodes),
});

const verificationStartSchema = z.object({
  target: z.string().min(3),
});

const verificationConfirmSchema = z.object({
  challengeId: z.string().min(8),
  code: z.string().min(4).max(8),
});

const emailVerificationStartSchema = z.object({
  email: z.string().email().toLowerCase(),
});

const emailVerificationConfirmSchema = z.object({
  email: z.string().email().toLowerCase(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});

const propertyDiscoveryStartSchema = z.object({
  fullName: z.string().min(2),
  currentAddress: z.string().optional(),
  priorAddress: z.string().optional(),
  emailOrPhone: z.string().optional(),
  birthMonthYear: z.string().optional(),
  consent: z.literal(true),
});

const propertyDiscoveryDecisionSchema = z.object({
  decision: z.enum(["claimed", "rejected", "unsure"]),
});

const oauthStartSchema = z.object({
  redirectUri: z.string().url(),
  state: z.string().min(16),
  nonce: z.string().min(16),
  codeChallenge: z.string().min(20),
  codeChallengeMethod: z.literal("S256"),
});

const oauthCallbackSchema = z.object({
  code: z.string().min(6),
  state: z.string().min(16),
  redirectUri: z.string().url(),
  codeVerifier: z.string().min(43),
  nonce: z.string().min(16),
});

type OAuthProvider = "google" | "apple" | "facebook";

type OAuthTxn = {
  provider: OAuthProvider;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  createdAt: number;
};

const oauthTransactions = new Map<string, OAuthTxn>();
const oauthTxnTtlMs = 10 * 60 * 1000;

type VerificationChallenge = {
  channel: "email" | "phone";
  target: string;
  code: string;
  expiresAt: number;
};

const verificationChallenges = new Map<string, VerificationChallenge>();
const verificationTtlMs = 10 * 60 * 1000;

type DiscoveryDecision = "claimed" | "rejected" | "unsure";
type PropertyDiscoveryCandidate = {
  id: string;
  source: string;
  county: string;
  state: string;
  address: string;
  confidence: number;
  decision: DiscoveryDecision | null;
};

type PropertyDiscoveryRun = {
  id: string;
  status: "queued" | "completed";
  createdAt: number;
  fullName: string;
  candidates: PropertyDiscoveryCandidate[];
};

const propertyDiscoveryRuns = new Map<string, PropertyDiscoveryRun>();

const allowedProdRedirects = String(process.env.OAUTH_ALLOWED_REDIRECT_URIS ?? "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

const allowedDevRedirects = String(process.env.OAUTH_ALLOWED_DEV_REDIRECT_URIS ?? "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

const getProvider = (input: string): OAuthProvider | null => {
  if (input === "google" || input === "apple" || input === "facebook") return input;
  return null;
};

const isAllowedRedirectUri = (uri: string) => {
  const allowed = AUTH_OAUTH_DEV_MODE ? [...allowedProdRedirects, ...allowedDevRedirects] : allowedProdRedirects;
  if (allowed.includes(uri)) return true;

  if (AUTH_OAUTH_DEV_MODE) {
    try {
      const parsed = new URL(uri);
      const localHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);
      if (localHosts.has(parsed.hostname)) {
        // Dev convenience: allow localhost callback variations while iterating on Expo web.
        if (parsed.pathname === "/oauth/callback" || parsed.pathname === "/auth/callback" || parsed.pathname === "/") {
          return true;
        }
      }
    } catch {
      // ignore parse errors; fall through to false
    }
  }

  return false;
};

const oauthConfig = {
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    clientId: process.env.OAUTH_GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.OAUTH_GOOGLE_CLIENT_SECRET ?? "",
    scopes: ["openid", "email", "profile"],
  },
  apple: {
    authUrl: "https://appleid.apple.com/auth/authorize",
    tokenUrl: "https://appleid.apple.com/auth/token",
    clientId: process.env.OAUTH_APPLE_CLIENT_ID ?? "",
    clientSecret: process.env.OAUTH_APPLE_CLIENT_SECRET ?? "",
    scopes: ["name", "email"],
  },
  facebook: {
    authUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
    clientId: process.env.OAUTH_FACEBOOK_CLIENT_ID ?? "",
    clientSecret: process.env.OAUTH_FACEBOOK_CLIENT_SECRET ?? "",
    scopes: ["email", "public_profile"],
  },
} as const;

const getPublicAuthConfig = () => {
  const googleReady =
    oauthProviderEnabled.google &&
    oauthProviderImplemented.google &&
    Boolean(oauthConfig.google.clientId) &&
    Boolean(oauthConfig.google.clientSecret);

  return {
    session: {
      accessTokenTtl: "12h",
      refreshTokenRequiredForRotation: true,
      refreshRotation: true,
      logoutRequiresRefreshTokenForSingleDevice: true,
      restoreRequiresRefreshTokenWhenAccessTokenExpires: true,
    },
    methods: {
      password: {
        supported: true,
        register: true,
        login: true,
        emailCheck: true,
      },
      googleOAuth: {
        supported: googleReady,
        enabled: oauthProviderEnabled.google,
        implemented: oauthProviderImplemented.google,
        ready: googleReady,
      },
      appleOAuth: {
        supported: false,
        enabled: oauthProviderEnabled.apple,
        implemented: oauthProviderImplemented.apple,
        ready: false,
      },
      facebookOAuth: {
        supported: false,
        enabled: oauthProviderEnabled.facebook,
        implemented: oauthProviderImplemented.facebook,
        ready: false,
      },
      emailOtpVerification: {
        supportedForAuth: true,
        status: emailTransport ? "live" : "live_local_outbox",
      },
      phoneOtpVerification: {
        supportedForAuth: false,
        status: "stub",
      },
    },
  };
};

const buildOAuthAuthUrl = (
  provider: OAuthProvider,
  params: { redirectUri: string; state: string; nonce: string; codeChallenge: string },
) => {
  const providerConfig = oauthConfig[provider];
  const url = new URL(providerConfig.authUrl);
  url.searchParams.set("client_id", providerConfig.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", providerConfig.scopes.join(" "));
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  if (provider === "google") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  }

  return url.toString();
};

const bootstrapAdminSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(12),
});

const verificationSchema = z.object({
  addressLine1: z.string().min(5),
  city: z.string().min(2),
  state: z.string().min(2).max(2),
  zip: z.string().min(5).max(10),
  docsJson: z.string().optional(),
});

const verificationResubmitSchema = z.object({
  docsJson: z.string().min(2),
});

const verificationDecisionSchema = z.object({
  decision: z.enum(["approve", "reject", "needs_more_info"]),
  reviewNotes: z.string().max(2000).optional(),
});

const createListingSchema = z.object({
  propertyId: z.string().min(1),
  title: z.string().min(5).max(140),
  description: z.string().min(20).max(5000),
  price: z.number().positive().optional(),
  photosJson: z.string().optional(),
});

const listingDecisionSchema = z.object({
  decision: z.enum(["approve", "reject", "needs_more_info"]),
  reviewNotes: z.string().max(2000).optional(),
});

const listingResubmitSchema = z.object({
  title: z.string().min(5).max(140),
  description: z.string().min(20).max(5000),
  price: z.number().positive().optional(),
  photosJson: z.string().optional(),
});

const uploadDocumentSchema = z.object({
  fileName: z.string().min(1).max(120),
  mimeType: z.string().min(3).max(100),
  base64: z.string().min(10),
});

const uploadPresignSchema = z.object({
  fileName: z.string().min(1).max(120),
  mimeType: z.string().min(3).max(100),
});

const maintenancePlanSchema = z.object({
  propertyId: z.string().min(1),
  title: z.string().min(3).max(120),
  description: z.string().max(500).optional(),
  cadenceMonths: z.number().int().min(1).max(24),
  nextDueAt: z.string().datetime(),
  source: z.enum(["manual", "local_suggestion"]).optional(),
});

const completeMaintenanceTaskSchema = z.object({
  completionNote: z.string().max(500).optional(),
  beforeEvidenceUrl: z.string().url().max(500),
  afterEvidenceUrl: z.string().url().max(500),
});

const upgradeIntentSchema = z.object({
  source: z.string().max(80).optional(),
  note: z.string().max(500).optional(),
});

const updateUpgradeIntentStatusSchema = z.object({
  status: z.enum(["new", "contacted", "converted"]),
  note: z.string().max(500).optional(),
  followUpDueAt: z.coerce.date().optional(),
  followUpOwner: z.string().max(120).optional(),
});

const setEntitlementSchema = z.object({
  enabled: z.boolean(),
  note: z.string().max(500).optional(),
});

const startCheckoutSchema = z.object({
  source: z.string().max(80).optional(),
});

const historyParamsSchema = z.object({
  entityType: z.enum(["listing", "verification_submission"]),
  entityId: z.string().min(1),
});

const normalizeAddress = (input: { addressLine1: string; city: string; state: string; zip: string }) =>
  `${input.addressLine1}|${input.city}|${input.state}|${input.zip}`.trim().toLowerCase();

const deriveTimelineStatus = (action: string, afterJson?: string | null): string | null => {
  if (action.endsWith("_created")) return "submitted";
  if (action.endsWith("_resubmitted")) return "resubmitted";
  if (action.endsWith("_approved")) return "approved";
  if (action.endsWith("_rejected")) return "rejected";
  if (action.endsWith("_needs_more_info")) return "needs_more_info";

  if (!afterJson) return null;
  try {
    const parsed = JSON.parse(afterJson) as { status?: string };
    return parsed.status ?? null;
  } catch {
    return null;
  }
};

const makeUploadObjectKey = (fileName: string) => {
  const ext = path.extname(fileName) || ".bin";
  const safeBaseName =
    path
      .basename(fileName, ext)
      .replace(/[^a-zA-Z0-9-_]/g, "-")
      .slice(0, 40) || "document";
  return `documents/${Date.now()}-${safeBaseName}${ext}`;
};

const resolvePublicFileUrl = (keyOrName: string) => {
  if (STORAGE_PROVIDER === "s3") {
    if (!S3_BUCKET) throw new Error("S3_BUCKET is required when STORAGE_PROVIDER=s3");
    if (S3_PUBLIC_BASE_URL) return `${S3_PUBLIC_BASE_URL.replace(/\/$/, "")}/${keyOrName}`;
    return `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${keyOrName}`;
  }

  const normalized = keyOrName.replace(/^\/+/, "");
  return `/uploads/${normalized.split("/").pop()}`;
};

const localMaintenanceSuggestions = (city?: string, county?: string) => {
  const normalizedCity = String(city ?? "").toLowerCase();
  const normalizedCounty = String(county ?? "").toLowerCase();

  const base = [
    {
      key: "pressure-wash",
      title: "Pressure wash exterior",
      description: "Prevent buildup, staining, and long-term exterior wear.",
      cadenceMonths: 6,
    },
    {
      key: "hvac-filter",
      title: "Replace HVAC filter",
      description: "Improve air quality and reduce system strain.",
      cadenceMonths: 3,
    },
  ];

  if (normalizedCity.includes("miami") || normalizedCounty.includes("miami-dade")) {
    base.push({
      key: "storm-prep",
      title: "Hurricane readiness check",
      description: "Review shutters, drains, and emergency prep before storm season.",
      cadenceMonths: 6,
    });
  }

  return base;
};

const getMaintenanceSummaryByPropertyIds = async (propertyIds: string[]) => {
  if (!propertyIds.length) return new Map<string, { completedWithEvidence: number; lastCompletedAt: Date | null }>();

  const completed = await prisma.maintenanceTask.findMany({
    where: {
      propertyId: { in: propertyIds },
      status: "completed",
      beforeEvidenceUrl: { not: null },
      afterEvidenceUrl: { not: null },
    },
    select: { propertyId: true, completedAt: true },
    orderBy: { completedAt: "desc" },
    take: 500,
  });

  const map = new Map<string, { completedWithEvidence: number; lastCompletedAt: Date | null }>();
  for (const id of propertyIds) map.set(id, { completedWithEvidence: 0, lastCompletedAt: null });

  for (const row of completed) {
    const current = map.get(row.propertyId) ?? { completedWithEvidence: 0, lastCompletedAt: null };
    map.set(row.propertyId, {
      completedWithEvidence: current.completedWithEvidence + 1,
      lastCompletedAt: current.lastCompletedAt ?? row.completedAt ?? null,
    });
  }

  return map;
};

const auth = async (request: any, reply: any) => {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ error: "unauthorized" });
  }
};

const requireRoles = (roles: string[]) => {
  return async (request: any, reply: any) => {
    const tokenUser = getCurrentUser(request);
    const dbUser = await prisma.user.findUnique({ where: { id: tokenUser.id }, select: { role: true } });
    if (!dbUser || !roles.includes(dbUser.role)) {
      return reply.code(403).send({ error: "forbidden" });
    }
  };
};

const authWindowMs = 15 * 60 * 1000;
const authMaxAttempts = 8;
const lockoutMs = 15 * 60 * 1000;

const getClientIp = (request: any) => {
  const xf = request.headers["x-forwarded-for"] as string | undefined;
  if (xf) return xf.split(",")[0]?.trim() ?? request.ip;
  return request.ip;
};

const getDeviceLabel = (request: any) => {
  const userAgent = String(request.headers["user-agent"] ?? "unknown");
  const secChUaPlatform = String(request.headers["sec-ch-ua-platform"] ?? "");
  return `${userAgent}|${secChUaPlatform}`;
};

const getAuthLogMeta = (request: any) => ({
  ipHash: hashSignal(getClientIp(request)),
  deviceHash: hashSignal(getDeviceLabel(request)),
});

const consumeAuthAttempt = async (key: string) => {
  const now = new Date();
  const current = await prisma.authThrottle.findUnique({ where: { key } });

  if (!current) {
    await prisma.authThrottle.create({
      data: { key, count: 1, windowStart: now },
    });
    return { blocked: false };
  }

  if (current.lockUntil && current.lockUntil > now) {
    return {
      blocked: true,
      retryAfterSec: Math.ceil((current.lockUntil.getTime() - now.getTime()) / 1000),
    };
  }

  if (now.getTime() - current.windowStart.getTime() > authWindowMs) {
    await prisma.authThrottle.update({
      where: { key },
      data: { count: 1, windowStart: now, lockUntil: null },
    });
    return { blocked: false };
  }

  const nextCount = current.count + 1;
  if (nextCount > authMaxAttempts) {
    const lockUntil = new Date(now.getTime() + lockoutMs);
    await prisma.authThrottle.update({
      where: { key },
      data: { count: nextCount, lockUntil },
    });
    return { blocked: true, retryAfterSec: Math.ceil(lockoutMs / 1000) };
  }

  await prisma.authThrottle.update({
    where: { key },
    data: { count: nextCount },
  });
  return { blocked: false };
};

const clearAuthAttempts = async (key: string) => {
  await prisma.authThrottle.deleteMany({ where: { key } });
};

app.get("/health", async () => ({ ok: true, service: "api" }));
app.get("/internal/disposable-smoke-context", async (request, reply) => {
  if (!smokeDisposableCapability || request.headers["x-yourhome-smoke-capability"] !== smokeDisposableCapability) {
    return reply.code(404).send({ error: "not_found" });
  }
  return { databaseName: smokeDisposableDatabaseName };
});
app.get("/auth/config", async () => ({ auth: getPublicAuthConfig() }));

app.post("/verification/email/start", async (request, reply) => {
  const parsed = emailVerificationStartSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });

  const result = await createEmailVerification(parsed.data.email);
  return reply.code(202).send({
    ok: true,
    channel: "email",
    delivery: result.delivery,
    alreadyVerified: result.alreadyVerified,
    expiresAt: result.expiresAt ?? null,
  });
});

app.post("/verification/email/confirm", async (request, reply) => {
  const parsed = emailVerificationConfirmSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: {
      id: true,
      email: true,
      role: true,
      verificationStatus: true,
      emailVerifiedAt: true,
      preferredLanguage: true,
    },
  });
  if (!user) return reply.code(404).send({ error: "verification_not_found" });
  if (user.emailVerifiedAt) return { verified: true, alreadyVerified: true, user: serializeUser(user) };

  const record = await prisma.emailVerificationCode.findFirst({
    where: {
      userId: user.id,
      email: user.email,
      consumedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!record) return reply.code(404).send({ error: "verification_not_found" });
  if (record.expiresAt < new Date()) return reply.code(410).send({ error: "challenge_expired" });
  if (record.codeHash !== hashEmailVerificationCode(parsed.data.code))
    return reply.code(401).send({ error: "invalid_code" });

  const now = new Date();
  const [, updatedUser] = await prisma.$transaction([
    prisma.emailVerificationCode.update({ where: { id: record.id }, data: { consumedAt: now } }),
    prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: now },
      select: {
        id: true,
        email: true,
        role: true,
        verificationStatus: true,
        emailVerifiedAt: true,
        preferredLanguage: true,
      },
    }),
  ]);

  return { verified: true, user: serializeUser(updatedUser) };
});

app.post("/verification/phone/start", async (request, reply) => {
  const parsed = verificationStartSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });

  const challengeId = makeChallengeId();
  verificationChallenges.set(challengeId, {
    channel: "phone",
    target: parsed.data.target.trim(),
    code: "123456",
    expiresAt: Date.now() + verificationTtlMs,
  });

  return reply.code(202).send({
    challengeId,
    channel: "phone",
    mode: "stub",
    message: "Phone verification challenge created (stub).",
  });
});

app.post("/verification/phone/confirm", async (request, reply) => {
  const parsed = verificationConfirmSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });

  const challenge = verificationChallenges.get(parsed.data.challengeId);
  if (!challenge || challenge.channel !== "phone") return reply.code(404).send({ error: "challenge_not_found" });
  if (challenge.expiresAt < Date.now()) return reply.code(410).send({ error: "challenge_expired" });
  if (parsed.data.code !== challenge.code) return reply.code(401).send({ error: "invalid_code" });

  verificationChallenges.delete(parsed.data.challengeId);
  return { verified: true, channel: "phone", mode: "stub", verificationToken: makeChallengeId() };
});

app.post("/property-discovery/start", async (request, reply) => {
  const parsed = propertyDiscoveryStartSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const runId = makeChallengeId();
  const seed = parsed.data.fullName.trim().toUpperCase().slice(0, 2) || "US";
  const run: PropertyDiscoveryRun = {
    id: runId,
    status: "completed",
    createdAt: Date.now(),
    fullName: parsed.data.fullName,
    candidates: [
      {
        id: `cand_${makeChallengeId()}`,
        source: "county-assessor-stub",
        county: "Miami-Dade",
        state: "FL",
        address: `${seed} Sample Ave, Miami, FL 33101`,
        confidence: 0.84,
        decision: null,
      },
      {
        id: `cand_${makeChallengeId()}`,
        source: "county-recorder-stub",
        county: "Broward",
        state: "FL",
        address: `${seed} Example Dr, Fort Lauderdale, FL 33301`,
        confidence: 0.68,
        decision: null,
      },
    ],
  };

  propertyDiscoveryRuns.set(runId, run);
  return reply.code(202).send({ runId, status: run.status, mode: "stub" });
});

app.get("/property-discovery/runs/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const run = propertyDiscoveryRuns.get(id);
  if (!run) return reply.code(404).send({ error: "run_not_found" });

  return {
    runId: run.id,
    status: run.status,
    createdAt: run.createdAt,
    candidates: run.candidates,
    mode: "stub",
  };
});

app.post("/property-discovery/candidates/:id/decision", async (request, reply) => {
  const parsed = propertyDiscoveryDecisionSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const { id } = request.params as { id: string };
  let target: PropertyDiscoveryCandidate | null = null;

  for (const run of propertyDiscoveryRuns.values()) {
    const candidate = run.candidates.find((c) => c.id === id);
    if (candidate) {
      candidate.decision = parsed.data.decision;
      target = candidate;
      break;
    }
  }

  if (!target) return reply.code(404).send({ error: "candidate_not_found" });

  return { ok: true, candidateId: target.id, decision: target.decision, mode: "stub" };
});

const directoryHomes = [
  {
    id: "1",
    price: "$2,650,000",
    meta: "3 beds • 3.5 baths • 2,913 sqft",
    addr: "1648 Nocatee Dr, Miami, FL",
    latitude: 25.7869,
    longitude: -80.193,
    claimed: true,
  },
  {
    id: "2",
    price: "$1,249,000",
    meta: "5 beds • 3.5 baths • 3,123 sqft",
    addr: "813 NE 81st St, Miami, FL",
    latitude: 25.8485,
    longitude: -80.1762,
    claimed: false,
  },
  {
    id: "3",
    price: "$999,900",
    meta: "5 beds • 4 baths • 2,993 sqft",
    addr: "6512 NW 99th Ave, Parkland, FL",
    latitude: 26.3201,
    longitude: -80.258,
    claimed: false,
  },
  {
    id: "4",
    price: "$1,875,000",
    meta: "4 beds • 3 baths • 2,401 sqft",
    addr: "451 Brickell Ave, Miami, FL",
    latitude: 25.7684,
    longitude: -80.1907,
    claimed: true,
  },
];

app.get("/directory/search", async (request) => {
  const q = request.query as Record<string, string | undefined>;
  const rawMinLat = Number(q.minLat);
  const rawMaxLat = Number(q.maxLat);
  const rawMinLng = Number(q.minLng);
  const rawMaxLng = Number(q.maxLng);
  const zoom = Number(q.zoom ?? "0");
  const limit = Math.min(100, Math.max(1, Number(q.limit ?? "50") || 50));
  const cursor = Math.max(0, Number(q.cursor ?? "0") || 0);

  const hasBounds = [rawMinLat, rawMaxLat, rawMinLng, rawMaxLng].every((n) => Number.isFinite(n));

  const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

  let minLat = hasBounds ? clamp(Math.min(rawMinLat, rawMaxLat), -90, 90) : -90;
  let maxLat = hasBounds ? clamp(Math.max(rawMinLat, rawMaxLat), -90, 90) : 90;
  let minLng = hasBounds ? clamp(Math.min(rawMinLng, rawMaxLng), -180, 180) : -180;
  let maxLng = hasBounds ? clamp(Math.max(rawMinLng, rawMaxLng), -180, 180) : 180;

  // Bounds guardrails for tiny/degenerate boxes.
  const minLatSpan = 0.005;
  const minLngSpan = 0.005;
  if (maxLat - minLat < minLatSpan) {
    const mid = (maxLat + minLat) / 2;
    minLat = clamp(mid - minLatSpan / 2, -90, 90);
    maxLat = clamp(mid + minLatSpan / 2, -90, 90);
  }
  if (maxLng - minLng < minLngSpan) {
    const mid = (maxLng + minLng) / 2;
    minLng = clamp(mid - minLngSpan / 2, -180, 180);
    maxLng = clamp(mid + minLngSpan / 2, -180, 180);
  }

  const filtered = hasBounds
    ? directoryHomes.filter(
        (h) => h.latitude >= minLat && h.latitude <= maxLat && h.longitude >= minLng && h.longitude <= maxLng,
      )
    : directoryHomes;

  const homes = filtered.slice(cursor, cursor + limit);
  const nextCursor = cursor + homes.length < filtered.length ? cursor + homes.length : null;

  return {
    homes,
    total: filtered.length,
    page: {
      limit,
      cursor,
      nextCursor,
    },
    query: {
      hasBounds,
      zoom: Number.isFinite(zoom) ? zoom : null,
      bounds: hasBounds ? { minLat, maxLat, minLng, maxLng } : null,
    },
    mode: "stub",
  };
});

type PoiSearchInput = {
  term: string;
  minLat?: number;
  maxLat?: number;
  minLng?: number;
  maxLng?: number;
  limit: number;
};

type PoiSearchResult = {
  items: {
    id: string;
    latitude: number;
    longitude: number;
    name: string;
    displayName: string;
    category: string;
    type: string;
  }[];
  term: string;
  mode: "mapbox-searchbox" | "mapbox-geocoding" | "nominatim";
  suggestions: string[];
};

type PoiSearchError =
  { error: "mapbox_token_missing"; action: string } | { error: "poi_upstream_failed"; status: number };

type PoiBatchCacheValue = { at: number; result: PoiSearchResult };
const poiBatchCache = new Map<string, PoiBatchCacheValue>();
const POI_BATCH_CACHE_TTL_MS = 20_000;
const MIN_POI_PER_TERM = 5;

const normCoord = (n?: number) => (Number.isFinite(n) ? Number(n).toFixed(5) : "na");
const makePoiBatchCacheKey = (input: PoiSearchInput) =>
  [
    input.term.toLowerCase().trim(),
    normCoord(input.minLat),
    normCoord(input.maxLat),
    normCoord(input.minLng),
    normCoord(input.maxLng),
    String(input.limit),
  ].join("|");

type PoiCandidate = {
  id: string;
  latitude: number;
  longitude: number;
  name: string;
  displayName: string;
  category: string;
  type: string;
  sourceCategory: string;
  sourceType: string;
  sourceFeatureType: string;
};

const isInRequestedBounds = (
  row: { latitude: number; longitude: number },
  bounds: { minLat?: number; maxLat?: number; minLng?: number; maxLng?: number },
) => {
  if (![bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng].every((n) => Number.isFinite(n))) return true;
  const minLat = Number(bounds.minLat);
  const maxLat = Number(bounds.maxLat);
  const minLng = Number(bounds.minLng);
  const maxLng = Number(bounds.maxLng);
  const latPad = Math.max((maxLat - minLat) * 0.15, 0.008);
  const lngPad = Math.max((maxLng - minLng) * 0.15, 0.008);
  return (
    row.latitude >= minLat - latPad &&
    row.latitude <= maxLat + latPad &&
    row.longitude >= minLng - lngPad &&
    row.longitude <= maxLng + lngPad
  );
};

const searchPOI = async ({ term, minLat, maxLat, minLng, maxLng, limit }: PoiSearchInput) => {
  if (!MAPBOX_ACCESS_TOKEN) {
    return { error: "mapbox_token_missing" as const, action: "Set MAPBOX_ACCESS_TOKEN in apps/api env." };
  }

  const hasBounds = [minLat, maxLat, minLng, maxLng].every((n) => Number.isFinite(n));
  const normalizedTerm = term.toLowerCase().trim();

  const hintGroups: {
    key: string;
    exactAliases: RegExp[];
    broadAliases: RegExp[];
    exactVariants: string[];
    broadVariants: string[];
    suggestion: string;
  }[] = [
    {
      key: "highschools",
      exactAliases: [/^high\s*schools?$/, /^highschools?$/],
      broadAliases: [/^high\s*schools?$/, /^highschools?$/],
      exactVariants: [term, "high school", "public high school", "private high school", "secondary school"],
      broadVariants: [term, "high school", "public high school", "private high school", "secondary school"],
      suggestion: "highschools",
    },
    {
      key: "education",
      exactAliases: [/^schools?$/, /^school$/],
      broadAliases: [/^schools?$/, /^school$/, /academy/, /university/, /college/, /campus/],
      exactVariants: [term, "school", "elementary school", "middle school", "high school"],
      broadVariants: [
        term,
        "school",
        "elementary school",
        "middle school",
        "high school",
        "academy",
        "university",
        "college",
      ],
      suggestion: "schools",
    },
    {
      key: "parks",
      exactAliases: [/^parks?$/, /^park$/],
      broadAliases: [/^parks?$/, /^park$/, /playground/, /recreation/, /sports\s*field/, /green\s*space/],
      exactVariants: [term, "park", "city park", "public park"],
      broadVariants: [term, "park", "playground", "recreation area", "sports field"],
      suggestion: "parks",
    },
    {
      key: "beaches",
      exactAliases: [/^beaches?$/, /^beach$/],
      broadAliases: [/^beaches?$/, /^beach$/, /shore/, /coast/, /waterfront/],
      exactVariants: [term, "beach", "public beach"],
      broadVariants: [term, "beach", "shore", "coast", "waterfront"],
      suggestion: "beaches",
    },
    {
      key: "worship",
      exactAliases: [/^churches?$/, /^church$/, /^mosques?$/, /^temples?$/, /^synagogues?$/],
      broadAliases: [/church/, /worship/, /cathedral/, /temple/, /mosque/, /synagogue/],
      exactVariants: [term, "church", "place of worship"],
      broadVariants: [term, "church", "cathedral", "temple", "mosque", "synagogue", "place of worship"],
      suggestion: "churches",
    },
    {
      key: "retail",
      exactAliases: [/^malls?$/, /^mall$/, /^shopping\s*centers?$/, /^plazas?$/],
      broadAliases: [/mall/, /shopping\s*center/, /plaza/],
      exactVariants: [term, "mall", "shopping center"],
      broadVariants: [term, "mall", "shopping center", "retail plaza"],
      suggestion: "malls",
    },
    {
      key: "water",
      exactAliases: [/^lakes?$/, /^lake$/, /^ponds?$/, /^reservoirs?$/],
      broadAliases: [/lake/, /pond/, /reservoir/],
      exactVariants: [term, "lake", "reservoir", "pond"],
      broadVariants: [term, "lake", "reservoir", "pond"],
      suggestion: "lakes",
    },
  ];

  const exactHint = hintGroups.find((h) => h.exactAliases.some((rx) => rx.test(normalizedTerm)));
  const broadHint = exactHint ?? hintGroups.find((h) => h.broadAliases.some((rx) => rx.test(normalizedTerm)));
  const hint = broadHint;
  const useExactIntent = Boolean(exactHint);

  const queryVariants = Array.from(
    new Set(
      ((hint ? (useExactIntent ? hint.exactVariants : hint.broadVariants) : [term]) as string[])
        .map((q) => q.toLowerCase().trim())
        .filter(Boolean)
        .concat(normalizedTerm),
    ),
  );

  const runMapboxGeocoding = async (query: string) => {
    const geoUrl = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`);
    geoUrl.searchParams.set("access_token", MAPBOX_ACCESS_TOKEN);
    geoUrl.searchParams.set("autocomplete", "true");
    geoUrl.searchParams.set("limit", String(limit));
    geoUrl.searchParams.set("language", "en");
    geoUrl.searchParams.set("types", "poi");
    if (hasBounds) {
      geoUrl.searchParams.set("bbox", `${minLng},${minLat},${maxLng},${maxLat}`);
      geoUrl.searchParams.set(
        "proximity",
        `${((minLng ?? 0) + (maxLng ?? 0)) / 2},${((minLat ?? 0) + (maxLat ?? 0)) / 2}`,
      );
    }

    const geoRes = await fetch(geoUrl.toString());
    if (!geoRes.ok) return { error: "poi_upstream_failed" as const, status: geoRes.status };

    const geoData = (await geoRes.json()) as {
      features?: {
        id: string;
        text?: string;
        place_name?: string;
        center?: [number, number];
        place_type?: string[];
        properties?: { category?: string; feature_type?: string };
      }[];
    };

    const items = (geoData.features ?? [])
      .map((f) => {
        const lon = f.center?.[0];
        const lat = f.center?.[1];
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        const placeType = Array.isArray(f.place_type) ? f.place_type.join(",") : "";
        const featureType = String(f.properties?.feature_type ?? "");
        return {
          id: f.id,
          latitude: Number(lat),
          longitude: Number(lon),
          name: f.text ?? query,
          displayName: f.place_name ?? f.text ?? query,
          category: f.properties?.category ?? hint?.key ?? "poi",
          type: "mapbox-geocoding-poi",
          sourceCategory: f.properties?.category ?? "",
          sourceType: placeType,
          sourceFeatureType: featureType,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    return { items };
  };

  const runMapboxSearchBox = async (query: string) => {
    const sessionToken = randomBytes(12).toString("hex");
    const suggestUrl = new URL("https://api.mapbox.com/search/searchbox/v1/suggest");
    suggestUrl.searchParams.set("access_token", MAPBOX_ACCESS_TOKEN);
    suggestUrl.searchParams.set("q", query);
    suggestUrl.searchParams.set("language", "en");
    suggestUrl.searchParams.set("limit", String(limit));
    suggestUrl.searchParams.set("session_token", sessionToken);
    suggestUrl.searchParams.set("types", "poi");

    if (hasBounds) {
      suggestUrl.searchParams.set("bbox", `${minLng},${minLat},${maxLng},${maxLat}`);
      suggestUrl.searchParams.set(
        "proximity",
        `${((minLng ?? 0) + (maxLng ?? 0)) / 2},${((minLat ?? 0) + (maxLat ?? 0)) / 2}`,
      );
    }

    const suggestRes = await fetch(suggestUrl.toString());
    if (!suggestRes.ok) {
      // Some tokens/accounts may not have Search Box enabled; geocoding fallback keeps prod usable.
      return runMapboxGeocoding(query);
    }

    const suggestData = (await suggestRes.json()) as {
      suggestions?: {
        mapbox_id: string;
        name?: string;
        place_formatted?: string;
      }[];
    };

    let ids = (suggestData.suggestions ?? [])
      .map((s) => s.mapbox_id)
      .filter(Boolean)
      .slice(0, limit);

    // If strict POI suggest returns empty, retry once without type restriction so categories
    // like schools/parks still resolve to coordinates in viewport.
    if (!ids.length) {
      const broadSuggestUrl = new URL("https://api.mapbox.com/search/searchbox/v1/suggest");
      broadSuggestUrl.searchParams.set("access_token", MAPBOX_ACCESS_TOKEN);
      broadSuggestUrl.searchParams.set("q", query);
      broadSuggestUrl.searchParams.set("language", "en");
      broadSuggestUrl.searchParams.set("limit", String(limit));
      broadSuggestUrl.searchParams.set("session_token", sessionToken);
      if (hasBounds) {
        broadSuggestUrl.searchParams.set("bbox", `${minLng},${minLat},${maxLng},${maxLat}`);
        broadSuggestUrl.searchParams.set(
          "proximity",
          `${((minLng ?? 0) + (maxLng ?? 0)) / 2},${((minLat ?? 0) + (maxLat ?? 0)) / 2}`,
        );
      }
      const broadRes = await fetch(broadSuggestUrl.toString());
      if (broadRes.ok) {
        const broadData = (await broadRes.json()) as {
          suggestions?: { mapbox_id: string; name?: string; place_formatted?: string }[];
        };
        ids = (broadData.suggestions ?? [])
          .map((s) => s.mapbox_id)
          .filter(Boolean)
          .slice(0, limit);
      }
    }

    if (!ids.length) {
      return runMapboxGeocoding(query);
    }

    const retrieved = await Promise.all(
      ids.map(async (id) => {
        const retrieveUrl = new URL(`https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(id)}`);
        retrieveUrl.searchParams.set("access_token", MAPBOX_ACCESS_TOKEN);
        retrieveUrl.searchParams.set("session_token", sessionToken);
        const r = await fetch(retrieveUrl.toString());
        if (!r.ok) return null;
        const json = (await r.json()) as {
          features?: {
            id?: string;
            properties?: {
              name?: string;
              full_address?: string;
              feature_type?: string;
              poi_category?: string[] | string;
            };
            geometry?: { coordinates?: [number, number] };
          }[];
        };
        const f = json.features?.[0];
        const lon = f?.geometry?.coordinates?.[0];
        const lat = f?.geometry?.coordinates?.[1];
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        const sourceCategory = Array.isArray(f?.properties?.poi_category)
          ? (f?.properties?.poi_category ?? []).join(",")
          : String(f?.properties?.poi_category ?? "");
        return {
          id: f?.id ?? id,
          latitude: Number(lat),
          longitude: Number(lon),
          name: f?.properties?.name ?? query,
          displayName: f?.properties?.full_address ?? f?.properties?.name ?? query,
          category: sourceCategory || hint?.key || "poi",
          type: "mapbox-searchbox-poi",
          sourceCategory,
          sourceType: "poi",
          sourceFeatureType: String(f?.properties?.feature_type ?? ""),
        };
      }),
    );

    const normalized = retrieved.filter((x): x is NonNullable<typeof x> => Boolean(x));

    const items = hasBounds
      ? normalized.filter((row) => isInRequestedBounds(row, { minLat, maxLat, minLng, maxLng }))
      : normalized;

    return { items };
  };

  const runNominatimFallback = async (query: string, bounded = true) => {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", String(limit));
    if (hasBounds) {
      url.searchParams.set("viewbox", `${minLng},${maxLat},${maxLng},${minLat}`);
      if (bounded) url.searchParams.set("bounded", "1");
    }

    const res = await fetch(url.toString(), {
      headers: {
        "user-agent": "yourhome-prod/1.0",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) {
      return [] as {
        id: string;
        latitude: number;
        longitude: number;
        name: string;
        displayName: string;
        category: string;
        type: string;
        sourceCategory: string;
        sourceType: string;
        sourceFeatureType: string;
      }[];
    }

    const data = (await res.json()) as {
      place_id: number;
      lat: string;
      lon: string;
      display_name: string;
      type?: string;
      category?: string;
    }[];
    return data
      .map((d) => {
        const parsedLat = Number(d.lat);
        const parsedLng = Number(d.lon);
        const primaryName = String(d.display_name ?? query).split(",")[0] ?? query;
        return {
          id: `nominatim_${d.place_id}`,
          latitude: parsedLat,
          longitude: parsedLng,
          name: primaryName,
          displayName: d.display_name,
          category: d.category ?? hint?.key ?? "poi",
          type: d.type ?? "nominatim-poi",
          sourceCategory: d.category ?? "",
          sourceType: d.type ?? "",
          sourceFeatureType: "",
        };
      })
      .filter((x) => Number.isFinite(x.latitude) && Number.isFinite(x.longitude));
  };

  const runOverpassFallback = async () => {
    if (!hasBounds || !hint?.key || !["parks", "highschools", "education"].includes(hint.key))
      return [] as PoiCandidate[];

    const south = Number(minLat);
    const north = Number(maxLat);
    const west = Number(minLng);
    const east = Number(maxLng);

    let body = "";
    if (hint.key === "parks") {
      body = `[out:json][timeout:18];(node["leisure"="park"](${south},${west},${north},${east});way["leisure"="park"](${south},${west},${north},${east});node["leisure"="playground"](${south},${west},${north},${east});way["leisure"="playground"](${south},${west},${north},${east}););out center ${Math.max(limit, 40)};`;
    } else {
      body = `[out:json][timeout:18];(node["amenity"="school"](${south},${west},${north},${east});way["amenity"="school"](${south},${west},${north},${east});node["amenity"="college"](${south},${west},${north},${east});way["amenity"="college"](${south},${west},${north},${east});node["amenity"="university"](${south},${west},${north},${east});way["amenity"="university"](${south},${west},${north},${east}););out center ${Math.max(limit, 40)};`;
    }

    try {
      const res = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "user-agent": "yourhome-prod/1.0",
        },
        body: `data=${encodeURIComponent(body)}`,
      });
      if (!res.ok) return [] as PoiCandidate[];
      const data = (await res.json()) as {
        elements?: {
          id: number;
          lat?: number;
          lon?: number;
          center?: { lat: number; lon: number };
          tags?: Record<string, string>;
        }[];
      };

      return (data.elements ?? [])
        .map((el) => {
          const lat = Number(el.lat ?? el.center?.lat);
          const lng = Number(el.lon ?? el.center?.lon);
          const name = String(el.tags?.name ?? term);
          const sourceType = String(el.tags?.amenity ?? el.tags?.leisure ?? "overpass-poi");
          return {
            id: `overpass_${el.id}`,
            latitude: lat,
            longitude: lng,
            name,
            displayName: name,
            category: hint.key,
            type: "overpass-poi",
            sourceCategory: hint.key,
            sourceType,
            sourceFeatureType: "",
          } as PoiCandidate;
        })
        .filter((x) => Number.isFinite(x.latitude) && Number.isFinite(x.longitude));
    } catch {
      return [] as PoiCandidate[];
    }
  };

  let finalItems: PoiCandidate[] = [];
  let finalMode: "mapbox-searchbox" | "mapbox-geocoding" | "nominatim" = "mapbox-searchbox";

  const centerLat = hasBounds ? ((minLat as number) + (maxLat as number)) / 2 : 0;
  const centerLng = hasBounds ? ((minLng as number) + (maxLng as number)) / 2 : 0;
  const dedupeThreshold = 0.00035;

  const mbResults = await Promise.all(queryVariants.map((q) => runMapboxSearchBox(q)));
  for (const r of mbResults) {
    if ("error" in r) return r;
  }

  const mergedMb = mbResults
    .flatMap((r) => ("items" in r ? r.items : []))
    .filter(
      (item): item is PoiCandidate => item != null && Number.isFinite(item.latitude) && Number.isFinite(item.longitude),
    );

  if (mergedMb.length) {
    const ranked = mergedMb
      .map((item) => ({ ...item, distance: Math.hypot(item.latitude - centerLat, item.longitude - centerLng) }))
      .sort((a, b) => a.distance - b.distance || String(a.id).localeCompare(String(b.id)));

    const deduped: typeof ranked = [];
    for (const row of ranked) {
      const near = deduped.some(
        (d) =>
          Math.abs(d.latitude - row.latitude) < dedupeThreshold &&
          Math.abs(d.longitude - row.longitude) < dedupeThreshold,
      );
      if (near) continue;
      deduped.push(row);
      if (deduped.length >= limit) break;
    }

    finalItems = deduped.map(({ distance: _distance, ...rest }) => rest);
    finalMode = finalItems[0]?.type === "mapbox-geocoding-poi" ? "mapbox-geocoding" : "mapbox-searchbox";
  }

  if (!finalItems.length) {
    const nominatimRuns = await Promise.all(queryVariants.map((q) => runNominatimFallback(q, true)));
    let mergedNom = nominatimRuns.flat();

    if (!mergedNom.length) {
      const relaxedRuns = await Promise.all(queryVariants.map((q) => runNominatimFallback(q, false)));
      mergedNom = relaxedRuns.flat();
    }

    if (mergedNom.length) {
      const rankedNom = mergedNom
        .map((item) => ({ ...item, distance: Math.hypot(item.latitude - centerLat, item.longitude - centerLng) }))
        .sort((a, b) => a.distance - b.distance || String(a.id).localeCompare(String(b.id)));

      const dedupedNom: typeof rankedNom = [];
      for (const row of rankedNom) {
        const near = dedupedNom.some(
          (d) =>
            Math.abs(d.latitude - row.latitude) < dedupeThreshold &&
            Math.abs(d.longitude - row.longitude) < dedupeThreshold,
        );
        if (near) continue;
        dedupedNom.push(row);
        if (dedupedNom.length >= limit) break;
      }

      finalItems = dedupedNom.map(({ distance: _distance, ...rest }) => rest);
      finalMode = "nominatim";
    }
  }

  if (!finalItems.length) {
    const overpass = await runOverpassFallback();
    if (overpass.length) {
      finalItems = overpass;
      finalMode = "nominatim";
    }
  }

  if (hasBounds) {
    finalItems = finalItems.filter((row) => isInRequestedBounds(row, { minLat, maxLat, minLng, maxLng }));
  }

  const houseNumberLike = /^\s*\d{1,6}\s+[a-z0-9]/i;
  const zipLike = /,\s*[a-z]{2}\s+\d{5}(?:-\d{4})?\b/i;
  const businessParkLike =
    /\b(business park|industrial park|office park|corporate park|work park|logistics park|commerce park|commercial park)\b/i;
  const mobileHomeParkLike = /\b(mobile home park|trailer park|rv park)\b/i;
  const hasAny = (s: string, patterns: RegExp[]) => patterns.some((rx) => rx.test(s));
  const relevanceFilter = (item: PoiCandidate) => {
    const hay = `${item.name} ${item.displayName}`.toLowerCase();
    const semanticHay =
      `${item.type} ${item.category} ${item.sourceType ?? ""} ${item.sourceCategory ?? ""} ${item.sourceFeatureType ?? ""}`.toLowerCase();
    const isAddressLike = houseNumberLike.test(item.displayName) || zipLike.test(item.displayName);
    const isPoiType = /poi|point.?of.?interest/.test(semanticHay);
    const hasPoiSemantic =
      isPoiType ||
      /park|school|academy|university|college|worship|church|beach|playground|mall|shopping|lake|reservoir/.test(
        semanticHay,
      );

    switch (hint?.key) {
      case "parks": {
        const keyword = hasAny(hay, [
          /\bpark\b/,
          /playground/,
          /recreation/,
          /green\s*space/,
          /state park/,
          /national park/,
          /dog park/,
          /nature reserve/,
          /trail park/,
        ]);
        const semanticPark = /park|playground|recreation|garden|green\s*space|nature\s*reserve/.test(semanticHay);
        if (businessParkLike.test(hay)) return false;
        if (mobileHomeParkLike.test(hay)) return false;
        if (isAddressLike) return false;
        return keyword || semanticPark;
      }
      case "highschools": {
        const keyword = hasAny(hay, [
          /high\s*school/,
          /secondary\s*school/,
          /senior\s*high/,
          /\bhs\b/,
          /public school/,
          /charter school/,
        ]);
        const semanticHighSchool = /high\s*school|secondary\s*school|education|school/.test(semanticHay);
        if (isAddressLike) return false;
        return keyword || semanticHighSchool;
      }
      case "education": {
        const keyword = hasAny(hay, [
          /\bschool\b/,
          /elementary/,
          /middle\s*school/,
          /academy/,
          /university/,
          /college/,
          /campus/,
          /kindergarten/,
          /k-?12/,
        ]);
        const semanticEducation = /school|education|university|college|academy|campus/.test(semanticHay);
        if (isAddressLike) return false;
        return keyword || semanticEducation;
      }
      case "beaches": {
        const ok = hasAny(hay, [/\bbeach\b/, /shore/, /coast/, /waterfront/]);
        return ok && hasPoiSemantic && !isAddressLike;
      }
      case "worship": {
        const ok = hasAny(hay, [/church/, /cathedral/, /temple/, /mosque/, /synagogue/, /place\s*of\s*worship/]);
        return ok && hasPoiSemantic && !isAddressLike;
      }
      case "retail": {
        const ok = hasAny(hay, [/\bmall\b/, /shopping\s*center/, /retail\s*plaza/, /plaza/]);
        return ok && hasPoiSemantic && !isAddressLike;
      }
      case "water": {
        const ok = hasAny(hay, [/\blake\b/, /pond/, /reservoir/]);
        return ok && hasPoiSemantic && !isAddressLike;
      }
      default:
        return hasPoiSemantic && !isAddressLike;
    }
  };

  const strictFiltered = finalItems.filter(relevanceFilter);
  let filteredItems = strictFiltered;

  // Deep-dive guard: if strict relevance collapses to zero, apply a softer fallback
  // that still blocks address-like rows and explicit false-positive park business names.
  if (!filteredItems.length && finalItems.length) {
    filteredItems = finalItems.filter((item) => {
      const hay = `${item.name} ${item.displayName}`.toLowerCase();
      const hasHouseNumberPrefix = /^\s*\d{1,6}\s+/.test(item.displayName) || /^\s*\d{1,6}\s+/.test(item.name);
      const hasZipTail = /,\s*[a-z]{2}\s+\d{5}(?:-\d{4})?\b/i.test(item.displayName);
      if (hasHouseNumberPrefix || hasZipTail) return false;
      if (hint?.key === "parks") {
        if (businessParkLike.test(hay)) return false;
        if (mobileHomeParkLike.test(hay)) return false;
      }
      return true;
    });
  }

  finalItems = filteredItems;

  const suggestions = finalItems.length
    ? []
    : [hint?.suggestion, "parks", "schools", "beaches", "universities", "playgrounds"].filter(
        (x, i, arr): x is string => Boolean(x) && arr.indexOf(x) === i,
      );

  return { items: finalItems, term, mode: finalMode, suggestions };
};

app.get("/directory/poi-search", async (request, reply) => {
  const q = request.query as Record<string, string | undefined>;
  const term = String(q.term ?? "").trim();
  const minLat = Number(q.minLat);
  const maxLat = Number(q.maxLat);
  const minLng = Number(q.minLng);
  const maxLng = Number(q.maxLng);
  const limit = Math.min(100, Math.max(1, Number(q.limit ?? "20") || 20));

  if (!term) return reply.code(400).send({ error: "term_required" });

  try {
    const result = await searchPOI({ term, minLat, maxLat, minLng, maxLng, limit });
    if ("error" in result) {
      if (result.error === "mapbox_token_missing") {
        return reply.code(503).send(result);
      }
      if (result.error === "poi_upstream_failed" && result.status === 429) {
        return reply.code(200).send({
          items: [],
          term,
          mode: "mapbox-searchbox",
          suggestions: ["parks", "schools", "beaches", "universities", "playgrounds"],
          warning: "rate_limited",
        });
      }
      return reply.code(502).send(result);
    }

    return result;
  } catch {
    return reply.code(502).send({ error: "poi_fetch_failed" });
  }
});

app.get("/directory/poi-search/batch", async (request, reply) => {
  const q = request.query as Record<string, string | undefined>;
  const terms = String(q.terms ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8);

  const minLat = Number(q.minLat);
  const maxLat = Number(q.maxLat);
  const minLng = Number(q.minLng);
  const maxLng = Number(q.maxLng);
  const limit = Math.min(70, Math.max(1, Number(q.limit ?? "40") || 40));

  if (!terms.length) return reply.code(400).send({ error: "terms_required" });

  const now = Date.now();
  const termResults = await Promise.all(
    terms.map(async (term) => {
      const input: PoiSearchInput = { term, minLat, maxLat, minLng, maxLng, limit };
      const key = makePoiBatchCacheKey(input);
      const cached = poiBatchCache.get(key);
      if (cached && now - cached.at < POI_BATCH_CACHE_TTL_MS) {
        return { term, result: cached.result, source: "cache" as const };
      }

      const result = await searchPOI(input);
      if ("error" in result) {
        return {
          term,
          error: result.error,
          status: (result as PoiSearchError & { status?: number }).status,
          source: "upstream" as const,
        };
      }

      let typed = result as PoiSearchResult;

      // If strict viewport query returns empty, retry once with a padded bbox to improve
      // in-view completeness near edges and reduce false-empty responses.
      if (
        typed.items.length === 0 &&
        Number.isFinite(minLat) &&
        Number.isFinite(maxLat) &&
        Number.isFinite(minLng) &&
        Number.isFinite(maxLng)
      ) {
        const latPad = Math.max((maxLat - minLat) * 0.35, 0.01);
        const lngPad = Math.max((maxLng - minLng) * 0.35, 0.01);
        const expanded: PoiSearchInput = {
          term,
          minLat: Math.max(-90, minLat - latPad),
          maxLat: Math.min(90, maxLat + latPad),
          minLng: Math.max(-180, minLng - lngPad),
          maxLng: Math.min(180, maxLng + lngPad),
          limit,
        };
        const expandedResult = await searchPOI(expanded);
        if (!("error" in expandedResult) && expandedResult.items.length > 0) {
          typed = {
            ...expandedResult,
            items: expandedResult.items.filter((row) => isInRequestedBounds(row, { minLat, maxLat, minLng, maxLng })),
          } as PoiSearchResult;
        }
      }

      if (typed.items.length > 0) {
        poiBatchCache.set(key, { at: now, result: typed });
      }
      return { term, result: typed, source: "live" as const };
    }),
  );

  const centerLat = Number.isFinite(minLat) && Number.isFinite(maxLat) ? (minLat + maxLat) / 2 : 0;
  const centerLng = Number.isFinite(minLng) && Number.isFinite(maxLng) ? (minLng + maxLng) / 2 : 0;

  const dedupeThreshold = 0.00035;
  const cappedPerTerm = new Map<string, number>();

  const ranked = termResults.flatMap((row) => {
    if (!("result" in row) || !row.result) return [] as any[];

    return row.result.items
      .filter(
        (
          item,
        ): item is {
          id: string;
          latitude: number;
          longitude: number;
          name: string;
          displayName: string;
          category: string;
          type: string;
        } => Boolean(item) && Number.isFinite(item.latitude) && Number.isFinite(item.longitude),
      )
      .map((item) => {
        const distanceScore = Math.hypot(item.latitude - centerLat, item.longitude - centerLng);
        return { ...item, term: row.term, source: row.source, distanceScore };
      });
  });

  ranked.sort((a, b) => a.distanceScore - b.distanceScore || String(a.id).localeCompare(String(b.id)));

  const dedupedAndCapped: {
    id: string;
    latitude: number;
    longitude: number;
    name: string;
    displayName: string;
    category: string;
    type: string;
    term: string;
    source: "cache" | "live";
  }[] = [];
  for (const item of ranked) {
    const alreadyNear = dedupedAndCapped.some(
      (d) =>
        d.term === item.term &&
        Math.abs(d.latitude - item.latitude) < dedupeThreshold &&
        Math.abs(d.longitude - item.longitude) < dedupeThreshold,
    );
    if (alreadyNear) continue;

    const c = cappedPerTerm.get(item.term) ?? 0;
    if (c >= limit) continue;
    cappedPerTerm.set(item.term, c + 1);

    dedupedAndCapped.push({
      id: item.id,
      latitude: item.latitude,
      longitude: item.longitude,
      name: item.name,
      displayName: item.displayName,
      category: item.category,
      type: item.type,
      term: item.term,
      source: item.source,
    });
  }

  return {
    terms,
    items: dedupedAndCapped,
    perTerm: termResults.map((row) => {
      if ("result" in row && row.result) {
        const count = dedupedAndCapped.filter((x) => x.term === row.term).length;
        const status =
          row.source === "cache"
            ? ("stale" as const)
            : count < MIN_POI_PER_TERM
              ? ("sparse" as const)
              : ("ok" as const);
        return {
          term: row.term,
          status,
          mode: row.result.mode,
          count,
          source: row.source,
          suggestions: row.result.suggestions,
        };
      }

      return {
        term: row.term,
        status: row.error === "poi_upstream_failed" && row.status === 429 ? ("timeout" as const) : ("error" as const),
        error: row.error,
        upstreamStatus: row.status,
        source: row.source,
      };
    }),
    cacheTtlMs: POI_BATCH_CACHE_TTL_MS,
  };
});

app.post("/admin/bootstrap-first", async (request, reply) => {
  if (!ADMIN_BOOTSTRAP_KEY) {
    return reply.code(503).send({ error: "admin_bootstrap_not_enabled" });
  }

  const providedKey = request.headers["x-bootstrap-key"];
  if (providedKey !== ADMIN_BOOTSTRAP_KEY) {
    return reply.code(401).send({ error: "invalid_bootstrap_key" });
  }

  const existingAdmin = await prisma.user.findFirst({ where: { role: "admin" }, select: { id: true } });
  if (existingAdmin) {
    return reply.code(409).send({ error: "admin_already_exists" });
  }

  const parsed = bootstrapAdminSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const { email, password } = parsed.data;

  const existingEmail = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existingEmail) return reply.code(409).send({ error: "email_in_use" });

  const admin = await prisma.user.create({
    data: {
      email,
      passwordHash: hashPassword(password),
      role: "admin",
      verificationStatus: "verified",
      emailVerifiedAt: new Date(),
    },
    select: {
      id: true,
      email: true,
      role: true,
      verificationStatus: true,
      emailVerifiedAt: true,
      preferredLanguage: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: admin.id,
      action: "admin_bootstrap_created",
      entityType: "user",
      entityId: admin.id,
      afterJson: JSON.stringify({ role: admin.role }),
    },
  });

  return reply.code(201).send({ admin });
});

app.post("/auth/oauth/:provider/start", async (request, reply) => {
  const provider = getProvider((request.params as { provider: string }).provider);
  if (!provider) return reply.code(404).send({ error: "oauth_provider_not_supported" });
  if (!oauthProviderEnabled[provider]) return reply.code(403).send({ error: "oauth_provider_disabled" });
  if (!oauthProviderImplemented[provider]) {
    return reply.code(501).send({
      error: "oauth_provider_not_implemented",
      provider,
      action: `Do not surface ${provider} sign-in in mobile yet. Only email/password is currently supported end-to-end.`,
    });
  }

  const parsed = oauthStartSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  if (!isAllowedRedirectUri(parsed.data.redirectUri)) {
    return reply.code(400).send({ error: "oauth_redirect_uri_not_allowed" });
  }

  const cfg = oauthConfig[provider];
  if (!cfg.clientId || !cfg.clientSecret) {
    return reply.code(503).send({
      error: "oauth_provider_credentials_missing",
      provider,
      action: `Set OAUTH_${provider.toUpperCase()}_CLIENT_ID and OAUTH_${provider.toUpperCase()}_CLIENT_SECRET before testing ${provider} OAuth.`,
    });
  }

  oauthTransactions.set(parsed.data.state, {
    provider,
    redirectUri: parsed.data.redirectUri,
    state: parsed.data.state,
    nonce: parsed.data.nonce,
    codeChallenge: parsed.data.codeChallenge,
    createdAt: Date.now(),
  });

  const authorizationUrl = buildOAuthAuthUrl(provider, parsed.data);
  return { authorizationUrl, state: parsed.data.state };
});

app.post("/auth/oauth/:provider/callback", async (request, reply) => {
  const provider = getProvider((request.params as { provider: string }).provider);
  if (!provider) return reply.code(404).send({ error: "oauth_provider_not_supported" });
  if (!oauthProviderEnabled[provider]) return reply.code(403).send({ error: "oauth_provider_disabled" });

  const parsed = oauthCallbackSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const txn = oauthTransactions.get(parsed.data.state);
  oauthTransactions.delete(parsed.data.state);
  if (!txn || txn.provider !== provider) return reply.code(400).send({ error: "oauth_state_invalid" });
  if (Date.now() - txn.createdAt > oauthTxnTtlMs) return reply.code(400).send({ error: "oauth_state_expired" });
  if (txn.redirectUri !== parsed.data.redirectUri)
    return reply.code(400).send({ error: "oauth_redirect_uri_mismatch" });
  if (txn.nonce !== parsed.data.nonce) return reply.code(400).send({ error: "oauth_nonce_mismatch" });

  const cfg = oauthConfig[provider];
  if (!cfg.clientId || !cfg.clientSecret) {
    return reply.code(503).send({
      error: "oauth_provider_credentials_missing",
      provider,
      action: `Set OAUTH_${provider.toUpperCase()}_CLIENT_ID and OAUTH_${provider.toUpperCase()}_CLIENT_SECRET.`,
    });
  }

  if (provider !== "google") {
    return reply.code(501).send({
      error: "oauth_provider_not_implemented",
      provider,
      action: `Scaffold validated: ${provider} start/callback + redirect checks work. Complete token exchange wiring next.`,
    });
  }

  const tokenResp = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: parsed.data.code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: parsed.data.redirectUri,
      grant_type: "authorization_code",
      code_verifier: parsed.data.codeVerifier,
    }),
  });

  if (!tokenResp.ok) {
    const failure = await tokenResp.text();
    return reply.code(401).send({ error: "oauth_token_exchange_failed", provider, detail: failure.slice(0, 400) });
  }

  const tokenJson = (await tokenResp.json()) as { access_token?: string; id_token?: string };
  if (!tokenJson.access_token) return reply.code(401).send({ error: "oauth_access_token_missing" });

  const profileResp = await fetch(oauthConfig.google.userInfoUrl, {
    headers: { authorization: `Bearer ${tokenJson.access_token}` },
  });

  if (!profileResp.ok) return reply.code(401).send({ error: "oauth_profile_fetch_failed" });
  const profile = (await profileResp.json()) as { email?: string };
  const email = profile.email?.toLowerCase();
  if (!email) return reply.code(400).send({ error: "oauth_email_missing" });

  const existing = await prisma.user.findUnique({ where: { email } });
  const user =
    existing ??
    (await prisma.user.create({
      data: {
        email,
        passwordHash: hashPassword(randomBytes(24).toString("hex")),
        role: "guest",
        verificationStatus: "none",
        emailVerifiedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        role: true,
        verificationStatus: true,
        emailVerifiedAt: true,
        preferredLanguage: true,
      },
    }));

  return issueSession(reply, user);
});

app.post("/auth/email-check", async (request, reply) => {
  const parsed = emailCheckSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const email = parsed.data.email;
  try {
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    return { valid: true, available: !existing, source: "db" };
  } catch (error) {
    request.log.warn({ err: error }, "email-check failed: db unavailable");
    return reply.code(503).send({
      error: "email_check_unavailable",
      valid: true,
      available: null,
      source: "db_unavailable",
    });
  }
});

app.post("/auth/register", async (request, reply) => {
  void cleanupRefreshTokens().catch(() => undefined);
  const ip = getClientIp(request);
  const attempt = await consumeAuthAttempt(`register:${ip}`);
  if (attempt.blocked) {
    return reply.code(429).send({ error: "too_many_attempts", retryAfterSec: attempt.retryAfterSec });
  }

  const parsed = registerSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const { email, password, phone } = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return reply.code(409).send({ error: "email_in_use" });

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: hashPassword(password),
      phone,
      role: "guest",
      verificationStatus: "none",
    },
    select: {
      id: true,
      email: true,
      role: true,
      verificationStatus: true,
      emailVerifiedAt: true,
      preferredLanguage: true,
    },
  });

  await clearAuthAttempts(`register:${ip}`);
  const session = await issueSession(reply, user);

  const meta = getAuthLogMeta(request);
  await prisma.auditLog.create({
    data: {
      actorUserId: user.id,
      action: "auth_register",
      entityType: "user",
      entityId: user.id,
      ipHash: meta.ipHash,
      deviceHash: meta.deviceHash,
      afterJson: JSON.stringify({ role: user.role }),
    },
  });

  return reply.code(201).send(session);
});

app.post("/auth/login", async (request, reply) => {
  void cleanupRefreshTokens().catch(() => undefined);
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const { email, password } = parsed.data;
  const ip = getClientIp(request);
  const attemptKey = `login:${email}:${ip}`;
  const attempt = await consumeAuthAttempt(attemptKey);

  if (attempt.blocked) {
    return reply.code(429).send({ error: "too_many_attempts", retryAfterSec: attempt.retryAfterSec });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return reply.code(401).send({ error: "invalid_credentials" });

  const ok = verifyPassword(password, user.passwordHash);
  if (!ok) return reply.code(401).send({ error: "invalid_credentials" });

  await clearAuthAttempts(attemptKey);

  const session = await issueSession(reply, user);

  const meta = getAuthLogMeta(request);
  await prisma.auditLog.create({
    data: {
      actorUserId: session.user.id,
      action: "auth_login",
      entityType: "user",
      entityId: session.user.id,
      ipHash: meta.ipHash,
      deviceHash: meta.deviceHash,
      afterJson: JSON.stringify({ role: session.user.role }),
    },
  });

  return session;
});

app.post("/auth/refresh", async (request, reply) => {
  void cleanupRefreshTokens().catch(() => undefined);
  const parsed = refreshSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const tokenHash = hashRefreshToken(parsed.data.refreshToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    return reply.code(401).send({ error: "invalid_refresh_token" });
  }

  const user = await prisma.user.findUnique({
    where: { id: stored.userId },
    select: {
      id: true,
      email: true,
      role: true,
      verificationStatus: true,
      emailVerifiedAt: true,
      preferredLanguage: true,
    },
  });
  if (!user) return reply.code(401).send({ error: "invalid_refresh_token" });

  await revokeRefreshToken(parsed.data.refreshToken);

  const session = await issueSession(reply, user);

  const meta = getAuthLogMeta(request);
  await prisma.auditLog.create({
    data: {
      actorUserId: user.id,
      action: "auth_refresh",
      entityType: "user",
      entityId: user.id,
      ipHash: meta.ipHash,
      deviceHash: meta.deviceHash,
      afterJson: JSON.stringify({ rotated: true }),
    },
  });

  return session;
});

app.post("/auth/logout", { preHandler: [auth] }, async (request, reply) => {
  void cleanupRefreshTokens().catch(() => undefined);
  const parsed = logoutSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const userId = getCurrentUser(request).id;
  if (!parsed.data.allDevices && !parsed.data.refreshToken) {
    return reply.code(400).send({
      error: "refresh_token_required",
      action: "Send refreshToken for single-device logout, or set allDevices=true to revoke every session.",
    });
  }

  if (parsed.data.allDevices) {
    await revokeAllRefreshTokensForUser(userId);
  } else if (parsed.data.refreshToken) {
    const tokenHash = hashRefreshToken(parsed.data.refreshToken);
    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { userId: true, revokedAt: true, expiresAt: true },
    });
    if (!stored || stored.userId !== userId || stored.revokedAt || stored.expiresAt < new Date()) {
      return reply.code(401).send({ error: "invalid_refresh_token" });
    }
    await revokeRefreshToken(parsed.data.refreshToken);
  }

  const meta = getAuthLogMeta(request);
  await prisma.auditLog.create({
    data: {
      actorUserId: userId,
      action: parsed.data.allDevices ? "auth_logout_all" : "auth_logout",
      entityType: "user",
      entityId: userId,
      ipHash: meta.ipHash,
      deviceHash: meta.deviceHash,
      afterJson: JSON.stringify({ allDevices: Boolean(parsed.data.allDevices) }),
    },
  });

  return { ok: true };
});

app.get("/auth/me", { preHandler: [auth] }, async (request, reply) => {
  const userId = getCurrentUser(request).id;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      verificationStatus: true,
      emailVerifiedAt: true,
      preferredLanguage: true,
      createdAt: true,
    },
  });
  if (!user) return reply.code(401).send({ error: "unauthorized" });
  return { user: serializeUser(user) };
});

app.get("/user/preferences/language", { preHandler: [auth] }, async (request, reply) => {
  const userId = getCurrentUser(request).id;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { preferredLanguage: true } });
  if (!user) return reply.code(401).send({ error: "unauthorized" });
  return { language: user.preferredLanguage ?? "en" };
});

app.put("/user/preferences/language", { preHandler: [auth] }, async (request, reply) => {
  const parsed = languagePreferenceSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });

  const userId = getCurrentUser(request).id;
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { preferredLanguage: parsed.data.language },
    select: {
      id: true,
      email: true,
      role: true,
      verificationStatus: true,
      emailVerifiedAt: true,
      preferredLanguage: true,
      createdAt: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: userId,
      action: "user_language_preference_set",
      entityType: "user",
      entityId: userId,
      afterJson: JSON.stringify({ preferredLanguage: parsed.data.language, persistence: "user.preferredLanguage" }),
    },
  });

  return { ok: true, language: updated.preferredLanguage, user: serializeUser(updated) };
});

app.post("/uploads/presign", { preHandler: [auth] }, async (request, reply) => {
  const parsed = uploadPresignSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const { fileName, mimeType } = parsed.data;

  if (STORAGE_PROVIDER !== "s3") {
    return { mode: "local" };
  }

  if (!s3Client || !S3_BUCKET) {
    return reply.code(503).send({ error: "storage_not_configured" });
  }

  try {
    const key = makeUploadObjectKey(fileName);
    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: mimeType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });
    const fileUrl = resolvePublicFileUrl(key);

    return { mode: "s3", uploadUrl, fileUrl, key };
  } catch {
    return reply.code(500).send({ error: "presign_failed" });
  }
});

app.post("/uploads/documents", { preHandler: [auth] }, async (request, reply) => {
  const parsed = uploadDocumentSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const { fileName, mimeType, base64 } = parsed.data;

  try {
    const buffer = Buffer.from(base64, "base64");
    if (buffer.byteLength > 10 * 1024 * 1024) {
      return reply.code(413).send({ error: "file_too_large" });
    }

    if (STORAGE_PROVIDER === "s3") {
      if (!s3Client || !S3_BUCKET) {
        return reply.code(503).send({ error: "storage_not_configured" });
      }

      const key = makeUploadObjectKey(fileName);
      await s3Client.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
        }),
      );

      const url = resolvePublicFileUrl(key);
      return reply.code(201).send({ url, fileName: key, mimeType });
    }

    const key = makeUploadObjectKey(fileName);
    const localName = key.split("/").pop() ?? key;
    const outputPath = path.join(uploadsDir, localName);

    await fs.mkdir(uploadsDir, { recursive: true });
    await fs.writeFile(outputPath, buffer);

    const url = resolvePublicFileUrl(localName);
    return reply.code(201).send({ url, fileName: localName, mimeType });
  } catch {
    return reply.code(500).send({ error: "upload_failed" });
  }
});

app.get("/history/:entityType/:entityId", { preHandler: [auth] }, async (request, reply) => {
  const parsedParams = historyParamsSchema.safeParse(request.params);
  if (!parsedParams.success) {
    return reply.code(400).send({ error: "invalid_params", issues: parsedParams.error.flatten() });
  }

  const { entityType, entityId } = parsedParams.data;
  const actor = getCurrentUser(request);

  const dbUser = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { role: true },
  });

  if (!dbUser) return reply.code(401).send({ error: "unauthorized" });

  const isReviewer = ["reviewer", "admin"].includes(dbUser.role);
  if (!isReviewer) {
    if (entityType === "listing") {
      const listing = await prisma.listing.findUnique({ where: { id: entityId }, select: { createdByUserId: true } });
      if (!listing) return reply.code(404).send({ error: "not_found" });
      if (listing.createdByUserId !== actor.id) return reply.code(403).send({ error: "forbidden" });
    } else {
      const submission = await prisma.verificationSubmission.findUnique({
        where: { id: entityId },
        select: { userId: true },
      });
      if (!submission) return reply.code(404).send({ error: "not_found" });
      if (submission.userId !== actor.id) return reply.code(403).send({ error: "forbidden" });
    }
  }

  const logs = await prisma.auditLog.findMany({
    where: { entityType, entityId },
    include: { actor: { select: { email: true, role: true } } },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  const timeline = logs.map((log) => {
    let reviewNotes: string | null = null;
    try {
      const parsed = log.afterJson ? (JSON.parse(log.afterJson) as { reviewNotes?: string | null }) : null;
      reviewNotes = parsed?.reviewNotes ?? null;
    } catch {
      reviewNotes = null;
    }

    return {
      id: log.id,
      at: log.createdAt,
      action: log.action,
      status: deriveTimelineStatus(log.action, log.afterJson),
      reviewNotes,
      actor: log.actor ? { email: log.actor.email, role: log.actor.role } : null,
    };
  });

  return { count: timeline.length, timeline };
});

app.post("/verification-submissions", { preHandler: [auth] }, async (request, reply) => {
  const parsed = verificationSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const payload = parsed.data;
  const normalizedAddress = normalizeAddress(payload);

  const existingProperty = await prisma.property.findFirst({ where: { normalizedAddress } });
  const property =
    existingProperty ??
    (await prisma.property.create({
      data: {
        addressLine1: payload.addressLine1,
        city: payload.city,
        state: payload.state,
        zip: payload.zip,
        normalizedAddress,
      },
    }));

  const userId = getCurrentUser(request).id;
  const submission = await prisma.verificationSubmission.create({
    data: {
      userId,
      propertyId: property.id,
      status: "pending",
      docsJson: payload.docsJson,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: userId,
      action: "verification_submission_created",
      entityType: "verification_submission",
      entityId: submission.id,
      afterJson: JSON.stringify({ propertyId: property.id, status: submission.status }),
    },
  });

  return reply.code(201).send({ submissionId: submission.id, status: submission.status });
});

app.get("/verification-submissions/me", { preHandler: [auth] }, async (request) => {
  const userId = getCurrentUser(request).id;
  const submissions = await prisma.verificationSubmission.findMany({
    where: { userId },
    include: { property: true },
    orderBy: { submittedAt: "desc" },
    take: 50,
  });

  return { count: submissions.length, submissions };
});

app.post("/verification-submissions/:id/resubmit", { preHandler: [auth] }, async (request, reply) => {
  const parsed = verificationResubmitSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const { id } = request.params as { id: string };
  const userId = getCurrentUser(request).id;

  const existing = await prisma.verificationSubmission.findUnique({ where: { id } });
  if (!existing) return reply.code(404).send({ error: "submission_not_found" });
  if (existing.userId !== userId) return reply.code(403).send({ error: "forbidden" });
  if (existing.status !== "needs_more_info") {
    return reply.code(409).send({ error: "submission_not_resubmittable", status: existing.status });
  }

  const updated = await prisma.verificationSubmission.update({
    where: { id },
    data: {
      status: "pending",
      docsJson: parsed.data.docsJson,
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,
      submittedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: userId,
      action: "verification_submission_resubmitted",
      entityType: "verification_submission",
      entityId: updated.id,
      afterJson: JSON.stringify({ status: updated.status }),
    },
  });

  return { submissionId: updated.id, status: updated.status };
});

app.post("/listings", { preHandler: [auth] }, async (request, reply) => {
  const parsed = createListingSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const userId = getCurrentUser(request).id;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, verificationStatus: true },
  });

  if (!user || user.role !== "homeowner" || user.verificationStatus !== "verified") {
    return reply.code(403).send({ error: "homeowner_verification_required" });
  }

  const payload = parsed.data;
  const property = await prisma.property.findUnique({ where: { id: payload.propertyId } });
  if (!property) return reply.code(404).send({ error: "property_not_found" });
  if (property.ownerUserId !== userId) return reply.code(403).send({ error: "not_property_owner" });

  const listing = await prisma.listing.create({
    data: {
      propertyId: payload.propertyId,
      createdByUserId: userId,
      status: "pending_review",
      title: payload.title,
      description: payload.description,
      price: payload.price,
      photosJson: payload.photosJson,
      trustBadge: "none",
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: userId,
      action: "listing_created",
      entityType: "listing",
      entityId: listing.id,
      afterJson: JSON.stringify({ status: listing.status }),
    },
  });

  return reply.code(201).send({ listingId: listing.id, status: listing.status });
});

app.get("/listings", async () => {
  const listings = await prisma.listing.findMany({
    where: { status: "approved" },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      title: true,
      description: true,
      price: true,
      trustBadge: true,
      updatedAt: true,
      property: { select: { city: true, state: true, zip: true } },
    },
  });

  return { count: listings.length, listings };
});

app.get("/listings/me", { preHandler: [auth] }, async (request) => {
  const userId = getCurrentUser(request).id;
  const listings = await prisma.listing.findMany({
    where: { createdByUserId: userId },
    include: { property: true },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  const listingIds = listings.map((l) => l.id);
  const reviewLogs = listingIds.length
    ? await prisma.auditLog.findMany({
        where: {
          entityType: "listing",
          entityId: { in: listingIds },
          action: { in: ["listing_needs_more_info", "listing_rejected", "listing_approved"] },
        },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const latestReviewNoteByListingId = new Map<string, string | null>();
  for (const log of reviewLogs) {
    if (latestReviewNoteByListingId.has(log.entityId)) continue;
    try {
      const after = log.afterJson ? JSON.parse(log.afterJson) : null;
      latestReviewNoteByListingId.set(log.entityId, (after?.reviewNotes as string | undefined) ?? null);
    } catch {
      latestReviewNoteByListingId.set(log.entityId, null);
    }
  }

  const maintenanceByProperty = await getMaintenanceSummaryByPropertyIds(
    Array.from(new Set(listings.map((l) => l.propertyId))),
  );

  const enriched = listings.map((listing) => {
    const maintenance = maintenanceByProperty.get(listing.propertyId) ?? {
      completedWithEvidence: 0,
      lastCompletedAt: null,
    };

    return {
      ...listing,
      reviewNotes: latestReviewNoteByListingId.get(listing.id) ?? null,
      valuePreservation: {
        maintenanceTracked: maintenance.completedWithEvidence > 0,
        completedWithEvidence: maintenance.completedWithEvidence,
        lastCompletedAt: maintenance.lastCompletedAt,
      },
    };
  });

  return { count: enriched.length, listings: enriched };
});

app.post("/listings/:id/resubmit", { preHandler: [auth] }, async (request, reply) => {
  const parsed = listingResubmitSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const { id } = request.params as { id: string };
  const userId = getCurrentUser(request).id;

  const target = await prisma.listing.findUnique({ where: { id } });
  if (!target) return reply.code(404).send({ error: "listing_not_found" });
  if (target.createdByUserId !== userId) return reply.code(403).send({ error: "forbidden" });
  if (target.status !== "needs_more_info") {
    return reply.code(409).send({ error: "listing_not_resubmittable", status: target.status });
  }

  const updated = await prisma.listing.update({
    where: { id },
    data: {
      title: parsed.data.title,
      description: parsed.data.description,
      price: parsed.data.price,
      photosJson: parsed.data.photosJson,
      status: "pending_review",
      trustBadge: "none",
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: userId,
      action: "listing_resubmitted",
      entityType: "listing",
      entityId: updated.id,
      afterJson: JSON.stringify({ status: updated.status }),
    },
  });

  return { listingId: updated.id, status: updated.status };
});

app.get("/property-manager/entitlement", { preHandler: [auth] }, async (request) => {
  const user = getCurrentUser(request);
  const enabled = await hasPropertyManagerEntitlement(user);
  return {
    enabled,
    plan: enabled ? "premium" : "free",
    reason: enabled ? "active" : "upgrade_required",
  };
});

app.post("/property-manager/upgrade-intent", { preHandler: [auth] }, async (request, reply) => {
  const parsed = upgradeIntentSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const user = getCurrentUser(request);
  await prisma.auditLog.create({
    data: {
      actorUserId: user.id,
      action: "property_manager_upgrade_intent",
      entityType: "user",
      entityId: user.id,
      afterJson: JSON.stringify({ source: parsed.data.source ?? "mobile_cta", note: parsed.data.note ?? null }),
    },
  });

  return {
    ok: true,
    message: "Upgrade interest captured. Billing flow stub pending.",
  };
});

app.post("/billing/property-manager/checkout-stub", { preHandler: [auth] }, async (request, reply) => {
  const parsed = startCheckoutSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const user = getCurrentUser(request);
  if (await hasPropertyManagerEntitlement(user)) {
    return { ok: true, alreadyEntitled: true };
  }

  const baseUrl = process.env.PROPERTY_MANAGER_UPGRADE_URL ?? "https://billing-stub.yourhome.local/property-manager";
  const checkoutUrl = `${baseUrl}?uid=${encodeURIComponent(user.id)}&email=${encodeURIComponent(user.email)}`;

  await prisma.auditLog.create({
    data: {
      actorUserId: user.id,
      action: "property_manager_checkout_started",
      entityType: "user",
      entityId: user.id,
      afterJson: JSON.stringify({ source: parsed.data.source ?? "mobile_cta", checkoutUrl }),
    },
  });

  return { ok: true, checkoutUrl, mode: "stub" };
});

app.get("/property-manager/suggestions", { preHandler: [auth] }, async (request, reply) => {
  const userId = getCurrentUser(request).id;
  const props = await prisma.property.findMany({ where: { ownerUserId: userId }, take: 20 });
  if (!props.length) return reply.code(404).send({ error: "no_owned_properties" });

  const suggestions = props.flatMap((property) =>
    localMaintenanceSuggestions(property.city).map((s) => ({
      ...s,
      propertyId: property.id,
      city: property.city,
      state: property.state,
    })),
  );

  return { count: suggestions.length, suggestions };
});

app.get("/property-manager/plans", { preHandler: [auth] }, async (request, reply) => {
  const currentUser = getCurrentUser(request);
  if (!(await hasPropertyManagerEntitlement(currentUser))) {
    return reply.code(402).send({ error: "premium_required", feature: "property_manager" });
  }

  const userId = currentUser.id;
  const plans = await prisma.maintenancePlan.findMany({
    where: { property: { ownerUserId: userId }, active: true },
    include: {
      property: { select: { id: true, addressLine1: true, city: true, state: true } },
      tasks: { where: { status: "upcoming" }, orderBy: { dueAt: "asc" }, take: 1 },
    },
    orderBy: { nextDueAt: "asc" },
    take: 100,
  });

  return { count: plans.length, plans };
});

app.post("/property-manager/plans", { preHandler: [auth] }, async (request, reply) => {
  const parsed = maintenancePlanSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const currentUser = getCurrentUser(request);
  if (!(await hasPropertyManagerEntitlement(currentUser))) {
    return reply.code(402).send({ error: "premium_required", feature: "property_manager" });
  }

  const userId = currentUser.id;
  const property = await prisma.property.findUnique({ where: { id: parsed.data.propertyId } });
  if (!property) return reply.code(404).send({ error: "property_not_found" });
  if (property.ownerUserId !== userId) return reply.code(403).send({ error: "not_property_owner" });

  const dueAt = new Date(parsed.data.nextDueAt);

  const plan = await prisma.maintenancePlan.create({
    data: {
      propertyId: parsed.data.propertyId,
      title: parsed.data.title,
      description: parsed.data.description,
      cadenceMonths: parsed.data.cadenceMonths,
      nextDueAt: dueAt,
      source: parsed.data.source ?? "manual",
      premiumRequired: true,
      tasks: {
        create: {
          propertyId: parsed.data.propertyId,
          status: "upcoming",
          dueAt,
        },
      },
    },
    include: { tasks: true },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: userId,
      action: "maintenance_plan_created",
      entityType: "maintenance_plan",
      entityId: plan.id,
      afterJson: JSON.stringify({ cadenceMonths: plan.cadenceMonths, nextDueAt: plan.nextDueAt }),
    },
  });

  return reply.code(201).send({ plan });
});

app.post("/property-manager/tasks/:id/complete", { preHandler: [auth] }, async (request, reply) => {
  const parsed = completeMaintenanceTaskSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });
  }

  const currentUser = getCurrentUser(request);
  if (!(await hasPropertyManagerEntitlement(currentUser))) {
    return reply.code(402).send({ error: "premium_required", feature: "property_manager" });
  }

  const userId = currentUser.id;
  const { id } = request.params as { id: string };

  const task = await prisma.maintenanceTask.findUnique({
    where: { id },
    include: { property: true, plan: true },
  });

  if (!task) return reply.code(404).send({ error: "task_not_found" });
  if (task.property.ownerUserId !== userId) return reply.code(403).send({ error: "forbidden" });
  if (task.status === "completed") return reply.code(409).send({ error: "already_completed" });

  const completedAt = new Date();
  await prisma.maintenanceTask.update({
    where: { id: task.id },
    data: {
      status: "completed",
      completedAt,
      completionNote: parsed.data.completionNote,
      beforeEvidenceUrl: parsed.data.beforeEvidenceUrl,
      afterEvidenceUrl: parsed.data.afterEvidenceUrl,
    },
  });

  const nextDue = new Date(completedAt);
  nextDue.setMonth(nextDue.getMonth() + task.plan.cadenceMonths);

  const nextTask = await prisma.maintenanceTask.create({
    data: {
      planId: task.planId,
      propertyId: task.propertyId,
      status: "upcoming",
      dueAt: nextDue,
    },
  });

  await prisma.maintenancePlan.update({ where: { id: task.planId }, data: { nextDueAt: nextDue } });

  await prisma.auditLog.create({
    data: {
      actorUserId: userId,
      action: "maintenance_task_completed",
      entityType: "maintenance_task",
      entityId: task.id,
      afterJson: JSON.stringify({
        nextTaskId: nextTask.id,
        nextDueAt: nextDue,
        beforeEvidenceUrl: parsed.data.beforeEvidenceUrl,
        afterEvidenceUrl: parsed.data.afterEvidenceUrl,
      }),
    },
  });

  return { ok: true, nextTask };
});

app.get("/review/listings", { preHandler: [auth, requireRoles(["reviewer", "admin"])] }, async (request) => {
  const status = (request.query as { status?: string }).status ?? "pending_review";
  const listings = await prisma.listing.findMany({
    where: { status },
    include: {
      property: true,
      createdBy: { select: { id: true, email: true, role: true, verificationStatus: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  const maintenanceByProperty = await getMaintenanceSummaryByPropertyIds(
    Array.from(new Set(listings.map((l) => l.propertyId))),
  );

  const enriched = listings.map((listing) => {
    const maintenance = maintenanceByProperty.get(listing.propertyId) ?? {
      completedWithEvidence: 0,
      lastCompletedAt: null,
    };

    return {
      ...listing,
      valuePreservation: {
        maintenanceTracked: maintenance.completedWithEvidence > 0,
        completedWithEvidence: maintenance.completedWithEvidence,
        lastCompletedAt: maintenance.lastCompletedAt,
      },
    };
  });

  return { count: enriched.length, listings: enriched };
});

app.get(
  "/review/property-manager/upgrade-intents",
  { preHandler: [auth, requireRoles(["reviewer", "admin"])] },
  async () => {
    const [logs, statusLogs] = await Promise.all([
      prisma.auditLog.findMany({
        where: { action: "property_manager_upgrade_intent", entityType: "user" },
        include: {
          actor: { select: { id: true, email: true, role: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.auditLog.findMany({
        where: { action: "property_manager_upgrade_intent_status_set", entityType: "upgrade_intent" },
        orderBy: { createdAt: "desc" },
        take: 300,
      }),
    ]);

    const latestStatusByIntentId = new Map<
      string,
      {
        status: "new" | "contacted" | "converted";
        at: string;
        note?: string | null;
        followUpDueAt?: string | null;
        followUpOwner?: string | null;
      }
    >();
    for (const log of statusLogs) {
      if (latestStatusByIntentId.has(log.entityId)) continue;
      try {
        const parsed = log.afterJson
          ? (JSON.parse(log.afterJson) as {
              status?: "new" | "contacted" | "converted";
              note?: string | null;
              followUpDueAt?: string | null;
              followUpOwner?: string | null;
            })
          : null;
        const status = parsed?.status ?? "new";
        latestStatusByIntentId.set(log.entityId, {
          status,
          at: log.createdAt.toISOString(),
          note: parsed?.note ?? null,
          followUpDueAt: parsed?.followUpDueAt ?? null,
          followUpOwner: parsed?.followUpOwner ?? null,
        });
      } catch {
        latestStatusByIntentId.set(log.entityId, {
          status: "new",
          at: log.createdAt.toISOString(),
          note: null,
          followUpDueAt: null,
          followUpOwner: null,
        });
      }
    }

    const intents = logs.map((log) => {
      let details: { source?: string; note?: string | null } = {};
      try {
        details = log.afterJson ? (JSON.parse(log.afterJson) as { source?: string; note?: string | null }) : {};
      } catch {
        details = {};
      }

      const statusMeta = latestStatusByIntentId.get(log.id);

      return {
        id: log.id,
        at: log.createdAt,
        user: log.actor ? { id: log.actor.id, email: log.actor.email, role: log.actor.role } : null,
        source: details.source ?? null,
        note: details.note ?? null,
        status: statusMeta?.status ?? "new",
        statusUpdatedAt: statusMeta?.at ?? null,
        statusNote: statusMeta?.note ?? null,
        followUpDueAt: statusMeta?.followUpDueAt ?? null,
        followUpOwner: statusMeta?.followUpOwner ?? null,
      };
    });

    const summary = intents.reduce(
      (acc, intent) => {
        const status = intent.status ?? "new";
        if (status === "converted") {
          acc.converted += 1;
          const ts = intent.statusUpdatedAt ? new Date(intent.statusUpdatedAt).getTime() : 0;
          if (ts > acc.lastConvertedAtMs) {
            acc.lastConvertedAtMs = ts;
            acc.lastConvertedAt = intent.statusUpdatedAt;
          }
        } else if (status === "contacted") {
          acc.contacted += 1;
        } else {
          acc.new += 1;
        }
        return acc;
      },
      { new: 0, contacted: 0, converted: 0, lastConvertedAt: null as string | null, lastConvertedAtMs: 0 },
    );

    const conversionRate = intents.length ? Number(((summary.converted / intents.length) * 100).toFixed(1)) : 0;
    const now = Date.now();
    const dueTodayDate = new Date(now);
    dueTodayDate.setHours(0, 0, 0, 0);
    const dueTomorrowDate = new Date(dueTodayDate);
    dueTomorrowDate.setDate(dueTomorrowDate.getDate() + 1);

    const followUpSummary = intents.reduce(
      (acc, intent) => {
        if ((intent.status ?? "new") !== "contacted") return acc;
        if (!intent.followUpDueAt) {
          acc.noDueDate += 1;
          return acc;
        }
        const dueTs = new Date(intent.followUpDueAt).getTime();
        if (dueTs < dueTodayDate.getTime()) acc.overdue += 1;
        else if (dueTs < dueTomorrowDate.getTime()) acc.dueToday += 1;
        return acc;
      },
      { dueToday: 0, overdue: 0, noDueDate: 0 },
    );

    return {
      count: intents.length,
      intents,
      summary: {
        new: summary.new,
        contacted: summary.contacted,
        converted: summary.converted,
        lastConvertedAt: summary.lastConvertedAt,
        conversionRate,
        followUp: followUpSummary,
      },
    };
  },
);

app.get(
  "/review/property-manager/upgrade-intents/:id/trace",
  { preHandler: [auth, requireRoles(["reviewer", "admin"])] },
  async (request, reply) => {
    const { id } = request.params as { id: string };

    const intent = await prisma.auditLog.findUnique({
      where: { id },
      include: { actor: { select: { id: true, email: true, role: true } } },
    });

    if (!intent || intent.action !== "property_manager_upgrade_intent") {
      return reply.code(404).send({ error: "upgrade_intent_not_found" });
    }

    const userId = intent.entityId;

    const [statusLogs, userLogs] = await Promise.all([
      prisma.auditLog.findMany({
        where: { entityType: "upgrade_intent", entityId: id },
        include: { actor: { select: { email: true, role: true } } },
        orderBy: { createdAt: "asc" },
        take: 100,
      }),
      prisma.auditLog.findMany({
        where: {
          entityType: "user",
          entityId: userId,
          action: {
            in: [
              "property_manager_upgrade_intent",
              "property_manager_checkout_started",
              "property_manager_entitlement_set",
            ],
          },
        },
        include: { actor: { select: { email: true, role: true } } },
        orderBy: { createdAt: "asc" },
        take: 100,
      }),
    ]);

    const events = [...userLogs, ...statusLogs]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((log) => {
        let reviewNotes: string | null = null;
        try {
          const parsed = log.afterJson
            ? (JSON.parse(log.afterJson) as { note?: string | null; reviewNotes?: string | null })
            : null;
          reviewNotes = parsed?.note ?? parsed?.reviewNotes ?? null;
        } catch {
          reviewNotes = null;
        }

        return {
          id: log.id,
          at: log.createdAt,
          action: log.action,
          entityType: log.entityType,
          entityId: log.entityId,
          status: deriveTimelineStatus(log.action, log.afterJson),
          reviewNotes,
          actor: log.actor ? { email: log.actor.email, role: log.actor.role } : null,
        };
      });

    return {
      ok: true,
      intentId: id,
      userId,
      userEmail: intent.actor?.email ?? null,
      events,
    };
  },
);

app.post(
  "/review/property-manager/upgrade-intents/:id/status",
  { preHandler: [auth, requireRoles(["reviewer", "admin"])] },
  async (request, reply) => {
    const parsed = updateUpgradeIntentStatusSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });
    }

    const { id } = request.params as { id: string };
    const actorId = getCurrentUser(request).id;

    const intent = await prisma.auditLog.findUnique({ where: { id } });
    if (!intent || intent.action !== "property_manager_upgrade_intent") {
      return reply.code(404).send({ error: "upgrade_intent_not_found" });
    }

    await prisma.auditLog.create({
      data: {
        actorUserId: actorId,
        action: "property_manager_upgrade_intent_status_set",
        entityType: "upgrade_intent",
        entityId: id,
        afterJson: JSON.stringify({
          status: parsed.data.status,
          note: parsed.data.note ?? null,
          followUpDueAt: parsed.data.followUpDueAt ? parsed.data.followUpDueAt.toISOString() : null,
          followUpOwner: parsed.data.followUpOwner ?? null,
        }),
      },
    });

    return { ok: true, id, status: parsed.data.status };
  },
);

app.post(
  "/review/property-manager/entitlements/:userId",
  { preHandler: [auth, requireRoles(["reviewer", "admin"])] },
  async (request, reply) => {
    const parsed = setEntitlementSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });
    }

    const { userId } = request.params as { userId: string };
    const actorId = getCurrentUser(request).id;

    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!target) return reply.code(404).send({ error: "user_not_found" });

    await prisma.userEntitlement.upsert({
      where: {
        userId_feature: {
          userId,
          feature: "property_manager",
        },
      },
      create: {
        userId,
        feature: "property_manager",
        enabled: parsed.data.enabled,
        source: "reviewer",
        note: parsed.data.note ?? null,
        createdByUserId: actorId,
      },
      update: {
        enabled: parsed.data.enabled,
        source: "reviewer",
        note: parsed.data.note ?? null,
        createdByUserId: actorId,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: actorId,
        action: "property_manager_entitlement_set",
        entityType: "user",
        entityId: userId,
        afterJson: JSON.stringify({
          enabled: parsed.data.enabled,
          note: parsed.data.note ?? null,
          persistence: "user_entitlement",
        }),
      },
    });

    return { ok: true, userId, enabled: parsed.data.enabled, persistence: "user_entitlement" };
  },
);

app.post(
  "/review/listings/:id/decision",
  { preHandler: [auth, requireRoles(["reviewer", "admin"])] },
  async (request, reply) => {
    const parsed = listingDecisionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });
    }

    const { id } = request.params as { id: string };
    const { decision, reviewNotes } = parsed.data;
    const actorId = getCurrentUser(request).id;

    const target = await prisma.listing.findUnique({ where: { id } });
    if (!target) return reply.code(404).send({ error: "listing_not_found" });
    if (!["pending_review", "needs_more_info"].includes(target.status)) {
      return reply.code(409).send({ error: "listing_already_reviewed", status: target.status });
    }

    const nextStatus = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "needs_more_info";
    const trustBadge = decision === "approve" ? "verified_by_yourhome" : "none";

    const updated = await prisma.listing.update({
      where: { id: target.id },
      data: { status: nextStatus, trustBadge },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: actorId,
        action: `listing_${nextStatus}`,
        entityType: "listing",
        entityId: target.id,
        beforeJson: JSON.stringify({ status: target.status, trustBadge: target.trustBadge }),
        afterJson: JSON.stringify({
          status: updated.status,
          trustBadge: updated.trustBadge,
          reviewNotes: reviewNotes ?? null,
        }),
      },
    });

    return { listingId: updated.id, status: updated.status, trustBadge: updated.trustBadge };
  },
);

app.get(
  "/review/verification-submissions",
  { preHandler: [auth, requireRoles(["reviewer", "admin"])] },
  async (request) => {
    const status = (request.query as { status?: string }).status ?? "pending";
    const submissions = await prisma.verificationSubmission.findMany({
      where: { status },
      include: {
        user: { select: { id: true, email: true, role: true, verificationStatus: true } },
        property: true,
      },
      orderBy: { submittedAt: "asc" },
      take: 100,
    });

    return { count: submissions.length, submissions };
  },
);

app.post(
  "/review/verification-submissions/:id/decision",
  { preHandler: [auth, requireRoles(["reviewer", "admin"])] },
  async (request, reply) => {
    const parsed = verificationDecisionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_payload", issues: parsed.error.flatten() });
    }

    const { id } = request.params as { id: string };
    const { decision, reviewNotes } = parsed.data;
    const actorId = getCurrentUser(request).id;

    const target = await prisma.verificationSubmission.findUnique({
      where: { id },
      include: { user: true, property: true },
    });

    if (!target) return reply.code(404).send({ error: "submission_not_found" });
    if (!["pending", "needs_more_info"].includes(target.status)) {
      return reply.code(409).send({ error: "submission_already_reviewed", status: target.status });
    }

    const reviewedStatus = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "needs_more_info";

    const updatedSubmission = await prisma.verificationSubmission.update({
      where: { id: target.id },
      data: {
        status: reviewedStatus,
        reviewedBy: actorId,
        reviewedAt: new Date(),
        reviewNotes,
      },
    });

    if (decision === "approve") {
      await prisma.user.update({
        where: { id: target.userId },
        data: { role: "homeowner", verificationStatus: "verified" },
      });

      await prisma.property.update({
        where: { id: target.propertyId },
        data: { ownerUserId: target.userId },
      });
    } else if (decision === "reject") {
      await prisma.user.update({
        where: { id: target.userId },
        data: { verificationStatus: "rejected" },
      });
    } else {
      await prisma.user.update({
        where: { id: target.userId },
        data: { verificationStatus: "needs_more_info" },
      });
    }

    await prisma.auditLog.create({
      data: {
        actorUserId: actorId,
        action: `verification_submission_${reviewedStatus}`,
        entityType: "verification_submission",
        entityId: target.id,
        beforeJson: JSON.stringify({ status: "pending" }),
        afterJson: JSON.stringify({
          status: reviewedStatus,
          reviewedBy: actorId,
          reviewNotes: reviewNotes ?? null,
        }),
      },
    });

    return {
      submissionId: updatedSubmission.id,
      status: updatedSubmission.status,
      reviewedBy: updatedSubmission.reviewedBy,
      reviewedAt: updatedSubmission.reviewedAt,
    };
  },
);

const start = async () => {
  try {
    const port = Number(process.env.PORT ?? "3000");
    const host = process.env.HOST ?? "0.0.0.0";
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("PORT must be an integer between 1 and 65535");
    }
    if (!["0.0.0.0", "127.0.0.1", "::1"].includes(host)) {
      throw new Error("HOST must be one of 0.0.0.0, 127.0.0.1, or ::1");
    }
    await fs.mkdir(uploadsDir, { recursive: true });
    await app.listen({ port, host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

let isShuttingDown = false;
const shutdown = async (signal: "SIGINT" | "SIGTERM" | "SIGBREAK") => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  app.log.info({ signal }, "API shutdown requested");

  let exitCode = 0;
  try {
    await app.close();
  } catch (error) {
    app.log.error(error, "API shutdown failed");
    exitCode = 1;
  } finally {
    try {
      await prisma.$disconnect();
    } catch (error) {
      app.log.error(error, "Prisma disconnect failed");
      exitCode = 1;
    }
    process.exit(exitCode);
  }
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGBREAK", () => void shutdown("SIGBREAK"));

void start();
