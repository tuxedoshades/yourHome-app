# Mapbox Spike Checklist

## Mobile (`@rnmapbox/maps`)
- [ ] Confirm Expo compatibility constraints and required setup
- [ ] Add package + native config notes
- [ ] Implement spike screen with `MapView` + `Camera`
- [ ] Render POIs via `ShapeSource` + `SymbolLayer`
- [ ] Add `CircleLayer` cluster rendering at low zoom
- [ ] Verify pan/zoom callback integration with existing bbox fetch

## Web (`mapbox-gl`)
- [ ] Add mapbox-gl package and CSS wiring
- [ ] Create persistent map instance shell
- [ ] Replace marker loop with source/layer rendering
- [ ] Wire `moveend` fetch and client-side filter path

## Cross-platform parity
- [ ] Same viewport terms parity (`highschools`, `parks`)
- [ ] Pin persistence and no stale response overwrite
- [ ] Verify out-of-viewport pin pruning behavior
- [ ] Capture before/after latency notes
