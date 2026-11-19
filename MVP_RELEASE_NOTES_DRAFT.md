# YourHome MVP Release Notes (Draft)

## Map Stability Improvements
- Added stale viewport request cancellation to prevent out-of-order overwrites.
- Added request sequencing guard to ignore stale map responses.
- Preserved last-good map pins during transient API failures (no hard empty reset).
- Tuned viewport debounce to 220ms for faster yet stable updates.
- Added low-zoom POI clustering behavior to reduce marker churn.
- Added map reliability instrumentation in debug footer:
  - timeout count
  - selection drop count
  - pin flicker count
  - latency + rolling p95
  - schema mismatch count
  - empty response count

## Web Parity
- Added viewport tracking and debounced updates for web map.
- Added in-viewport POI filtering and low-zoom clustering parity behavior.

## Known blockers before release
- API TypeScript strictness errors in `apps/api/src/index.ts`.
- Web export conflict: native `react-native-maps` import path still included by Expo web build.
- Platform gate script reports pass even on failure (false positive).
