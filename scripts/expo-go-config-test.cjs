const assert = require("node:assert/strict");
const path = require("node:path");

const configPath = path.resolve(__dirname, "../apps/mobile/app.config.js");
const baseConfig = require("../apps/mobile/app.json").expo;
const easConfig = require("../apps/mobile/eas.json");
const mobilePackage = require("../apps/mobile/package.json");
const goAndroidSource = require("node:fs").readFileSync(path.resolve(__dirname, "go-android.ps1"), "utf8");
const androidSigningRunbookSource = require("node:fs").readFileSync(
  path.resolve(__dirname, "../docs/ANDROID_RELEASE_SIGNING_RUNBOOK.md"),
  "utf8",
);
const androidStringsSource = require("node:fs").readFileSync(
  path.resolve(__dirname, "../apps/mobile/android/app/src/main/res/values/strings.xml"),
  "utf8",
);
const androidManifestSource = require("node:fs").readFileSync(
  path.resolve(__dirname, "../apps/mobile/android/app/src/main/AndroidManifest.xml"),
  "utf8",
);
const mobileParityRunbookSource = require("node:fs").readFileSync(
  path.resolve(__dirname, "../docs/M50_MOBILE_PARITY_CAPTURE_RUNBOOK.md"),
  "utf8",
);
const oauthChecklistSource = require("node:fs").readFileSync(
  path.resolve(__dirname, "../docs/OAUTH_DEV_SETUP_CHECKLIST.md"),
  "utf8",
);
const oauthSpecSource = require("node:fs").readFileSync(
  path.resolve(__dirname, "../docs/AUTH_OAUTH_SPEC_V1.md"),
  "utf8",
);
const mobileEnvExampleSource = require("node:fs").readFileSync(
  path.resolve(__dirname, "../apps/mobile/.env.example"),
  "utf8",
);
const apiEnvExampleSource = require("node:fs").readFileSync(
  path.resolve(__dirname, "../apps/api/.env.example"),
  "utf8",
);
const originalExpoGo = process.env.YOURHOME_EXPO_GO;

function loadConfig(expoGo) {
  if (expoGo) process.env.YOURHOME_EXPO_GO = "1";
  else delete process.env.YOURHOME_EXPO_GO;

  delete require.cache[configPath];
  const factory = require(configPath);
  return factory({ config: baseConfig });
}

try {
  const production = loadConfig(false);
  assert.equal(production.name, "yourHome", "dynamic config must inherit the static app config supplied by Expo");
  assert.ok(
    production.plugins?.includes("expo-secure-store"),
    "SDK 55 native builds must include the expo-secure-store config plugin",
  );
  assert.ok(
    production.plugins?.includes("@rnmapbox/maps"),
    "SDK 55 native builds must include the Mapbox config plugin for generated iOS projects",
  );
  assert.equal(
    production.runtimeVersion,
    "0.1.0-sdk55",
    "SDK 55 native builds must use a runtime that cannot receive SDK 54 OTA updates",
  );
  assert.equal(production.scheme, "yourhome", "native builds must register the OAuth callback scheme");
  assert.match(
    androidManifestSource,
    /<data android:scheme="yourhome"\/>/,
    "the checked-in Android project must handle the configured OAuth callback scheme",
  );
  assert.match(
    androidManifestSource,
    /<data android:scheme="exp\+yourhome"\/>/,
    "the checked-in Android project must retain the Expo development-client callback scheme",
  );
  assert.match(
    androidStringsSource,
    /<string name="expo_runtime_version">0\.1\.0-sdk55<\/string>/,
    "the checked-in Android project must embed the same SDK 55 runtime version",
  );
  assert.equal(
    production.updates?.url,
    "https://u.expo.dev/019f9763-df54-47b5-acbb-dec95f0b3bec",
    "native builds must retain their EAS Update URL",
  );
  assert.equal(
    production.extra?.eas?.projectId,
    "019f9763-df54-47b5-acbb-dec95f0b3bec",
    "native builds must retain their EAS project ID",
  );
  assert.equal(
    easConfig.build.development.environment,
    "development",
    "development builds must read private build variables from the EAS development environment",
  );
  assert.equal(easConfig.cli.version, "21.0.2", "eas.json must enforce the locally pinned EAS CLI version");
  assert.match(
    androidSigningRunbookSource,
    /pnpm --filter mobile exec eas whoami/,
    "Android signing instructions must use the repository-pinned EAS CLI",
  );
  assert.doesNotMatch(
    androidSigningRunbookSource,
    /^\s*-\s*`eas whoami`/m,
    "Android signing instructions must not require an unrelated global EAS CLI",
  );

  const expoGo = loadConfig(true);
  assert.equal(
    expoGo.runtimeVersion,
    undefined,
    "Expo Go must use its SDK runtime instead of the custom native runtime",
  );
  assert.equal(expoGo.updates, undefined, "Expo Go must not advertise the native EAS Update channel");
  assert.equal(expoGo.extra?.eas, undefined, "Expo Go must not trigger online EAS development-certificate signing");
  assert.match(
    mobilePackage.scripts.android,
    /cross-env YOURHOME_EXPO_GO=1 .*--go/,
    "the package Android Expo Go command must activate Expo Go config",
  );
  assert.match(
    goAndroidSource,
    /set YOURHOME_EXPO_GO=1/,
    "the Windows Android Expo Go launcher must activate Expo Go config",
  );
  assert.match(mobileParityRunbookSource, /installed YourHome development client/);
  assert.doesNotMatch(mobileParityRunbookSource, /Open app in Expo Go|Expo Go installed/);
  assert.match(oauthChecklistSource, /SDK 55 Development Client/);
  assert.match(oauthChecklistSource, /EXPO_PUBLIC_OAUTH_NATIVE_REDIRECT_URI=yourhome:\/\/oauth\/callback/);
  assert.doesNotMatch(oauthChecklistSource, /Open Expo Go|pnpm --filter mobile dev/);
  assert.match(oauthSpecSource, /current frontend sends an explicit native redirect URI/);
  assert.doesNotMatch(oauthSpecSource, /AuthSession\.makeRedirectUri/);
  assert.match(mobileEnvExampleSource, /EXPO_PUBLIC_OAUTH_NATIVE_REDIRECT_URI=yourhome:\/\/oauth\/callback/);
  assert.match(mobileEnvExampleSource, /EXPO_PUBLIC_OAUTH_WEB_REDIRECT_URI=/);
  assert.doesNotMatch(
    mobileEnvExampleSource,
    /EXPO_PUBLIC_AUTH_DEV_PROXY_MODE|EXPO_PUBLIC_OAUTH_REDIRECT_URI|EXPO_PUBLIC_EXPO_OWNER|EXPO_PUBLIC_EXPO_SLUG/,
  );
  assert.match(apiEnvExampleSource, /^AUTH_OAUTH_DEV_MODE="false"$/m);
  assert.match(
    apiEnvExampleSource,
    /^OAUTH_ALLOWED_REDIRECT_URIS="yourhome:\/\/oauth\/callback,http:\/\/localhost:8082\/oauth\/callback"$/m,
  );
  assert.match(
    oauthChecklistSource,
    /OAUTH_ALLOWED_REDIRECT_URIS=yourhome:\/\/oauth\/callback,http:\/\/localhost:8082\/oauth\/callback/,
  );
  assert.doesNotMatch(apiEnvExampleSource, /auth\.expo\.io|OAUTH_ALLOWED_DEV_REDIRECT_URIS="https:/);

  console.log("[expo-go-config-test] PASS: Expo Go and native build runtimes remain isolated.");
} finally {
  if (originalExpoGo === undefined) delete process.env.YOURHOME_EXPO_GO;
  else process.env.YOURHOME_EXPO_GO = originalExpoGo;
}
