# YourHome MVP Release Checklist

## Current execution status (latest run)
- ❌ `pnpm smoke:api` failed: API unreachable at `http://localhost:3000` (server not running)
- ❌ `pnpm check:platform-gates` found real blockers:
  - API TypeScript compile errors in `apps/api/src/index.ts` (strict undefined checks)
  - Mobile web export fails due to native `react-native-maps` import path from `app/directory.tsx`
- ⚠️ Gate script currently prints `All requested platform gates passed.` even after failures (false positive bug in script)

## 1) Map reliability gates (must pass)
- [ ] Timeout rate acceptable in manual test pass
- [ ] Selection persists during pan/zoom + refresh
- [ ] No pin flicker/empty-reset during transient API failures
- [ ] Low-zoom POI behavior does not overload render
- [ ] Debug metrics visible in build footer (`to`, `selDrop`, `flicker`, `lat`, `p95`, `schema`, `empty`)

## 2) Functional smoke tests
- [ ] Search input filters homes correctly
- [ ] Favorites toggle + persistence works
- [ ] Claimed-only filter works
- [ ] Searched items chips add/remove correctly
- [ ] Map mode switching works (default/dark/satellite/3d)

## 3) API contract sanity
- [ ] `/directory/search` returns stable `id`, finite `latitude/longitude`
- [ ] Empty responses handled without clearing last-good UI state
- [ ] Pagination cursor path does not duplicate/lose homes across 3 pages

## 4) Cross-platform sanity
- [ ] Mobile map path validated (iOS/Android)
- [ ] Web map path validated (viewport debounce + low-zoom clustering)
- [ ] No critical console/runtime errors during 5-minute navigation session

## 5) Ship readiness
- [ ] Branch up to date
- [ ] Commits clean and scoped
- [ ] Release notes summary prepared
- [ ] Rollback note prepared (last known stable commit)

## 6) Post-ship watch (first 24h)
- [ ] Monitor timeout/flicker reports
- [ ] Collect top 3 user pain points
- [ ] Schedule patch batch if any P1 map issue appears
