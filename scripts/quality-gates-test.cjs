const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
const readJson = (relativePath) => JSON.parse(read(relativePath));

const rootPackage = readJson("package.json");
const apiPackage = readJson("apps/api/package.json");
const workspacePackages = [
  "apps/api/package.json",
  "apps/mobile/package.json",
  "apps/reviewer-web/package.json",
  "packages/shared/package.json",
];

assert.equal(
  rootPackage.scripts["test:quality-gates"],
  "node scripts/quality-gates-test.cjs",
  "the root package must expose the quality-gate source contract",
);
assert.equal(
  rootPackage.scripts["test:jwt-security"],
  "pnpm --filter api test:jwt-security",
  "the root package must expose the JWT runtime security contract",
);
assert.equal(
  rootPackage.scripts["test:static-file-security"],
  "pnpm --filter api test:static-file-security",
  "the root package must expose the static-file security contract",
);
assert.equal(
  rootPackage.scripts["test:s3-security"],
  "pnpm --filter api test:s3-security",
  "the root package must expose the disposable S3 security contract",
);
assert.equal(
  rootPackage.scripts["test:email-security"],
  "pnpm --filter api test:email-security",
  "the root package must expose the SMTP email security contract",
);
assert.equal(rootPackage.scripts.lint, "eslint . --max-warnings 0");
const formatTargets =
  "apps packages scripts .github eslint.config.mjs .prettierrc.json package.json pnpm-workspace.yaml";
assert.equal(rootPackage.scripts.format, `prettier --write ${formatTargets}`);
assert.equal(rootPackage.scripts["format:check"], `prettier --check ${formatTargets}`);
assert.equal(rootPackage.devDependencies["@eslint/js"], "10.0.1");
assert.equal(rootPackage.devDependencies.eslint, "10.8.0");
assert.equal(rootPackage.devDependencies["eslint-plugin-react-hooks"], "7.1.1");
assert.equal(rootPackage.devDependencies.globals, "16.5.0");
assert.equal(rootPackage.devDependencies.prettier, "3.9.6");
assert.equal(rootPackage.devDependencies["typescript-eslint"], "8.65.0");
assert.equal(rootPackage.devDependencies["eslint-config-expo"], undefined);

for (const packagePath of workspacePackages) {
  const workspacePackage = readJson(packagePath);
  assert.equal(workspacePackage.scripts.lint, "eslint . --max-warnings 0", `${packagePath} must perform real linting`);
  assert.equal(workspacePackage.scripts.format, "prettier --write .", `${packagePath} must perform real formatting`);
  assert.doesNotMatch(JSON.stringify(workspacePackage.scripts), /placeholder/i);
}

assert.ok(
  fs.existsSync(path.join(repoRoot, "eslint.config.mjs")),
  "the repository must have a flat ESLint configuration",
);
assert.ok(
  fs.existsSync(path.join(repoRoot, ".prettierignore")),
  "generated and evidence files must be excluded from formatting",
);
const prettierIgnore = read(".prettierignore");
assert.match(
  prettierIgnore,
  /^pnpm-workspace\.yaml$/m,
  "the lifecycle-sensitive pnpm patch registry must retain its validated syntax",
);

const workspaceConfig = read("pnpm-workspace.yaml");
assert.match(workspaceConfig, /^ {2}'brace-expansion@5\.0\.7': 5\.0\.8$/m);
assert.equal(
  apiPackage.dependencies["@fastify/jwt"],
  "^10.2.1",
  "the API must use the Fastify JWT line that resolves fast-jwt 6.2.4 or newer",
);
assert.equal(
  apiPackage.dependencies.fastify,
  "^5.8.5",
  "the API must keep Fastify at or above the first release fixing the current direct advisories",
);
assert.equal(
  apiPackage.dependencies["@fastify/static"],
  "^10.1.2",
  "the API must use the first static-file release fixing all current route and path-policy advisories",
);
assert.equal(
  apiPackage.dependencies["@aws-sdk/client-s3"],
  "^3.1095.0",
  "the API must use the verified S3 client line that removes the vulnerable XML parser ancestry",
);
assert.equal(
  apiPackage.dependencies["@aws-sdk/s3-request-presigner"],
  "^3.1095.0",
  "the API S3 client and presigner must stay on the same verified release line",
);
assert.equal(
  apiPackage.dependencies.nodemailer,
  "^9.0.3",
  "the API must use the first reviewed Nodemailer line fixing all current direct advisories",
);
assert.equal(
  apiPackage.devDependencies["@types/nodemailer"],
  "^8.0.1",
  "the API must use the compatible Nodemailer type definitions",
);
assert.equal(
  apiPackage.scripts["test:email-security"],
  "tsx scripts/email-security-contract.ts",
  "the API must expose the SMTP email runtime contract",
);
assert.equal(
  apiPackage.scripts["test:s3-security"],
  "node scripts/s3-security-supervisor-test.cjs && node scripts/s3-security-supervisor.cjs",
  "the API must expose the disposable S3-compatible runtime contract",
);
assert.equal(
  apiPackage.scripts["test:static-file-security"],
  "tsx scripts/static-file-security-contract.ts",
  "the API must expose the static-file runtime security contract",
);
const apiIndexSource = read("apps/api/src/index.ts");
assert.match(
  apiIndexSource,
  /app\.register\(fastifyStatic,\s*createUploadStaticOptions\(uploadsDir\)\)/s,
  "the production static plugin must use the shared upload security options exercised by the runtime contract",
);
assert.match(
  workspaceConfig,
  /^ {2}'find-my-way@9\.6\.0': 9\.7\.0$/m,
  "Prisma's exact vulnerable find-my-way resolution must receive the narrow 9.7.0 security override",
);
assert.doesNotMatch(
  workspaceConfig,
  /^ {2}(?:'find-my-way'|find-my-way):/m,
  "find-my-way overrides must target the exact vulnerable 9.6.0 resolution instead of future versions",
);

const verifyCodeSource = read("apps/mobile/app/verify-code.tsx");
assert.match(verifyCodeSource, /const autoSentEmailRef = useRef<string \| null>\(null\);/);
assert.match(
  verifyCodeSource,
  /if \(autoSentEmailRef\.current === email\) return;\s*autoSentEmailRef\.current = email;\s*void sendCode\(\);/,
  "automatic OTP sends must be keyed to the email instead of translation callback identity",
);

const workflow = read(".github/workflows/foundation-ci.yml");
assert.match(workflow, /run: pnpm run test:quality-gates/);
assert.match(workflow, /run: pnpm test:jwt-security/);
assert.match(workflow, /run: pnpm test:static-file-security/);
assert.match(workflow, /run: pnpm test:s3-security/);
assert.match(workflow, /run: pnpm test:email-security/);
assert.match(workflow, /run: pnpm run format:check/);

console.log("[quality-gates-test] PASS: lint and formatting checks are real and enforced in CI.");
