# Dependency Security Baseline

Date: 2026-07-27

Baseline commit: `6d7388664fbb7d6049a8fe9d9d666c009ec39c98`

Initial audit branch: `chore/dependency-security-audit`

## Purpose

This document records the dependency advisories present after the quality-gate foundation was merged. Audit counts are scanner findings in the resolved dependency graph; they are not a count of confirmed exploitable bugs in YourHome source code. Production and development results overlap and must not be added together.

The quality-gate branch introduced no advisory IDs. Relative to its parent, it reduced each applicable audit view by five high-severity findings and one moderate finding.

## Baseline counts

| Audit view               | Low | Moderate | High | Critical | Total |
| ------------------------ | --: | -------: | ---: | -------: | ----: |
| Production dependencies  |   3 |       24 |   30 |        5 |    62 |
| Development dependencies |   3 |       20 |   32 |        1 |    56 |

## First remediation slice result

The authentication and routing slice was applied and verified on 2026-07-27. It introduced no new advisory IDs.

| Audit view               | Low | Moderate | High | Critical | Total |
| ------------------------ | --: | -------: | ---: | -------: | ----: |
| Production dependencies  |   3 |       20 |   22 |        2 |    47 |
| Development dependencies |   3 |       20 |   27 |        1 |    51 |

- All `fast-jwt`, Fastify, and `find-my-way` advisory paths present in the baseline disappeared.
- The compatible transitive refresh also resolved `fast-uri 3.1.0` to `3.1.4`, removing four additional high-severity advisory IDs without adding another override.
- Registration, login, protected routes, refresh rotation, logout revocation, reviewer authorization, migrations, and disposable-database cleanup passed in the isolated API smoke.
- These tests preserve current security properties for this maintenance change. They are not intended to prevent deliberate future authentication, authorization, role, or product-flow changes; intentional changes should update the relevant contracts and documentation in the same reviewed feature work.

## Second remediation slice result

The static-file serving slice was applied and verified on 2026-07-27. It introduced no new advisory IDs.

| Audit view               | Low | Moderate | High | Critical | Total |
| ------------------------ | --: | -------: | ---: | -------: | ----: |
| Production dependencies  |   3 |       17 |   21 |        2 |    43 |
| Development dependencies |   3 |       20 |   27 |        1 |    51 |

- All four `@fastify/static` advisory IDs present after slice 1 disappeared.
- Canonical `/uploads/*` delivery still works, while dot segments, encoded dot segments, encoded forward and backward separators, duplicate slashes, and attempts to escape the uploads root are rejected.
- `@fastify/static 10.1.2` normalizes non-canonical URL paths before applying path policy. YourHome also rejects backslashes in upload paths because Windows treats them as filesystem separators.
- The isolated API smoke passed with the upgraded plugin, including migrations, authentication, authorization, and disposable-database cleanup.

## Third remediation slice result

The AWS S3/XML slice was applied and verified on 2026-07-27. It introduced no new advisory IDs.

| Audit view               | Low | Moderate | High | Critical | Total |
| ------------------------ | --: | -------: | ---: | -------: | ----: |
| Production dependencies  |   2 |       15 |   19 |        1 |    37 |
| Development dependencies |   3 |       20 |   27 |        1 |    51 |

- All six `fast-xml-parser` advisory IDs present after slice 2 disappeared because the updated AWS XML builder no longer depends on that parser.
- Direct and presigned PUTs passed against a uniquely named disposable MinIO bucket with generated per-run credentials, keys, container name, and port.
- The contract verified content type, object bytes, key behavior, XML-backed list and error responses, bucket deletion, and container cleanup.

## Fourth remediation slice result

The email-delivery slice was applied and verified on 2026-07-27. It introduced no new advisory IDs.

| Audit view               | Low | Moderate | High | Critical | Total |
| ------------------------ | --: | -------: | ---: | -------: | ----: |
| Production dependencies  |   1 |       10 |   17 |        1 |    29 |
| Development dependencies |   3 |       20 |   27 |        1 |    51 |

- All eight direct Nodemailer advisory IDs present after slice 3 disappeared, including two high-severity findings: `1109804`, `1115470`, `1116270`, `1120795`, `1120796`, `1120797`, `1121191`, and `1123478`.
- A disposable authenticated loopback SMTPS contract verified rejection of an untrusted certificate, TLS 1.2-or-newer delivery with the explicitly trusted test certificate, and the exact sender, recipient, subject, plain-text body, HTML body, and accepted-message response.
- The committed certificate and private key are non-secret disposable test fixtures. They are not production credentials and must never be deployed as an application certificate.
- Production email configuration and account-verification behavior remain unchanged. Future intentional email-provider, template, or product-flow changes may update this maintenance contract in the same reviewed feature work.

## Compatibility boundaries

- Preserve Expo SDK `55.0.28`, React Native `0.83.6`, `@expo/cli 55.0.34`, and EAS CLI `21.0.2` until the Expo compatibility matrix supports a coordinated upgrade.
- Preserve Prisma `7.9.0`; it is the current project baseline and currently has no newer release available.
- Prefer direct upgrades and same-major transitive fixes over broad overrides.
- Every override must use an exact vulnerable selector and an exact compatible target unless its parent dependency contract has been independently verified.
- Do not force `brace-expansion` 1.x or 2.x to 5.x. The export shape and Node requirements are incompatible.

## Prioritized remediation slices

### 1. API authentication and routing

Targets:

- `@fastify/jwt`: `9.1.0` -> `10.2.1`
- transitive `fast-jwt`: `5.0.6` -> `6.2.4`
- `fastify`: `5.7.4` -> `5.8.5`
- exact override `find-my-way@9.6.0` -> `9.7.0` for Prisma's pinned development path

Why first:

- Removes three critical and one high `fast-jwt` advisories plus associated moderate findings.
- Removes the direct Fastify high finding and the `find-my-way` high finding.
- Authentication is a deployed application path, unlike most remaining mobile-tooling findings.

Compatibility evidence:

- YourHome uses a required static JWT secret, scalar claims, `reply.jwtSign`, and `request.jwtVerify` without namespaces, cookies, async key resolvers, custom token extraction, or claim-regex options.
- `@fastify/jwt 10.2.1` explicitly supports Fastify 5.x and requires Node 20 or newer; CI uses Node 24.
- A disposable installation passed API build, API scripts type-check, lint, frozen installation, scalar token signing/verification, two-user claim separation, and invalid-bearer rejection.
- No API source change is expected.

Required acceptance:

- Add a dependency-floor regression contract before changing the manifest and observe it fail.
- Add or run a focused JWT runtime contract for valid scalar claims, two distinct users, tampered/invalid bearer tokens, and unauthorized responses.
- Run the disposable API smoke for registration, login, protected routes, refresh rotation, logout, and reviewer authorization.
- Confirm `fast-jwt`, Fastify, and `find-my-way` advisories disappear from both audit views.

### 2. Static-file serving

Status:

- `@fastify/static`: `8.3.0` -> `10.1.2` completed
- application-level backslash rejection added for Windows path safety

Required acceptance:

- Verify canonical `/uploads/*` delivery.
- Reject traversal and encoded-separator probes, including `%2e%2e`, `%2f`, `%5c`, mixed separators, and doubled slashes.
- Confirm no file outside the configured uploads directory can be disclosed.

### 3. AWS S3

Status:

- `@aws-sdk/client-s3`: `3.986.0` -> `3.1095.0` completed
- `@aws-sdk/s3-request-presigner`: `3.986.0` -> `3.1095.0` completed

Expected effect:

- Removes the `fast-xml-parser 5.3.4` path: one critical, two high, two moderate, and one low finding.

Required acceptance:

- Test presigned PUT and direct upload against a disposable S3-compatible bucket.
- Verify content type, body, object key behavior, and cleanup.

### 4. Email delivery

Status:

- `nodemailer`: `6.10.1` -> `9.0.3` completed
- `@types/nodemailer`: `7.0.11` -> `8.0.1` completed

Expected effect:

- Removes eight direct Nodemailer findings, including two high-severity advisories.

Required acceptance:

- Test a real disposable SMTP endpoint or staging account.
- Verify recipient, sender, subject, text, HTML, and accepted-message response.
- Preserve strict TLS verification; do not disable certificate validation to make a test pass.

### 5. Prisma development transitives

Status:

- `fast-uri`: `3.1.0` -> `3.1.4` completed through the compatible slice-1 lock refresh; no override was required
- retain the narrow `find-my-way@9.6.0` -> `9.7.0` override from slice 1

Required acceptance:

- Run Prisma generation, validation, configuration contract, scripts type-check, migration integrity, and disposable PostgreSQL smoke.
- Keep these overrides only while Prisma's published dependency graph requires them.

### 6. Expo-compatible mobile and reviewer tooling

Safe exact refresh targets without changing the Expo SDK or React Native matrix:

- `node-forge 1.3.3` -> `1.4.0`
- `@xmldom/xmldom 0.8.11` -> `0.8.13`
- `ws 7.5.10` -> `7.5.11`
- `ws 8.19.0` -> `8.21.1`
- `js-yaml 3.14.2` -> `3.15.0`
- `js-yaml 4.1.1` -> `4.3.0`
- `shell-quote 1.8.3` -> `1.10.0`
- reviewer-web `vite 7.3.1` -> `7.3.6`
- `rollup 4.57.1` -> `4.62.3`
- reviewer-web `postcss 8.5.6` -> `8.5.23`

Required acceptance:

- Frozen installation, audit path inspection, Expo dependency check, quality-gate contract, workspace topology, Expo Go/native-runtime contract, lint, format, and full build.
- Exercise reviewer-web development WebSocket behavior, Metro/dev-client hot reload, React DevTools connectivity, Expo configuration/export, code-signing where credentials are available, and the patched tunnel path.

## Explicit deferral

The remaining vulnerable `brace-expansion` 1.x and 2.x paths must not be scanner-fixed with the existing 5.x override. Keep only:

```yaml
"brace-expansion@5.0.7": 5.0.8
```

Defer 1.x until an Expo-supported React Native/codegen stack replaces the legacy `glob`/`minimatch` chain. Defer 2.x until EAS CLI upgrades its parent dependency stack. Reassess during a future supported Expo SDK upgrade rather than moving React Native independently.

## Repository-wide verification for every completed slice

```text
CI=true pnpm install --frozen-lockfile
pnpm run lint
pnpm run build
pnpm run format:check
pnpm test:quality-gates
pnpm test:jwt-security
pnpm test:email-security
pnpm test:static-file-security
pnpm test:s3-security
pnpm test:migration-integrity
pnpm test:expo-go-config
pnpm test:run:check
pnpm test:close:check
pnpm test:prisma-config
pnpm audit --prod --json
pnpm audit --dev --json
git diff --check
```

Audit commands may remain nonzero while out-of-scope baseline findings exist. Acceptance is based on exact advisory IDs and dependency paths for the slice, not on suppressing the command or lowering its severity threshold.
