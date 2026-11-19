# YourHome Build Worklog

## Build Execution Protocol (Permanent)

1. At task start, post: scope + ETA range.
2. If no deliverable within 10 minutes, post a progress ping with percent complete, blocker (if any), and updated ETA.
3. End every batch with proof: what changed, build/test result, and commit hash.
4. If asked `status?`, reply immediately with real current state.

---

## 2026-02-09

### Milestone 1 — Monorepo + API scaffold
- Initialized monorepo structure (`apps`, `packages`, `infra`, `docs`)
- Added Fastify API service with `/health`
- Added Prisma schema for core domain models:
  - `User`
  - `Property`
  - `VerificationSubmission`
  - `Listing`
  - `AuditLog`
- Added Docker Compose for local Postgres
- Added root workspace config (`pnpm-workspace.yaml`, shared TS config)
- Added `.gitignore` and fixed accidental node_modules staging

Commit: `3189ecb`

### Milestone 2 — Auth + verification intake (Path B foundation)
- Added JWT auth flow:
  - `POST /auth/register`
  - `POST /auth/login`
  - `GET /auth/me`
- Added password hashing with `scrypt` + timing-safe compare
- Added request validation with `zod`
- Added verification submission endpoint:
  - `POST /verification-submissions`
- Added audit logging for verification submission events
- Added `passwordHash` to `User` model
- Added `JWT_SECRET` to `.env.example`

Commit: `788b75d`

### Milestone 3 — Reviewer moderation flow
- Added reviewer/admin queue endpoint:
  - `GET /review/verification-submissions?status=pending`
- Added reviewer/admin decision endpoint:
  - `POST /review/verification-submissions/:id/decision`
- Implemented decision handling:
  - approve -> user becomes `homeowner` + `verified`, property owner linked
  - reject -> user status set to `rejected`
- Added audit logs for moderation actions
- Added role enforcement with DB role lookup (defense against stale JWT role claims)

Commit: `d83f11e`

### Milestone 4 — Admin bootstrap + homeowner listing gate + auth abuse controls
- Added first-admin bootstrap endpoint:
  - `POST /admin/bootstrap-first`
  - Requires `ADMIN_BOOTSTRAP_KEY` and rejects if an admin already exists
- Added homeowner-only listing creation endpoint:
  - `POST /listings`
  - Requires verified homeowner role and ownership of property
  - Creates listing in `pending_review` state
- Added public listing read endpoint:
  - `GET /listings` (approved listings only)
- Added basic auth abuse protections:
  - in-memory per-IP/per-account attempt tracking
  - lockouts and 429 responses on excessive attempts
  - applied to register/login paths

Commit: `d148ddd`

### Milestone 5 — Listing moderation queue + decision workflow
- Added reviewer/admin listing queue endpoint:
  - `GET /review/listings?status=pending_review`
- Added reviewer/admin listing decision endpoint:
  - `POST /review/listings/:id/decision`
- Implemented listing decision handling:
  - approve -> listing `approved` + trust badge `verified_by_yourhome`
  - reject -> listing `rejected`
- Added audit logs for listing moderation actions

Commit: `bdb8eca`

### Milestone 6 — End-to-end API smoke test harness
- Added API smoke test runner script:
  - `apps/api/scripts/smoke.ts`
  - Executes end-to-end flow for v1 pipeline:
    register -> verification submit -> review approve -> listing create -> listing approve -> browse verify
- Added package script:
  - `pnpm --filter api smoke`
- Updated README with smoke test instructions and env setup

Commit: `e3d795d`

### Milestone 7 — Reviewer Web scaffold (MVP)
- Replaced reviewer-web placeholder with Vite TypeScript app scaffold
- Added reviewer UI capabilities:
  - login with reviewer/admin account
  - load verification queue by status
  - approve/reject verification submissions with notes
  - load listing queue by status
  - approve/reject listings with notes
- Added scripts:
  - `pnpm --filter reviewer-web dev`
  - `pnpm --filter reviewer-web build`

Commit: `8982d33`

### Milestone 8 — Reviewer Web phase-1 polish
- Added tabbed moderation UX (Verification / Listings)
- Added success/error toast notifications
- Added auto-refresh after approve/reject actions
- Added verification review-note visibility in queue items
- Improved queue rendering and empty/error state handling

Commit: `50310b5`

### Milestone 9 — Phase 2 (needs_more_info flow)
- Added `needs_more_info` decision support for verification moderation endpoint
- Added `needs_more_info` decision support for listing moderation endpoint
- Added homeowner verification resubmission endpoint:
  - `POST /verification-submissions/:id/resubmit`
  - Allowed only for owner and only when status is `needs_more_info`
  - Resets submission to `pending` and logs audit event
- Updated reviewer-web to support `needs_more_info` status filtering and action buttons for both queues

Commit: `93c3c8f`

### Milestone 10 — Homeowner resubmission mini-UI
- Added homeowner submissions endpoint:
  - `GET /verification-submissions/me`
- Expanded web console with a third tab:
  - `Homeowner Resubmission`
- Homeowner tab now supports:
  - loading own verification submissions
  - viewing reviewer notes/status
  - editing docs JSON and resubmitting when `needs_more_info`

Commit: `6e9bd65`

### Milestone 11 — Homeowner resubmission UX upgrade (structured form)
- Replaced raw `docsJson` textarea with a user-friendly structured form in reviewer-web homeowner tab.
- Added fields for:
  - document type
  - name on document
  - issue date
  - document URL
  - short reviewer note
  - consent checkbox
- Added client-side validation and plain-language error messages before resubmission.
- Resubmission button now clearly enabled only for `needs_more_info` status.
- Form data is serialized into `docsJson` under the hood for backend compatibility.

Commit: `3b29abd`

### Milestone 12 — Quick UI polish pass (reviewer-web)
- Improved readability and mobile friendliness with larger input/button spacing.
- Added status pill styling by state (`pending`, `approved`, `rejected`, `needs_more_info`).
- Added responsive CSS behavior for small screens (stacked controls and full-width inputs/buttons).
- Improved wording for login/helper copy and homeowner action labels.
- Kept behavior unchanged while making UI cleaner for demo walkthroughs.

Commit: `d2cc6e1`

### Milestone 13 — Listing resubmission parity (homeowner flow)
- Added homeowner listing retrieval endpoint:
  - `GET /listings/me`
  - includes homeowner listings + most recent review note (when available from audit logs)
- Added homeowner listing resubmission endpoint:
  - `POST /listings/:id/resubmit`
  - owner-only; allowed only when listing status is `needs_more_info`
  - resets status to `pending_review` and clears trust badge to `none`
  - writes `listing_resubmitted` audit event
- Extended homeowner tab UI with listing resubmission section:
  - editable title/description/price/photo URL
  - plain-language validation
  - resubmit button enabled only for `needs_more_info`

Commit: `2c343d9`

### Milestone 14 — Auth hardening (DB-backed throttle)
- Replaced in-memory auth/register lockout tracking with database-backed throttle state.
- Added Prisma model:
  - `AuthThrottle` (`key`, `count`, `windowStart`, `lockUntil`, `updatedAt`)
- Updated API auth flow to use Prisma for lock/attempt tracking:
  - survives service restarts
  - keeps existing lockout behavior and response shape (`429`, `retryAfterSec`)

Commit: `aa14939`

### Milestone 15 — Ops/docs/demo execution updates
- Added root smoke alias:
  - `pnpm smoke:api`
- Added `docs/NEXT_STEPS.md` (active roadmap toward demo readiness)
- Added `docs/OPERATIONS.md` (build/smoke/release/security runbook)

Commit: `aa14939`

### Milestone 16 � Auth session continuation (refresh + logout/revoke)
- Added `RefreshToken` model in Prisma schema.
- Added refresh-token issuance on register/login responses.
- Added auth endpoints:
  - `POST /auth/refresh` (rotates refresh token and issues new access token)
  - `POST /auth/logout` (revoke current token or all devices)
- Added logout audit logging (`auth_logout`, `auth_logout_all`).
- Added env config:
  - `REFRESH_TOKEN_DAYS` in `apps/api/.env.example`

Commit: `60e9a1a`

### Milestone 17 � Demo packaging polish
- Added `docs/DEMO_SCRIPT.md` for a clear end-to-end walkthrough.
- Updated `README.md` with demo-ready local walkthrough section.
- Included root smoke alias in README command list for faster demo prep.

Commit: `60e9a1a`


### Milestone 20 � Auth UX polish (reviewer-web)
- Added visible session identity bar showing logged-in email, role, and verification status.
- Added explicit `Logout` button in UI.
- On login, UI now fetches `/auth/me` and displays current user context.
- On logout, token/session state and loaded queues are cleared to prevent admin/homeowner confusion.

Commit: `68cf826`


### Milestone 21 � File upload flow (P0 local mock)
- Added API upload endpoint:
  - `POST /uploads/documents` (auth required)
  - accepts base64 file payload, stores file in local `uploads/`, returns URL
- Added static file serving for uploaded files:
  - `GET /uploads/*`
- Added homeowner UI upload workflow:
  - file picker + "Upload document" button
  - uploaded URL auto-populates into verification form (read-only field)
- Kept backend compatibility by continuing to store resulting URL in `docsJson`.

Commit: `eae6847`


### Milestone 22 � Reviewer decision history panel (P1)
- Added authenticated timeline endpoint:
  - `GET /history/:entityType/:entityId`
  - Supports `listing` and `verification_submission`
  - Reviewer/admin can view any; homeowners can view only their own entities.
- Timeline now exposes ordered moderation history with actor, action/status, timestamp, and review notes when present.
- Reviewer-web updates:
  - Added �Load history� action on verification/listing queue cards and homeowner resubmission cards.
  - Added inline timeline rendering per item showing state progression (submitted / needs_more_info / resubmitted / approved/rejected).

Commit: `83db578`


### Milestone 23 � Demo seed/bootstrap command (P1)
- Added one-command demo bootstrap: `pnpm seed:demo`
- New script `apps/api/scripts/seed-demo.ts` provisions/ensures:
  - demo admin user credentials
  - demo homeowner user credentials
  - owned demo property
  - approved verification submission
  - listing pre-seeded in `needs_more_info` for fast walkthrough loops
- Added script wiring:
  - root `package.json` -> `seed:demo`
  - API `package.json` -> `seed:demo`
- Updated operations doc with seed command.
- Seed command validated locally.

Commit: `5a8aa5f`


### Milestone 24 � Security continuation (refresh-token cleanup + session metadata)
- Added refresh token cleanup strategy in API:
  - periodic-on-auth-path cleanup via `cleanupRefreshTokens()`.
  - removes expired tokens and old revoked tokens.
  - retention configurable via `REFRESH_TOKEN_CLEANUP_RETENTION_DAYS` (default 30).
- Added auth session metadata logging into `AuditLog` for key auth events:
  - `auth_register`, `auth_login`, `auth_refresh`, `auth_logout`, `auth_logout_all`
  - writes hashed `ipHash` and `deviceHash` per event for stronger audit correlation.
- Updated API env example with cleanup retention variable.

Commit: `eb6fd58`


### Milestone 25 � Caveat Address Pack (demo reliability + UX)
- Reviewer-web caveat reductions shipped:
  - Added clearer API/network error messaging via `prettyError` + network-safe request wrapper.
  - Added role-based mode hint text under session card (Reviewer/Admin vs Homeowner guidance).
  - Added timeline auto-refresh after moderation and resubmission actions.
  - Added upload guardrails before submit (type + max size checks) and clearer upload error toasts.
- Result: smoother walkthrough behavior with less confusion and better failure feedback.

Commit: `5d36976`


### Milestone 26 � Upload productionization (S3/R2-ready + presigned flow)
- Added storage provider config in API:
  - `STORAGE_PROVIDER=local|s3`
  - S3-compatible settings: `S3_BUCKET`, `S3_REGION`, optional `S3_ENDPOINT`, optional `S3_PUBLIC_BASE_URL`
- Added new endpoint: `POST /uploads/presign` (auth)
  - returns signed PUT URL + final file URL when provider is s3
  - returns local mode indicator when running local storage
- Updated upload handling:
  - `/uploads/documents` now supports both local and s3 provider storage backends
- Reviewer-web upload flow upgraded:
  - requests `/uploads/presign`
  - uploads directly to signed URL when in s3 mode
  - falls back to current base64 upload route in local mode
- Updated operations doc for storage modes and presigned flow.

Commit: `034dfb9`


### Milestone 27 � Storage setup runbook (deployment-ready)
- Added `docs/STORAGE_SETUP.md` with copy-paste config for:
  - local mode
  - AWS S3
  - Cloudflare R2 (S3-compatible)
- Included verification checklist and security recommendations.
- Linked storage setup doc from `docs/OPERATIONS.md`.

Commit: `dea5cd2`


### Milestone 28 � Property Manager foundation + merged mobile resubmission spec
- Added merged UX spec doc from Gemini redesign passes:
  - `docs/UX_RESUBMISSION_MOBILE.md`
- Started Property Manager backend foundation (premium-first) in API + Prisma:
  - Prisma models: `MaintenancePlan`, `MaintenanceTask`
  - Property relations updated for maintenance entities
  - New endpoints:
    - `GET /property-manager/suggestions`
    - `GET /property-manager/plans`
    - `POST /property-manager/plans`
    - `POST /property-manager/tasks/:id/complete`
  - Includes local-context suggestion scaffold (Miami-friendly hook), recurring cadence handling, completion logging, next-task auto-scheduling.

Commit: `d387b0e`


### Milestone 29 � Property Manager homeowner UI + required before/after evidence
- Enforced evidence requirement for value-preserving trust signal:
  - API completion schema now requires:
    - `beforeEvidenceUrl` (required)
    - `afterEvidenceUrl` (required)
- Updated Prisma maintenance task model to store:
  - `beforeEvidenceUrl`
  - `afterEvidenceUrl`
- Added homeowner Property Manager UI section in reviewer-web:
  - load maintenance plans
  - complete upcoming task
  - required before/after URL inputs + optional completion note
- Added plan/task API integration in reviewer-web with validation and toasts.

Commit: `251ea96`


### Milestone 30 � Value-preservation summary surfaced (account + reviewer visibility)
- Added value-preservation summary enrichment from maintenance evidence to listing surfaces.
- API updates:
  - `/listings/me` now includes `valuePreservation` per listing:
    - `maintenanceTracked`
    - `completedWithEvidence`
    - `lastCompletedAt`
  - `/review/listings` now includes same `valuePreservation` summary for reviewer decisions.
- Reviewer-web updates:
  - Listing queue cards now display value-preservation status + evidence completion count + last completed date.
  - Homeowner listing cards now display account-side value-preservation summary.

Commit: `efb72a9`


### Milestone 31 (detour) � Native mobile visual shell kickoff (iOS/Android)
- Replaced `apps/mobile` placeholder with working Expo React Native app scaffold.
- Added:
  - `App.tsx` (Zillow-like trust UI + social home profile shell)
  - login screen
  - inside-app tabs: Home Profile, Updates Feed, Property Manager
  - `app.json`, `index.js`, `babel.config.js`, `tsconfig.json`
  - updated `apps/mobile/package.json` scripts for `dev/ios/android/web/build`
- Build verified via Expo export:
  - iOS + Android bundles generated under `apps/mobile/dist`

Commit: `daf083b`


### Milestone 31A - Mobile auth wiring + brand normalization (`yourHome`)
- Includes prior Milestone 31 detour baseline:
  - Expo mobile shell scaffold with login + Home/Feed/Manager tabs.
- Upgraded mobile shell from visual-only login to real API auth flow.
- Added secure token persistence with `expo-secure-store`:
  - bootstrap session from stored token
  - validate via `GET /auth/me`
  - login via `POST /auth/login`
  - logout via `POST /auth/logout` + local token wipe
- Added dynamic API base URL resolution for device testing:
  - `EXPO_PUBLIC_API_URL` override supported
  - fallback derives host from Expo dev host (`http://<host>:3000`)
- Applied brand normalization in mobile UI copy:
  - `yourHome` (lowercase y) across login/header/product mentions.
- Kept Zillow-trust + social-home-profile visual direction in shell screens.

Build/verify:
- `pnpm --filter mobile build` (`expo export`) ?

Commits: `3e7d1d4`, `f95925d`


### Milestone 31B - Mobile live data wiring (owner auth session)
- Includes prior Milestone 31 + 31A foundation:
  - Expo shell + real auth + secure session persistence + `yourHome` brand normalization.
- Connected mobile shell to live API-backed owner data after login.
- Added mobile data loading flow:
  - `GET /listings/me` for owner listing/profile summary
  - `GET /property-manager/plans` for active maintenance plans
  - `GET /history/listing/:id` (top listings) for feed timeline events
- Home tab now reflects live listing/property + value-preservation summary and review note when present.
- Feed tab now shows real moderation/listing history events (timestamp/status/notes).
- Property Manager tab now shows live active plan snapshot (next due + cadence + task status).
- Added manual "Refresh live data" action in-app.

Build/verify:
- `pnpm --filter mobile build` (`expo export`) ?

Commits: `3baa2d2`, `d281349`



### Milestone 31C - Premium entitlement gating stub (backend-enforced + mobile lock state)
- Added backend entitlement stub for Property Manager:
  - New endpoint: `GET /property-manager/entitlement`
  - Entitlement logic:
    - enabled for `admin` / `reviewer`
    - enabled for emails in `PROPERTY_MANAGER_PREMIUM_EMAILS` allowlist
    - otherwise returns upgrade-required state
- Enforced premium checks on Property Manager protected operations:
  - `GET /property-manager/plans`
  - `POST /property-manager/plans`
  - `POST /property-manager/tasks/:id/complete`
  - non-entitled users now receive `402 { error: "premium_required", feature: "property_manager" }`
- Mobile app updated to consume entitlement and render gating UX:
  - calls `GET /property-manager/entitlement` during owner data load
  - shows locked manager state + upgrade CTA when not entitled
  - shows live plan data only when entitled
- Keeps `yourHome` naming convention and existing live Home/Feed wiring intact.

Build/verify:
- `pnpm --filter api build` ?
- `pnpm --filter mobile build` (`expo export`) ?

Commit: `ebc9152`


### Milestone 31E - Upgrade path wiring + entitlement source hardening
- Hardened entitlement source logic in API:
  - added optional user-id allowlist env: `PROPERTY_MANAGER_PREMIUM_USER_IDS`
  - entitlement now checks: role OR user-id allowlist OR email allowlist
- Added upgrade intent capture endpoint:
  - `POST /property-manager/upgrade-intent`
  - validates payload and writes audit event `property_manager_upgrade_intent`
- Mobile Manager locked state now has actionable CTA flow:
  - upgrade button calls `/property-manager/upgrade-intent`
  - shows request status message in-app
- Existing premium route enforcement from 31C remains active.

Build/verify:
- `pnpm --filter api build` ?
- `pnpm --filter mobile build` (`expo export`) ?

Commit: `3f2d64c`


### Milestone 31F - Reviewer upgrade-intent visibility endpoint
- Added reviewer/admin endpoint to inspect Property Manager upgrade interest:
  - `GET /review/property-manager/upgrade-intents`
- Endpoint returns recent captured intents from audit logs with:
  - timestamp
  - requesting user identity (id/email/role)
  - source + note payload (when present)
- Purpose: gives moderation/ops visibility into who is trying to upgrade before full billing integration is wired.

Build/verify:
- `pnpm --filter api build` ?

Commit: `0fde898`


### Milestone 31G - Reviewer-web upgrade intent panel
- Added reviewer-web UI panel for premium demand visibility.
- New Listing tab section: **Property Manager Upgrade Intents**
  - load button calls `GET /review/property-manager/upgrade-intents`
  - renders requester email/role, timestamp, source, and note
- Added local state + renderer for upgrade intents and clears state on logout.
- This surfaces Milestone 31F backend endpoint in actual moderator workflow UI.

Build/verify:
- `pnpm --filter reviewer-web build` ?
- `pnpm --filter api build` ?

Commit: `102da08`


### Milestone 31H - Upgrade intent lifecycle statuses (reviewer workflow)
- Added reviewer/admin status lifecycle support for upgrade intents:
  - statuses: `new`, `contacted`, `converted`
- API updates:
  - `POST /review/property-manager/upgrade-intents/:id/status`
    - validates status + optional note
    - stores status changes in audit log action `property_manager_upgrade_intent_status_set`
  - `GET /review/property-manager/upgrade-intents` now returns latest status metadata per intent.
- Reviewer-web updates:
  - Upgrade intent panel now shows current status + status update time + status note
  - Added per-intent controls to change status and save optional note.

Build/verify:
- `pnpm --filter api build` ?
- `pnpm --filter reviewer-web build` ?

Commit: `aeab184`


### Milestone 31I - Billing stub + entitlement sync hookup
- Added billing start stub endpoint:
  - `POST /billing/property-manager/checkout-stub`
  - logs checkout start (`property_manager_checkout_started`) and returns checkout URL stub
- Added reviewer entitlement sync endpoint:
  - `POST /review/property-manager/entitlements/:userId`
  - sets entitlement override via audit (`property_manager_entitlement_set`)
- Hardened entitlement resolution:
  - role OR premium user-id allowlist OR premium email allowlist OR latest entitlement override log
- Mobile upgrade CTA now triggers both:
  - upgrade-intent capture
  - checkout-stub start (returns URL message)
- Reviewer-web upgrade intent panel now supports one-click **Grant premium** action.

Build/verify:
- `pnpm --filter api build` ?
- `pnpm --filter reviewer-web build` ?
- `pnpm --filter mobile build` (`expo export`) ?

Commit: `ba7bd0e`


### Milestone 32 - Prisma migration cleanup + tracked baseline
- Resolved migration-state drift by generating and applying tracked Prisma migration for Property Manager schema:
  - `20260211014220_add_property_manager_models`
  - includes `MaintenancePlan` + `MaintenanceTask` tables and indexes/relations.
- Added migration baseline artifacts to repo:
  - `prisma/migrations/migration_lock.toml`
  - existing baseline migration folder now tracked
- Workspace hygiene updates:
  - ignored mobile Expo local cache (`apps/mobile/.expo/`)
  - ignored local helper script (`apps/api/scripts/who-admin.js`)

Build/verify:
- `pnpm --filter api build` ?

Commit: `ea2cad1`


### Milestone 33 - Mobile visual polish pass (brand + feed card refinement)
- Applied mobile UI polish pass for cleaner Zillow-like clarity and social-feed feel.
- Visual updates in `apps/mobile/App.tsx`:
  - improved login spacing/typography rhythm
  - softer input/card treatment + subtle card elevation
  - upgraded feed presentation to card-based timeline with avatar-ring accent style
  - improved feed header framing and readability
- Brand consistency update:
  - app display name in `apps/mobile/app.json` now `yourHome` (lowercase y)

Build/verify:
- `pnpm --filter mobile build` (`expo export`) ?

Commit: `9a4d7d3`


### Milestone 34 - Mobile onboarding polish flow
- Added first-login onboarding flow in mobile app to improve new-user orientation.
- After successful login (new session), app now shows a short onboarding walkthrough covering:
  - Home Profile purpose
  - Updates Feed behavior
  - Property Manager expectations
- Added explicit "Enter yourHome" transition into main tabs.
- Session restore path skips onboarding for returning users.

Build/verify:
- `pnpm --filter mobile build` (`expo export`) ?

Commit: `0b0439c`

