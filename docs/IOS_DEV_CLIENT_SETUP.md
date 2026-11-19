# iOS Dev Client Setup (Production-like testing)

Use this instead of Expo Go when validating native splash/loading behavior.

This page is the quick-start companion to [`IOS_DEVELOPMENT_BUILD.md`](./IOS_DEVELOPMENT_BUILD.md). Complete that guide's Apple Developer Program, physical-iPhone registration, and private `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` steps before attempting an installable build.

## Why
Expo Go can show non-production startup transitions. A custom Dev Client gives near-production startup behavior.

## One-time setup
1. From the repository root, install the frozen workspace dependencies, including the repository-pinned EAS CLI:
   - `pnpm install --frozen-lockfile`
2. Login through the pinned CLI:
   - `pnpm --filter mobile exec eas login`
3. Build the iOS development client:
   - `pnpm --filter mobile build:ios:devclient`
   - This requires the EAS development environment and private `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` configured as described in `IOS_DEVELOPMENT_BUILD.md`.

## Install on iPhone
- Open the install link/QR from EAS build output on your iPhone.
- The physical iPhone must first be registered through the Apple Developer Program/EAS device workflow in `IOS_DEVELOPMENT_BUILD.md`.
- Trust the profile if prompted.
- Install the Dev Client app.

## Run app in Dev Client
1. Start API:
   - `pnpm --filter api dev`
2. Start mobile for dev client:
   - `pnpm --filter mobile dev:client`
3. Open yourHome Dev Client app on iPhone and connect.

## Expected result
- Startup/splash behavior should match native app behavior much more closely than Expo Go.
- This is the path to validate launch polish before real ship.
