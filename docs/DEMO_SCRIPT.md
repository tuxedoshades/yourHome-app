# YourHome Demo Script

## Goal
Show the full trust-first flow: homeowner moderation loops + Property Manager premium lifecycle.

## Primary demo flow (recommended)
1. Homeowner registers and logs in.
2. Homeowner submits verification request.
3. Reviewer marks verification as `needs_more_info` with a clear note.
4. Homeowner opens resubmission center, uploads updated doc, resubmits.
5. Reviewer approves verification.
6. Homeowner creates listing.
7. Reviewer marks listing as `needs_more_info` with a note.
8. Homeowner updates listing and resubmits.
9. Reviewer approves listing.
10. Public user views approved listing feed.

## Property Manager premium flow (M31+)
1. Homeowner hits Property Manager lock state (`premium_required`).
2. Homeowner starts checkout stub and/or submits upgrade intent.
3. Reviewer opens **Upgrade Intents** panel.
4. Reviewer updates intent status (`new -> contacted -> converted`) with notes.
5. Reviewer grants premium entitlement.
6. Homeowner refreshes entitlement and accesses Property Manager plans.
7. Homeowner completes a maintenance task with required before/after evidence.
8. Reviewer listing view surfaces value-preservation signal + conversion summary metrics.

## Demo add-ons (optional)
### Auth security add-on
1. Login returns access token + refresh token.
2. Use `/auth/refresh` to rotate tokens.
3. Use `/auth/logout` with `allDevices=true` to revoke refresh sessions.

### Mobile polish callout
- Branded icon + splash are wired in Expo config.
- First-login onboarding clarifies Home Profile / Feed / Property Manager tabs.

## Demo talking points
- Security-first moderation with auditable decisions
- Resubmission loops reduce false rejects while preserving trust
- Reviewer lifecycle visibility for upgrades (status + notes + converted timestamp)
- Durable entitlement persistence (`UserEntitlement`) instead of audit-log-only overrides
- Value-preservation signal ties maintenance evidence to listing quality narrative
