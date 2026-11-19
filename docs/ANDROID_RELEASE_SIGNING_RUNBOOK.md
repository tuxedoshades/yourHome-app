# ANDROID_RELEASE_SIGNING_RUNBOOK

## Goal
Set up Android signing early so launch is repeatable and low-risk.

## Decision
Use **EAS managed Android credentials** for MVP speed, then review self-managed key migration only if needed later.

## One-time setup
1. Verify Expo/EAS login:
   - `pnpm --filter mobile exec eas whoami`
2. From the repository root, trigger the first Android preview build (will create credentials if missing):
   - `pnpm --filter mobile build:android:preview`
3. When prompted about Android Keystore, choose EAS managed defaults.

## Dry-run signed build (required)
- Command:
  - `pnpm --filter mobile build:android:preview`
- Expected output:
  - successful EAS build URL
  - downloadable signed APK artifact

## Production build command
- `pnpm --filter mobile build:android:production`

## Security checklist
- [ ] Confirm credential owner in Expo project settings
- [ ] Confirm who has Expo org/project admin access
- [ ] Record credential ownership and backup policy in `docs/LAUNCH_CREDENTIALS_MAP.md`
- [ ] Store recovery notes in private backups (do not paste secrets in chat)

## Blockers to watch
- Missing EAS login
- Keystore prompt declined/cancelled
- Play Console not set up yet (only needed for store release, not internal APK)
