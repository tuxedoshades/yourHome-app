# Directory Map - Production Gaps & Build Plan

Last updated: 2026-02-24

## Implemented now
- Native map rendering on Directory page:
  - iOS -> Apple Maps
  - Android -> Google Maps provider
- Web map adapter:
  - OpenStreetMap via Leaflet (`directory.web.tsx`)
- Viewport-driven result fetch (mobile):
  - map move/zoom triggers debounced `/directory/search` query
- Marker/list sync (v1):
  - marker tap highlights matching card
  - card tap highlights matching marker state
- Claimed-property UI indicator support (`claimed` flag)

## Remaining for Zillow-style parity
1. Real property data source + pagination
2. Marker clustering + density handling
3. List/marker virtualization for large datasets
4. Saved searches + persisted filters
5. Server-side ranking/sort pipeline
6. Ownership claim detail panel on marker/card open
7. Freshness jobs + infra updates + invalidation strategy
8. Security/abuse controls for query APIs

## Release notes
- Current `/directory/search` is stub-backed but viewport-capable.
- OTP/identity hardening still tracked separately for production readiness.
