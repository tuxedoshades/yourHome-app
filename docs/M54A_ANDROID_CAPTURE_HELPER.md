# M54A Android Capture Helper

Added adb-assisted capture helper for Android parity evidence.

## Commands
- List devices:
  - `pnpm evidence:android:devices`
- Capture M53 Android shot set:
  - `pnpm evidence:android:capture:m53`

## How it works
- Prompts before each required screenshot.
- Uses `adb shell screencap` + `adb pull`.
- Saves files into:
  - `evidence/m53/mobile/android`

## Requirements
- Android platform-tools installed (`adb` available in PATH), or
- `ANDROID_HOME` / `ANDROID_SDK_ROOT` set with `platform-tools\adb.exe`.

## Notes
- This is a guided helper (not fully headless).
- iOS capture remains manual on-device.
