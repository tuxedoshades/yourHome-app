# Mapbox Migration Track (Web + Mobile)

Status: kickoff
Owner: product owner
Branch: baseline/startup-auth-v1

## Goal
Move yourHome map rendering from mixed adapters to production-grade Mapbox stack aligned with product requirements:
- Web: `mapbox-gl` source/layer rendering
- Mobile: `@rnmapbox/maps` (`ShapeSource` + `SymbolLayer` + `CircleLayer`)

## Why
- Better parity for pin behavior across platforms
- Better performance/scalability for larger pin counts
- Better control over styling, clustering, and deterministic map behavior

## Phase Plan

### Phase 0 — Guardrails (in-progress)
- Keep current `directory` behavior stable during migration
- Preserve API contract (`/directory/poi-search/batch`)
- Maintain parity test checklist while swapping map engines

### Phase 1 — Mobile spike (`@rnmapbox/maps`)
- Add package + token config scaffolding
- Create mapbox-native screen spike behind feature flag
  - current scaffold flag: `EXPO_PUBLIC_MAP_ENGINE=mapbox` (dev placeholder only)
- Render current POI FeatureCollection via `ShapeSource`
- Add Symbol layer for property/poi labels and Circle layer for zoomed-out clusters

### Phase 2 — Web spike (`mapbox-gl`)
- Add mapbox-gl map shell with persistent map instance
- Migrate marker rendering to source/layer pipeline
- Wire `moveend` → bbox fetch integration

### Phase 3 — Shared map state
- Introduce shared map-state store (Zustand) for bbox, visible features, selection state
- Wire list↔map sync with deterministic selection semantics

### Phase 4 — Cutover
- Run parity/latency QA matrix (iOS/Android/Web)
- Remove old map adapters once parity and perf gates pass

## Acceptance gates
- Same viewport + terms yields near-parity counts iOS/Android/Web
- No random pin replacement when viewport/query unchanged
- Stable pan/zoom at target FPS envelopes
- No DOM/View marker path for large datasets
