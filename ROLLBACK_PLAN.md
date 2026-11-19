# Rollback Plan

## Last known map-stability chain
- `2e173ce` stale cancel + last-good pins + counters
- `de9d9db` per-base timeout handling
- `59dd73d` lower debounce + low-zoom POI clustering
- `985398a` web viewport debounce + clustering parity
- `3f67281` latency + p95 instrumentation
- `e5f2653` schema guards + mismatch metric
- `fe8a3de` selected-card durability + empty-response metric

## Rollback strategy
1. If severe regression appears, rollback to previous stable commit:
   - `git checkout <stable_sha>` for hotfix verification
   - or `git revert <bad_sha>` for selective rollback on branch
2. Re-run smoke and manual map checks.
3. Re-apply non-regressing commits one-by-one.

## Immediate safe anchor
Use `fe8a3de` as current stability anchor for mobile map behavior.
