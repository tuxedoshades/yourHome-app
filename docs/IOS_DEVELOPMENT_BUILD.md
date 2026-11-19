# iOS development build

YourHome uses an Expo development client for physical-iPhone testing. Expo Go is not a sufficient runtime because:

- App Store Expo Go availability can lag a new Expo SDK release.
- `@rnmapbox/maps` requires native code that Expo Go does not include.

## Repository configuration

The repository is configured with:

- Expo SDK 55 and `expo-dev-client`;
- iOS bundle identifier `com.yourhome.app`;
- EAS project ID `019f9763-df54-47b5-acbb-dec95f0b3bec`;
- EAS `development` profile using an internal development-client build;
- EAS `development` environment selection;
- `@rnmapbox/maps` config plugin for generated iOS CocoaPods hooks;
- native runtime `0.1.0-sdk55`, isolated from the former SDK-54 runtime `0.1.0`;
- standard Hermes (Hermes V1 is intentionally not enabled);
- pinned EAS CLI `21.0.2`.

The Windows Test-run launcher starts the iOS role with:

```text
expo start --dev-client --tunnel --port 8082
```

It explicitly clears `YOURHOME_EXPO_GO`, so an ambient Expo Go shell setting cannot remove the native runtime version, EAS project identity, or EAS Updates URL.

## Current completion boundary

Local configuration, generated iOS native files, the public development-client tunnel, and its SDK-55 bundle have been validated. The following remain unperformed because Apple Developer Program access is unavailable:

- Apple signing and credential creation;
- physical-iPhone device registration;
- the EAS iOS cloud build;
- development-client installation on the iPhone;
- visible physical-iPhone YourHome UI acceptance.

A tunnel, manifest, bundle, or generated Podfile does not satisfy those remaining acceptance steps.

## Prerequisites not stored in Git

Before the first installable iPhone build, obtain:

1. An active Apple Developer Program membership with access to the team that owns `com.yourhome.app`.
2. A physical iPhone available for device registration.
3. A private Mapbox token with `DOWNLOADS:READ` scope.
4. Access to the Expo account that owns this project.

Never commit Apple credentials, Expo tokens, Mapbox secret tokens, provisioning profiles, or downloaded signing material.

## One-time account and secret setup

Run commands from the repository root.

### 1. Log into EAS

```text
pnpm --filter mobile exec eas login --browser
pnpm --filter mobile exec eas whoami
```

Complete authentication in the browser. Do not paste passwords or 2FA codes into project files or chat.

### 2. Add the Mapbox download token to EAS

Create the token in Mapbox with `DOWNLOADS:READ` scope. Then run this command without a `--value` argument so EAS prompts for the value interactively and it does not enter shell history:

```text
pnpm --filter mobile exec eas env:create development --name RNMAPBOX_MAPS_DOWNLOAD_TOKEN --visibility secret --scope project
```

The public map-display token and `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` are different credentials. The download token must stay private.

### 3. Validate the resolved EAS profile

```text
pnpm --filter mobile exec eas config --platform ios --profile development --json
```

Confirm the command resolves the `development` profile and environment without exposing secret values.

## Register the physical iPhone

After Apple Developer Program access is active:

```text
pnpm --filter mobile exec eas device:create
```

Open the provided registration link on the iPhone and complete device registration. EAS must include the device UDID in the ad-hoc provisioning profile.

## Build and install

Start the cloud build:

```text
pnpm --filter mobile build:ios:devclient
```

For the first build, EAS-managed Apple credentials are the quickest default unless the project has an intentional manual-signing policy. Complete Apple authentication and 2FA interactively.

When the build finishes:

1. Open the EAS installation link on the registered iPhone.
2. Install the YourHome development build.
3. Run `pnpm test:run` on Windows.
4. Scan the QR in the `YourHome iOS QR + Web` terminal.
5. Open the link in the installed YourHome development client.
6. Confirm the normal YourHome UI is visibly open and can reach the LAN API.

A QR, manifest response, tunnel connection, or bundle download alone is not physical-iPhone acceptance.

## When another cloud rebuild is required

Reuse the installed development client for ordinary JavaScript, TypeScript, styling, and API changes. Build a new iOS client after changes to:

- Expo SDK or React Native;
- native dependencies such as `@rnmapbox/maps`;
- Expo config plugins;
- iOS entitlements, permissions, bundle identity, or native configuration;
- Hermes/native runtime settings.

After a native-runtime change, intentionally rebuild and reinstall once. Subsequent Test runs may reuse that verified client.

## Local verification available without Apple membership

The repository can validate most of the setup without signing:

```text
pnpm test:expo-go-config
pnpm test:run:check
pnpm --filter mobile exec eas --version
pnpm run build
```

Expo refuses to generate iOS projects directly on Windows. A scratch iOS prebuild can be generated under WSL for config-plugin inspection; do not generate or commit an `ios/` directory at the repository root unless the project intentionally changes its native-project policy.
