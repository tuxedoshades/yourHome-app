# M50 Mobile Parity Capture Runbook (iOS + Android)

## Goal
Capture reproducible visual evidence for parity checklist rows on iOS and Android.

## Prerequisites
- Run the supported full stack from the repository root with `pnpm test:run`
- YourHome SDK 55 development client installed on each capture device; Expo Go is not valid parity evidence
- Android emulator or physical Android device connected to the development Metro server
- Physical iPhone registered for the development build and connected through the Test-run tunnel
- Devices on same network as dev machine

## Capture Naming Convention
Store files under:
- `evidence/m50/mobile/ios/`
- `evidence/m50/mobile/android/`

Filename format:
`<platform>-<flow>-<step>.png`

Examples:
- `ios-auth-login-01.png`
- `android-verification-submit-01.png`
- `ios-upgrade-intent-01.png`

## Required Shot List (Minimum)
1. Auth: login screen + logged-in state
2. Verification: submit form + post-submit confirmation
3. Verification resubmit: needs-more-info state + resubmit action
4. Listing: submit form + queued state
5. Property Manager lock state (premium required)
6. Upgrade intent submit confirmation
7. Reviewer lifecycle visibility touchpoint (where available on mobile)

## Capture Steps (Per Platform)
1. Open the installed YourHome development client.
2. Walk each required flow.
3. Capture screenshots at the exact step boundaries listed above.
4. Save with required naming convention.
5. Add links/paths into `docs/CROSS_PLATFORM_PARITY_CHECKLIST.md` Evidence column.

## Acceptance
- Every checklist row has at least one iOS and one Android evidence asset path.
- No missing required flow screenshots.
- Evidence captured in Expo Go is rejected because it lacks YourHome's native SDK 55 runtime and Mapbox module.
- Updated parity checklist is committed with links.
