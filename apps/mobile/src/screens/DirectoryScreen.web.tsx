import { useLocalSearchParams } from "expo-router";
import { FontAwesome5 } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const BUILD_ID = process.env.EXPO_PUBLIC_BUILD_ID ?? "dev-local";

type MapMode = "default" | "dark" | "satellite" | "3d";
const modeOrder: MapMode[] = ["default", "dark", "satellite", "3d"];
const MAP_MODE_PREF_KEY = "directory.mapMode.v1";
const FAVORITES_PREF_KEY = "directory.favorites.v1";
const POI_COLORS = ["#22D3EE", "#A78BFA", "#F97316", "#F43F5E", "#38BDF8", "#FACC15"];

const homes = [
  {
    id: "1",
    price: "$2,650,000",
    meta: "3 beds  •  3.5 baths  •  2,913 sqft",
    addr: "1648 Nocatee Dr, Miami, FL",
    latitude: 25.7869,
    longitude: -80.193,
    claimed: true,
  },
  {
    id: "2",
    price: "$1,249,000",
    meta: "5 beds  •  3.5 baths  •  3,123 sqft",
    addr: "813 NE 81st St, Miami, FL",
    latitude: 25.8485,
    longitude: -80.1762,
    claimed: false,
  },
  {
    id: "3",
    price: "$999,900",
    meta: "5 beds  •  4 baths  •  2,993 sqft",
    addr: "6512 NW 99th Ave, Parkland, FL",
    latitude: 26.3201,
    longitude: -80.258,
    claimed: false,
  },
];

const propertyIcon = (claimed?: boolean) =>
  L.divIcon({
    className: "yh-property-pin",
    html: `<svg width="24" height="24" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><path fill="${claimed ? "#22C55E" : "#05070C"}" d="M50 0a18.955 18.955 0 0 0-18.955 18.957A18.955 18.955 0 0 0 47.5 37.747V97.5A2.5 2.5 0 0 0 50 100a2.5 2.5 0 0 0 2.5-2.5V37.746a18.955 18.955 0 0 0 16.455-18.789A18.955 18.955 0 0 0 50 0zm-4.832 8.549a5.947 5.947 0 0 1 5.947 5.947a5.947 5.947 0 0 1-5.947 5.947a5.947 5.947 0 0 1-5.947-5.947a5.947 5.947 0 0 1 5.947-5.947z"/></svg>`,
    iconSize: [24, 24],
  });

const poiIcon = (color: string) =>
  L.divIcon({
    className: "yh-poi-pin",
    html: `<div style="width:14px;height:14px;border-radius:999px;background:${color};border:2px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.28);"></div>`,
    iconSize: [14, 14],
  });

type Viewport = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  zoom: number;
};

const VIEWPORT_FETCH_DEBOUNCE_MS = 220;

function ViewportTracker({ onViewportChange }: { onViewportChange: (vp: Viewport) => void }) {
  const map = useMapEvents({
    moveend() {
      const bounds = map.getBounds();
      onViewportChange({
        minLat: bounds.getSouth(),
        maxLat: bounds.getNorth(),
        minLng: bounds.getWest(),
        maxLng: bounds.getEast(),
        zoom: map.getZoom(),
      });
    },
    zoomend() {
      const bounds = map.getBounds();
      onViewportChange({
        minLat: bounds.getSouth(),
        maxLat: bounds.getNorth(),
        minLng: bounds.getWest(),
        maxLng: bounds.getEast(),
        zoom: map.getZoom(),
      });
    },
  });

  useEffect(() => {
    const bounds = map.getBounds();
    onViewportChange({
      minLat: bounds.getSouth(),
      maxLat: bounds.getNorth(),
      minLng: bounds.getWest(),
      maxLng: bounds.getEast(),
      zoom: map.getZoom(),
    });
  }, [map, onViewportChange]);

  return null;
}

function MapInteractionCloser({ onMapClick }: { onMapClick: () => void }) {
  useMapEvents({ click: onMapClick });
  return null;
}

const tileByMode: Record<MapMode, string> = {
  default: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  "3d": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
};

export default function DirectoryScreenWeb() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const [mapMode, setMapMode] = useState<MapMode>(() => {
    if (typeof window === "undefined") return "default";
    const saved = window.localStorage.getItem(MAP_MODE_PREF_KEY);
    return saved && modeOrder.includes(saved as MapMode) ? (saved as MapMode) : "default";
  });
  const [query, setQuery] = useState("");
  const [showMapModeMenu, setShowMapModeMenu] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [claimedOnly, setClaimedOnly] = useState(false);
  const [showSearchedItems, setShowSearchedItems] = useState(false);
  const [poiInput, setPoiInput] = useState("");
  const [poiTerms, setPoiTerms] = useState<string[]>([]);

  const viewportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(FAVORITES_PREF_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  });

  const filteredHomes = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = homes.filter((h) => {
      if (q && !`${h.addr} ${h.price} ${h.meta}`.toLowerCase().includes(q)) return false;
      if (claimedOnly && !h.claimed) return false;
      if (favoritesOnly && !favoriteIds.includes(h.id)) return false;
      return true;
    });

    return base.sort((a, b) => Number(Boolean(b.claimed)) - Number(Boolean(a.claimed)));
  }, [query, claimedOnly, favoritesOnly, favoriteIds]);

  const toggleFavorite = (homeId: string) => {
    setFavoriteIds((prev) => (prev.includes(homeId) ? prev.filter((id) => id !== homeId) : [...prev, homeId]));
  };

  const onViewportChange = (next: Viewport) => {
    if (viewportTimerRef.current) clearTimeout(viewportTimerRef.current);
    viewportTimerRef.current = setTimeout(() => {
      setViewport(next);
    }, VIEWPORT_FETCH_DEBOUNCE_MS);
  };

  const addPoiTerm = () => {
    const term = poiInput.trim().toLowerCase();
    if (!term) return;
    if (!poiTerms.includes(term)) setPoiTerms((prev) => [...prev, term]);
    setPoiInput("");
    setShowSearchedItems(true);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(MAP_MODE_PREF_KEY, mapMode);
  }, [mapMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(FAVORITES_PREF_KEY, JSON.stringify(favoriteIds));
  }, [favoriteIds]);

  useEffect(() => {
    return () => {
      if (viewportTimerRef.current) clearTimeout(viewportTimerRef.current);
    };
  }, []);

  const searchedPins = useMemo(() => {
    if (!showSearchedItems || !poiTerms.length)
      return [] as { id: string; latitude: number; longitude: number; term: string; color: string }[];
    return poiTerms.flatMap((term, termIndex) => {
      const seed = term.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
      const color = POI_COLORS[termIndex % POI_COLORS.length];
      return [0, 1, 2].map((i) => ({
        id: `${term}-${i}`,
        term,
        color,
        latitude: 25.87 + (((seed * (i + 5)) % 100) / 100 - 0.5) * 0.3,
        longitude: -80.2 + (((seed * (i + 3)) % 100) / 100 - 0.5) * 0.3,
      }));
    });
  }, [showSearchedItems, poiTerms]);

  const visibleSearchedPins = useMemo(() => {
    if (!viewport) return searchedPins;

    const inView = searchedPins.filter(
      (pin) =>
        pin.latitude >= viewport.minLat &&
        pin.latitude <= viewport.maxLat &&
        pin.longitude >= viewport.minLng &&
        pin.longitude <= viewport.maxLng,
    );

    // Low-zoom clustering behavior on web parity path.
    if (viewport.zoom >= 11) return inView;

    const latSpan = Math.max(0.01, viewport.maxLat - viewport.minLat);
    const lngSpan = Math.max(0.01, viewport.maxLng - viewport.minLng);
    const cellLat = latSpan / 10;
    const cellLng = lngSpan / 10;

    const byCell = new Map<string, (typeof inView)[number]>();
    for (const pin of inView) {
      const latKey = Math.floor(pin.latitude / cellLat);
      const lngKey = Math.floor(pin.longitude / cellLng);
      const key = `${pin.term}:${latKey}:${lngKey}`;
      if (!byCell.has(key)) byCell.set(key, pin);
    }

    return Array.from(byCell.values());
  }, [searchedPins, viewport]);

  return (
    <View style={styles.container}>
      <View style={[styles.mapBg, mapMode === "dark" ? styles.mapDarkFilter : null]}>
        <MapContainer center={[25.87, -80.2]} zoom={10} style={{ width: "100%", height: "100%" }} zoomControl={false}>
          <TileLayer attribution="&copy; OpenStreetMap contributors" url={tileByMode[mapMode]} />
          <MapInteractionCloser
            onMapClick={() => {
              setShowMapModeMenu(false);
              setShowFilters(false);
            }}
          />
          <ViewportTracker onViewportChange={onViewportChange} />
          {filteredHomes.map((home) => (
            <Marker key={home.id} position={[home.latitude, home.longitude]} icon={propertyIcon(home.claimed)} />
          ))}
          {visibleSearchedPins.map((pin) => (
            <Marker key={pin.id} position={[pin.latitude, pin.longitude]} icon={poiIcon(pin.color)} />
          ))}
        </MapContainer>
      </View>

      <View style={styles.topBar}>
        <View style={styles.glassSearch}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search addresses, property names, and communities..."
            placeholderTextColor="#cbd5e1"
            style={styles.searchInput}
          />
          <View style={styles.searchActionsInline}>
            <Pressable
              style={[styles.searchInlineBtn, favoritesOnly && styles.searchInlineBtnActive]}
              onPress={() => setFavoritesOnly((v) => !v)}
            >
              <FontAwesome5
                name="heart"
                size={14}
                color={favoritesOnly ? "#60A5FA" : "#E2E8F0"}
                solid={favoritesOnly}
              />
            </Pressable>
            <Pressable
              style={[styles.searchInlineBtn, showFilters && styles.searchInlineBtnActive]}
              onPress={() => setShowFilters((v) => !v)}
            >
              <FontAwesome5 name="sliders-h" size={15} color={showFilters ? "#60A5FA" : "#E2E8F0"} />
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.topActions}>
        <View style={styles.glassPill}>
          <Text style={styles.pillText}>Sort: Homes for You</Text>
        </View>
        <View style={styles.glassPill}>
          <Text style={styles.pillText}>Save Search</Text>
        </View>
      </View>

      <View style={styles.mapModeRow}>
        <Pressable style={styles.mapModeBtn} onPress={() => setShowMapModeMenu((v) => !v)}>
          <FontAwesome5 name="map-marked-alt" size={14} color="#E2E8F0" />
          <Text style={styles.mapModeText}>{mapMode.toUpperCase()}</Text>
          <FontAwesome5 name={showMapModeMenu ? "chevron-up" : "chevron-down"} size={11} color="#E2E8F0" />
        </Pressable>
        {showMapModeMenu ? (
          <View style={styles.mapModeMenu}>
            {modeOrder.map((modeOption) => (
              <Pressable
                key={modeOption}
                style={[styles.mapModeItem, modeOption === mapMode && styles.mapModeItemActive]}
                onPress={() => {
                  setMapMode(modeOption);
                  setShowMapModeMenu(false);
                }}
              >
                <Text style={[styles.mapModeItemText, modeOption === mapMode && styles.mapModeItemTextActive]}>
                  {modeOption.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {showFilters ? (
        <View style={styles.filtersPanel}>
          <Text style={styles.filtersTitle}>Filters</Text>
          <Pressable style={styles.filterRow} onPress={() => setClaimedOnly((v) => !v)}>
            <Text style={styles.filterRowText}>Claimed properties only</Text>
            <FontAwesome5
              name={claimedOnly ? "check-circle" : "circle"}
              size={16}
              color={claimedOnly ? "#60A5FA" : "#94A3B8"}
            />
          </Pressable>
          <Pressable style={styles.filterRow} onPress={() => setFavoritesOnly((v) => !v)}>
            <Text style={styles.filterRowText}>Favorites only</Text>
            <FontAwesome5
              name={favoritesOnly ? "check-circle" : "circle"}
              size={16}
              color={favoritesOnly ? "#60A5FA" : "#94A3B8"}
            />
          </Pressable>
          <Pressable style={styles.filterRow} onPress={() => setShowSearchedItems((v) => !v)}>
            <Text style={styles.filterRowText}>Show searched items</Text>
            <FontAwesome5
              name={showSearchedItems ? "check-circle" : "circle"}
              size={16}
              color={showSearchedItems ? "#60A5FA" : "#94A3B8"}
            />
          </Pressable>
          {showSearchedItems ? (
            <View style={styles.poiSection}>
              <View style={styles.poiInputRow}>
                <TextInput
                  value={poiInput}
                  onChangeText={setPoiInput}
                  placeholder="churches, schools, lakes..."
                  placeholderTextColor="#94A3B8"
                  style={styles.poiInput}
                  onSubmitEditing={() => {
                    addPoiTerm();
                  }}
                  onKeyPress={(e) => {
                    if ((e as any)?.nativeEvent?.key === "Enter") addPoiTerm();
                  }}
                  blurOnSubmit={false}
                  returnKeyType="done"
                />
                <Pressable style={styles.poiAddBtn} onPress={addPoiTerm}>
                  <Text style={styles.poiAddBtnText}>Add</Text>
                </Pressable>
              </View>
              <View style={styles.poiChipWrap}>
                {poiTerms.map((term, idx) => (
                  <Pressable
                    key={term}
                    style={styles.poiChip}
                    onPress={() => setPoiTerms((prev) => prev.filter((t) => t !== term))}
                  >
                    <View style={[styles.poiChipDot, { backgroundColor: POI_COLORS[idx % POI_COLORS.length] }]} />
                    <Text style={styles.poiChipText}>{term}</Text>
                    <Text style={styles.poiChipX}>×</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.sheet}>
        <Text style={styles.sheetTitle}>
          {filteredHomes.length.toLocaleString()} homes registered on yourHome in the area
        </Text>
        <ScrollView contentContainerStyle={styles.cardsWrap} showsVerticalScrollIndicator={false}>
          {filteredHomes.map((home) => (
            <View key={home.id} style={[styles.card, home.claimed && styles.cardClaimed]}>
              <View style={styles.fakePhoto} />
              <View style={styles.cardBody}>
                <View style={styles.priceRow}>
                  <Text style={styles.price}>{home.price}</Text>
                  <Pressable onPress={() => toggleFavorite(home.id)}>
                    <FontAwesome5
                      name="heart"
                      size={18}
                      color={favoriteIds.includes(home.id) ? "#60A5FA" : "#64748b"}
                      solid={favoriteIds.includes(home.id)}
                    />
                  </Pressable>
                </View>
                <Text style={styles.meta}>{home.meta}</Text>
                <Text style={styles.addr}>{home.addr}</Text>
                {home.claimed ? <Text style={styles.claimedBadge}>Claimed property</Text> : null}
              </View>
            </View>
          ))}
          <Text style={styles.build}>
            LIVE BUILD {BUILD_ID} • {mode ?? "default"} • web-map={mapMode} • vpz={viewport?.zoom ?? "-"} • poi=
            {visibleSearchedPins.length}/{searchedPins.length}
          </Text>
        </ScrollView>
      </View>

      <View style={styles.bottomNav}>
        <View style={styles.navItemWrap}>
          <FontAwesome5 name="search" size={13} color="#93C5FD" />
          <Text style={styles.navItemActive}>Search</Text>
        </View>
        <View style={styles.navItemWrap}>
          <FontAwesome5 name="newspaper" size={13} color="rgba(226,232,240,0.72)" />
          <Text style={styles.navItem}>Feed</Text>
        </View>
        <View style={styles.navItemWrap}>
          <View style={styles.navRoofMini}>
            <View style={styles.navRoofMiniLeft} />
            <View style={styles.navRoofMiniRight} />
          </View>
          <Text style={styles.navItem}>yourHome</Text>
        </View>
        <View style={styles.navItemWrap}>
          <FontAwesome5 name="compass" size={13} color="rgba(226,232,240,0.72)" />
          <Text style={styles.navItem}>Explore</Text>
        </View>
        <View style={styles.navItemWrap}>
          <FontAwesome5 name="inbox" size={13} color="rgba(226,232,240,0.72)" />
          <Text style={styles.navItem}>Inbox</Text>
        </View>
      </View>
    </View>
  );
}

const glass = {
  backgroundColor: "rgba(12, 18, 30, 0.55)",
  borderColor: "rgba(255,255,255,0.2)",
  borderWidth: 1,
} as const;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050d1a" },
  mapBg: { ...StyleSheet.absoluteFillObject },
  mapDarkFilter: {
    // Zillow-like dark tint refinement for web tiles
    filter: "saturate(1.08) contrast(1.02) brightness(0.92) hue-rotate(6deg)",
  } as any,
  topBar: { marginTop: 56, paddingHorizontal: 16, flexDirection: "row", alignItems: "center" },
  glassSearch: {
    ...glass,
    backgroundColor: "rgba(3, 6, 12, 0.82)",
    borderColor: "rgba(255,255,255,0.26)",
    flex: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  searchInput: { color: "#cbd5e1", fontSize: 15, flex: 1, paddingVertical: 4 },
  searchActionsInline: { flexDirection: "row", alignItems: "center", gap: 8 },
  searchInlineBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  searchInlineBtnActive: { backgroundColor: "rgba(96,165,250,0.18)" },
  topActions: { marginTop: 10, paddingHorizontal: 16, flexDirection: "row", gap: 8 },
  glassPill: { ...glass, flex: 1, borderRadius: 999, alignItems: "center", paddingVertical: 10 },
  pillText: { color: "#f8fafc", fontSize: 14, fontWeight: "600" },
  mapModeRow: { marginTop: 8, paddingHorizontal: 16, alignItems: "flex-end" },
  mapModeBtn: {
    ...glass,
    backgroundColor: "rgba(3, 6, 12, 0.82)",
    borderColor: "rgba(255,255,255,0.26)",
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  mapModeText: { color: "#E2E8F0", fontSize: 12, fontWeight: "700" },
  mapModeMenu: {
    marginTop: 6,
    width: 132,
    borderRadius: 12,
    padding: 6,
    backgroundColor: "rgba(3, 6, 12, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  mapModeItem: { paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8 },
  mapModeItemActive: { backgroundColor: "rgba(96,165,250,0.2)" },
  mapModeItemText: { color: "#cbd5e1", fontSize: 12, fontWeight: "600" },
  mapModeItemTextActive: { color: "#93C5FD" },
  filtersPanel: {
    marginTop: 8,
    marginHorizontal: 16,
    borderRadius: 16,
    padding: 12,
    backgroundColor: "rgba(5, 10, 20, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    gap: 10,
  },
  filtersTitle: { color: "#E2E8F0", fontWeight: "700", fontSize: 14 },
  filterRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  filterRowText: { color: "#cbd5e1", fontSize: 14 },
  poiSection: { gap: 8 },
  poiInputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  poiInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: "#E2E8F0",
    fontSize: 13,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  poiAddBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.55)",
    backgroundColor: "rgba(96,165,250,0.18)",
  },
  poiAddBtnText: { color: "#93C5FD", fontSize: 12, fontWeight: "700" },
  poiChipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  poiChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  poiChipDot: { width: 8, height: 8, borderRadius: 99 },
  poiChipText: { color: "#E2E8F0", fontSize: 12 },
  poiChipX: { color: "#94A3B8", fontSize: 12, fontWeight: "700" },
  sheet: {
    marginTop: 120,
    flex: 1,
    backgroundColor: "#070f1d",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    paddingTop: 12,
  },
  sheetTitle: {
    color: "#fff",
    textAlign: "center",
    fontSize: 23,
    fontWeight: "500",
    marginBottom: 10,
    paddingHorizontal: 10,
  },
  cardsWrap: { paddingHorizontal: 14, paddingBottom: 120, gap: 12 },
  card: {
    borderRadius: 18,
    overflow: "hidden",
    borderColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    backgroundColor: "#0b1527",
  },
  cardClaimed: { borderColor: "#22C55E" },
  fakePhoto: { height: 150, backgroundColor: "#1e293b" },
  cardBody: { padding: 12, gap: 6 },
  priceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  price: { color: "#fff", fontSize: 34, fontWeight: "900" },
  meta: { color: "#cbd5e1", fontSize: 15 },
  addr: { color: "#94a3b8", fontSize: 14 },
  claimedBadge: { color: "#22C55E", fontSize: 12, fontWeight: "700" },
  build: { color: "#64748b", fontSize: 12, textAlign: "center", marginTop: 4 },
  bottomNav: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 18,
    ...glass,
    backgroundColor: "rgba(3, 6, 12, 0.82)",
    borderColor: "rgba(255,255,255,0.26)",
    borderRadius: 26,
    paddingVertical: 12,
    paddingHorizontal: 10,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  navItemWrap: { alignItems: "center", justifyContent: "center", gap: 4, minWidth: 52 },
  navRoofMini: { width: 26, height: 14, position: "relative", alignItems: "center", justifyContent: "center" },
  navRoofMiniLeft: {
    width: 14,
    height: 2,
    backgroundColor: "rgba(226,232,240,0.72)",
    transform: [{ rotate: "-30deg" }],
    position: "absolute",
    left: 0.5,
    top: 7,
    borderRadius: 2,
  },
  navRoofMiniRight: {
    width: 14,
    height: 2,
    backgroundColor: "rgba(226,232,240,0.72)",
    transform: [{ rotate: "30deg" }],
    position: "absolute",
    right: 0.5,
    top: 7,
    borderRadius: 2,
  },
  navItem: { color: "rgba(226,232,240,0.72)", fontSize: 12 },
  navItemActive: { color: "#93C5FD", fontSize: 12, fontWeight: "700" },
});
