# YourHome

YourHome is a home-listing application. A homeowner registers, verifies their email, and submits ownership verification. A reviewer approves that verification. The verified homeowner creates a listing, a reviewer approves the listing, and approved listings are available on the public browse endpoint.

This repository is a local and development foundation. It is not a launched App Store or Google Play application, and it does not include production hosting, monitoring, or store-release credentials.

## Architecture

- `apps/api` — Fastify API with Prisma 7 and PostgreSQL. It owns authentication, email verification, ownership verification, listing review, public listing browse, uploads, and related reviewer operations.
- `apps/mobile` — Expo SDK 55 / React Native application for homeowners. Native map support uses `@rnmapbox/maps`, so the full native app needs a development client. Expo Go does not include that native code.
- `apps/reviewer-web` — Vite reviewer application. It talks to the API at `http://localhost:3000` and is used to review verification submissions and listings.
- `packages/shared` — shared TypeScript types.
- `infra/docker-compose.yml` — local PostgreSQL 16 (`yourhome` / `yourhome_dev` on port `5432`).

The generated Prisma client under `apps/api/src/generated/prisma` is ignored. API `build`, `dev`, seed, and Prisma test commands generate it explicitly.

## Prerequisites

- Node.js 24 or newer (foundation CI uses Node.js 24.18.0)
- pnpm 10.17.1 (`packageManager` in the root `package.json`; Corepack can install it)
- Docker with Compose, for local PostgreSQL

Windows full-stack launcher extras:

- Android Studio with the Android SDK, platform-tools, emulator, JDK, and a configured AVD named `Pixel_7`
- For physical-iPhone QR testing, Apple Developer Program access and an installed SDK 55 YourHome iOS development client. Expo Go is insufficient because YourHome requires native Mapbox code. The launcher can validate tunnel, manifest, and bundle readiness without the phone.

## Local setup

From the repository root:

```bash
pnpm install
```

The repository `.npmrc` applies the required copy-based hoisted pnpm topology during a plain install. On Windows, `pnpm test:run` additionally places the virtual store beneath `Y:\node_modules\.pnpm` to keep Metro and native paths short.

Create the API environment file and set at least `JWT_SECRET` and `ADMIN_BOOTSTRAP_KEY`:

```bash
cp apps/api/.env.example apps/api/.env
```

On Windows PowerShell, the same copy is `Copy-Item .\apps\api\.env.example .\apps\api\.env`.

Start PostgreSQL:

```bash
docker compose -f infra/docker-compose.yml up -d
```

Apply the existing Prisma migration history:

```bash
pnpm --filter api prisma:validate
pnpm --filter api prisma:generate
pnpm --filter api prisma:deploy
pnpm --filter api prisma:status
```

The Prisma 7 runtime upgrade does not create a database migration. Use `pnpm --filter api prisma:migrate -- --name <descriptive-name>` only for an intentional future data-model change. Run `pnpm --filter api prisma:seed` only against the database you intend to seed.

Start the API:

```bash
pnpm --filter api dev
```

Health check: `http://localhost:3000/health`

Start the reviewer web app (Vite's default port, `http://localhost:5173`):

```bash
pnpm --filter reviewer-web dev
```

`pnpm dev` starts the API and reviewer web app together. It does not start PostgreSQL or the mobile app.

Start the mobile app:

```bash
pnpm --filter mobile dev
```

`pnpm --filter mobile web` starts the Expo web target. `pnpm --filter mobile android` starts an Expo Go tunnel and is not acceptance evidence for the native Mapbox client. Physical-device and store builds use the EAS scripts in `apps/mobile/package.json` and the notes in `docs/IOS_DEVELOPMENT_BUILD.md` and `docs/ANDROID_RELEASE_SIGNING_RUNBOOK.md`.

## Windows full local test run

From the repository root on Windows:

```powershell
pnpm test:run
```

This restart-safe launcher brings up the complete local test environment:

- Docker Desktop and PostgreSQL
- Prisma migrations and the API on `http://localhost:3000`
- the Android emulator and native YourHome development client
- Android Metro on port `8081`
- an iOS development-client terminal with an Expo tunnel QR code on port `8082`
- the web app at `http://localhost:8082`

The launcher fingerprints native inputs, records the exact installed APK identity, and automatically rebuilds the development client when that identity changes. Otherwise, normal runs reuse the verified native client and let Metro deliver JavaScript changes. Use `pnpm test:run:reset` only to permit a scoped data wipe of the designated `Pixel_7` AVD when emulator storage is too low for installation. Ordinary test runs never wipe emulator data.

Scan the QR shown in the **YourHome iOS QR + Web** terminal and open it in the installed YourHome iOS development client. The QR uses an Expo tunnel, while the bundle keeps the app-specific `0.1.0-sdk55` runtime and EAS Update URL expected by that native client. Do not open the raw local HTTP address in Safari; iOS HTTPS-Only mode blocks it before the development client can load the project. The tunnel can reload more slowly than LAN mode. The launcher supplies the computer's LAN API address to the iOS bundle, so keep the iPhone on the same local network as this computer while testing API-backed flows.

This is a local development environment: it exposes the API to the LAN and the development bundle through an Expo tunnel. Do not run it on an untrusted network. Web auth credentials are intentionally memory-only during local testing and are cleared by a full page reload; non-sensitive preferences remain in browser storage.

On Windows, the launcher maps this checkout to `Y:` and keeps pnpm's hoisted virtual store inside `Y:\node_modules\.pnpm`. Metro and Expo exports use the short path, while Gradle runs from the physical checkout so React Native autolinking and codegen never mix drive letters for package roots. The launcher verifies that React, React DOM, Expo Router, and renderer packages resolve to one hoisted identity. If stale workspace-local links from an isolated pnpm install are detected, it first stops launcher-owned API and Metro consumers, removes only the generated workspace `node_modules` directories, performs a frozen copy-based hoisted install, and verifies the topology again. If `Y:` is already mapped to another location, remove or change that mapping before running the launcher.

Validate the launcher without starting services:

```powershell
pnpm test:run:check
```

## Windows full local test close

Close the complete YourHome test environment with:

```powershell
pnpm test:close
```

Test close stops only launcher-recorded API, Metro, and Expo process trees, force-stops the YourHome Android app, closes `Pixel_7` only when this launcher started its current emulator boot, and stops the project PostgreSQL container while preserving its Docker data volume. A reused emulator remains running because its boot is not launcher-owned. Test close verifies both the owned emulator's exact boot identity and its persisted PID/start-time process tree before deleting ownership state. An unavailable probe fails closed and retains that state. It leaves Docker Desktop itself running so unrelated containers are not disrupted. Use `-KeepDatabase` or `-KeepEmulator` when invoking `scripts/test-close.ps1` directly if either resource should remain available. `-KeepEmulator` preserves the emulator ownership record so a later test close can still identify and close a launcher-owned boot.

The final repository audit prints the branch, working-tree status, upstream, and ahead/behind counts. It deliberately does not commit or push automatically. Uncommitted files remain on disk and are called out as a warning.

Validate test close without stopping anything:

```powershell
pnpm test:close:check
```

## API smoke test

`pnpm smoke:api` checks the core flow against a disposable database: register, email verification, ownership verification, reviewer decision, listing create, listing approval, and public browse.

Start PostgreSQL first, then run:

```bash
pnpm smoke:api
```

- The command creates a uniquely named `yourhome_prisma7_smoke_*` database, applies the existing migrations, starts an isolated compiled API on port `3100`, forces SMTP delivery off, and drops the database during cleanup.
- Override only the isolated port with `SMOKE_API_PORT`. The database prefix guard and cleanup stay mandatory.
- `pnpm --filter api smoke` is the internal HTTP worker used by the guarded wrapper. It requires a one-run capability and database identity exposed only by the supervisor-started disposable API, so invoking it directly against the normal development API fails before any write request.

## Tests and CI

`.github/workflows/foundation-ci.yml` runs on pull requests to `master` and on pushes to `master`. `master` requires both jobs:

- **Cross-platform foundation** (Linux) installs the frozen pnpm graph, verifies migration integrity and Prisma configuration, runs the JWT, static-file, S3, and email security contracts, checks quality-gate configuration, lints the workspace, checks formatting, builds the API, mobile, reviewer web, and shared workspaces, typechecks API scripts, and checks diff hygiene.
- **Windows lifecycle** runs the test-run and test-close ownership regression suites from a clean Windows checkout (`pnpm test:run:check` and `pnpm test:close:check`).

The workflow does not use the persistent development database, Apple signing, Android emulators, store credentials, or production secrets.

Other local checks:

- `pnpm lint`
- `pnpm format:check`
- `pnpm build`
- `pnpm test:prisma-config`
- `pnpm test:prisma` (guarded disposable database; do not point it at the persistent development database)

## Status

The checked-in foundation supports local API, reviewer, and mobile development, plus the guarded API smoke path and the two foundation CI jobs. Store submission, production PostgreSQL TLS and pooling, deployment secrets, and monitoring are not implemented here. A physical iPhone still needs Apple Developer Program membership before a signed development client can be installed. See `docs/NEXT_STEPS.md` for the current engineering boundary.
