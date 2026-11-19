# Mobile development-client runbook (SDK 55)

YourHome uses an Expo development client, not Expo Go. `@rnmapbox/maps` requires native code that Expo Go does not include.

## Full-stack development run

From the repository root on Windows:

```powershell
pnpm test:run
```

The launcher validates dependencies, starts PostgreSQL and the API, reuses or rebuilds the Android development client from native-input/APK/device fingerprints, starts Android Metro on port `8081`, and starts the iOS development-client tunnel plus web on port `8082`.

Use `pnpm test:close` to stop launcher-owned services. A reused Android emulator is intentionally preserved; an emulator launched by the current invocation is owned and rolled back on startup failure.

## Acceptance checklist

1. API health is visible at `http://localhost:3000/health`.
2. Android shows the normal YourHome UI in the installed SDK 55 development client.
3. Web shows the normal YourHome UI at `http://localhost:8082`.
4. The iOS tunnel manifest and launch asset report runtime `0.1.0-sdk55`.
5. Completion on a physical iPhone additionally requires the installed YourHome development client and visible normal UI; a tunnel or bundle check alone is insufficient.

## iPhone prerequisite boundary

Physical-iPhone acceptance remains blocked until Apple Developer Program membership permits device registration, signing, cloud build, and installation. Follow `IOS_DEVELOPMENT_BUILD.md` for the Mapbox secret, EAS, Apple, device-registration, build, and installation workflow.

## Things not to do

- Do not use Expo Go as YourHome acceptance evidence.
- Do not run multiple Expo/Metro servers for the same ports.
- Do not open the raw LAN HTTP API in iOS Safari; HTTPS-Only mode blocks that workflow.
- Do not report completion without visible Android/web UI and, once signing is available, visible physical-iPhone UI.
