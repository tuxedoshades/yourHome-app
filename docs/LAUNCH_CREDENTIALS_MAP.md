# LAUNCH_CREDENTIALS_MAP

Project: yourHome  
Policy: security-first, no secrets in chat, backups required.

## iOS (Apple)
- **Account:** Apple ID / Apple Developer Program (paid) required for reliable EAS iOS distribution
- **Status:** Apple login configured; enrollment gate identified
- **Primary pipeline:** EAS iOS build (`development`, `preview`, `production`)
- **Commands:**
  - `pnpm --filter mobile build:ios:devclient`
  - `pnpm --filter mobile build:ios:preview`
- **Account owner:** the Apple Developer Program account that owns this app
- **Secrets handling:** Apple creds/2FA never stored in repo/chat

## Android (Google + EAS)
- **Play Console:** one-time paid account required for store publishing
- **Signing strategy (MVP):** EAS managed keystore
- **Dry-run command:**
  - `pnpm --filter mobile build:android:preview`
- **Production command:**
  - `pnpm --filter mobile build:android:production`
- **Credential owner:** EAS managed credential infrastructure for this project

## Expo / EAS
- **Project:** Expo project slug `yourhome` on the account that owns this app
- **Project URL:** the Expo project page for that account
- **Build profiles file:** `apps/mobile/eas.json`
- **Version source:** remote (`cli.appVersionSource = remote`)

## Repository / backup ownership map
- **Product repo:** `yourhome`
- **Assistant notes:** kept in a private repository outside this product repo
- **Backup policy:** private backup automation, encrypted at rest, no key material in public channels

## Access control checklist
- [ ] Expo account recovery methods verified
- [ ] Apple account recovery methods verified
- [ ] Google account recovery methods verified
- [ ] Least-privilege collaborators only
- [ ] Credential rotation review cadence documented

## Do not put in chat
- Apple passwords / app-specific passwords
- 2FA one-time codes
- Keystore files or raw private keys
- Service account JSON private keys
