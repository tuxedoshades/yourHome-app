# YourHome Next Steps

## Current Foundation

- Prisma 7 and Expo SDK 55 are the official baseline on `master`.
- GitHub Actions validates the cross-platform build and Windows launcher lifecycle on pull requests and pushes to `master`.
- The five Prisma migrations and `migration_lock.toml` have tracked integrity checks.
- Refresh-token rotation, session restoration, logout, and token revocation are implemented.
- The guarded demo seed and disposable API/Prisma smoke paths are implemented.
- M55 closed the mobile navigation and parity-evidence follow-up; the current evidence cycle is complete.

## Immediate Engineering Work

1. Replace placeholder lint and format scripts with real TypeScript, React, Expo, and Node checks.
2. Add a non-mutating format check to Foundation CI.
3. Expand automated behavior testing without allowing CI to write to the persistent `yourhome` database.
4. Keep all database-writing acceptance tests behind the guarded disposable-database supervisor.

## Next Product Decision

Select one bounded vertical slice before implementation:

1. Property discovery and property-detail experience.
2. Property Manager entitlement, upgrade, listing, and status lifecycle.
3. Reviewer moderation queues, detail views, and history.
4. Registration, verification, onboarding, and visible trust guidance.

For any selected slice:

- follow `docs/CROSS_PLATFORM_UX_CONTRACT.md` as the behavior source of truth;
- update `docs/CROSS_PLATFORM_PARITY_CHECKLIST.md` when acceptance behavior changes;
- use `docs/MILESTONE_ALIGNMENT_TEMPLATE.md` to document approved platform differences;
- require API, reviewer web, Android, web, and iOS development-client acceptance appropriate to the changed flow.

## Pending External Access

- Enforced GitHub protection for `master` is waiting for GitHub Education/Pro activation. Once available, require pull requests plus the `Cross-platform foundation` and `Windows lifecycle` checks.
- A newly signed iOS development-client installation requires Apple Developer access; earlier successful physical-iPhone checks remain valid evidence.
- Google Play development/release validation remains a later store-readiness milestone.

## Intentionally Deferred

- Production PostgreSQL TLS, pooling topology, and connection budgets.
- Production environment provisioning, deployment secrets, monitoring, backups, and incident operations.
- App Store and Google Play release signing and submission.
- Time-limited Student Developer Pack services until the matching product milestone is ready.
