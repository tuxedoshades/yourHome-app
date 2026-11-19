import { router, useLocalSearchParams } from "expo-router";
import { FontAwesome5 } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import {
  Animated,
  Keyboard,
  NativeModules,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView, { MapStyleElement, Marker, PROVIDER_GOOGLE, Region } from "react-native-maps";
import Svg, { Path } from "react-native-svg";
import { poiPalette } from "../theme/tokens";
import { isMapboxEngineEnabled } from "../map/engine";
import { MapboxNativeSpike } from "../map/MapboxNativeSpike";
import { useAuth } from "../auth/session";
import { useI18n } from "../i18n/context";

const BUILD_ID = process.env.EXPO_PUBLIC_BUILD_ID ?? "dev-local";
const MAPBOX_PUBLIC_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN;
const sourceScriptUrl = (NativeModules as any)?.SourceCode?.scriptURL ?? "";
const hostUri =
  Constants.expoConfig?.hostUri ??
  (Constants as any)?.manifest?.debuggerHost ??
  (Constants as any)?.manifest2?.extra?.expoGo?.developer?.tool ??
  sourceScriptUrl ??
  "";
const host = String(hostUri)
  .replace(/^[a-zA-Z]+:\/\//, "")
  .split("/")[0]
  .split(":")[0]
  .trim();
const HOST_API_BASE = host ? `http://${host}:3000` : undefined;

const PRIMARY_API_BASE =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  (Platform.OS === "android"
    ? (process.env.EXPO_PUBLIC_API_BASE_URL_ANDROID ?? "http://10.0.2.2:3000")
    : Platform.OS === "ios"
      ? (process.env.EXPO_PUBLIC_API_BASE_URL_IOS ?? HOST_API_BASE ?? "http://127.0.0.1:3000")
      : "http://localhost:3000");

const API_BASE_CANDIDATES = Array.from(
  new Set(
    (Platform.OS === "android"
      ? [process.env.EXPO_PUBLIC_API_BASE_URL_ANDROID, "http://10.0.2.2:3000", HOST_API_BASE, PRIMARY_API_BASE]
      : Platform.OS === "ios"
        ? [
            process.env.EXPO_PUBLIC_API_BASE_URL_IOS,
            HOST_API_BASE,
            PRIMARY_API_BASE,
            "http://127.0.0.1:3000",
            "http://localhost:3000",
          ]
        : [PRIMARY_API_BASE, HOST_API_BASE, "http://localhost:3000"]
    ).filter(Boolean) as string[],
  ),
);

type Home = {
  id: string;
  price: string;
  meta: string;
  addr: string;
  latitude: number;
  longitude: number;
  claimed?: boolean;
};

type MapMode = "default" | "dark" | "satellite" | "3d";

type SearchPin = {
  id: string;
  term: string;
  color: string;
  latitude: number;
  longitude: number;
  name: string;
  displayName?: string | null;
  category?: string | null;
  type?: string | null;
};

type SearchedRenderItem =
  | { kind: "pin"; pin: SearchPin }
  | {
      kind: "cluster";
      id: string;
      latitude: number;
      longitude: number;
      count: number;
      dominantTerm: string;
      dominantColor: string;
    };

const initialRegion: Region = {
  latitude: 25.87,
  longitude: -80.2,
  latitudeDelta: 0.28,
  longitudeDelta: 0.22,
};

const modeOrder: MapMode[] = ["default", "dark", "satellite", "3d"];
const MAP_MODE_PREF_KEY = "directory.mapMode.v1";
const LAST_SCREEN_KEY = "yh.lastScreen.v1";
const FAVORITES_PREF_KEY = "directory.favorites.v1";
// Keep searched-item colors distinct from property pin colors (green/black).
const POI_COLORS = [...poiPalette];

const toRad = (n: number) => (n * Math.PI) / 180;
const distanceMiles = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const R = 3958.8;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 = Math.sin(dLng / 2) ** 2;
  const aa = s1 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * s2;
  return 2 * R * Math.asin(Math.sqrt(aa));
};

const FALLBACK_HOMES: Home[] = [
  {
    id: "1",
    price: "$2,650,000",
    meta: "3 beds • 3.5 baths • 2,913 sqft",
    addr: "1648 Nocatee Dr, Miami, FL",
    latitude: 25.7869,
    longitude: -80.193,
    claimed: true,
  },
  {
    id: "2",
    price: "$1,249,000",
    meta: "5 beds • 3.5 baths • 3,123 sqft",
    addr: "813 NE 81st St, Miami, FL",
    latitude: 25.8485,
    longitude: -80.1762,
    claimed: false,
  },
  {
    id: "3",
    price: "$999,900",
    meta: "5 beds • 4 baths • 2,993 sqft",
    addr: "6512 NW 99th Ave, Parkland, FL",
    latitude: 26.3201,
    longitude: -80.258,
    claimed: false,
  },
  {
    id: "4",
    price: "$1,875,000",
    meta: "4 beds • 3 baths • 2,401 sqft",
    addr: "451 Brickell Ave, Miami, FL",
    latitude: 25.7684,
    longitude: -80.1907,
    claimed: true,
  },
];

const DARK_MAP_STYLE: MapStyleElement[] = [
  // Zillow-like night palette: deep blue water + teal land + light arterial roads
  { elementType: "geometry", stylers: [{ color: "#23384d" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#eef4ff" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1f3142" }] },

  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#5a7892" }] },
  { featureType: "landscape", elementType: "geometry", stylers: [{ color: "#2f6a5f" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#2d6458" }] },
  { featureType: "landscape.man_made", elementType: "geometry", stylers: [{ color: "#324d64" }] },

  { featureType: "water", elementType: "geometry", stylers: [{ color: "#1c4386" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#dce7fa" }] },

  { featureType: "road", elementType: "geometry", stylers: [{ color: "#b8c6d8" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#4a6076" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#d4dfea" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#5b7288" }] },

  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#2e6a5c" }] },
];

function PropertyPin({ claimed, selected }: { claimed?: boolean; selected?: boolean }) {
  const fill = claimed ? "#22C55E" : "#05070C";
  return (
    <View style={[styles.propertyPinWrap, selected && styles.propertyPinWrapSelected]}>
      <Svg width={30} height={30} viewBox="0 0 100 100">
        <Path
          fill={fill}
          d="M50 0a18.955 18.955 0 0 0-18.955 18.957A18.955 18.955 0 0 0 47.5 37.747V97.5A2.5 2.5 0 0 0 50 100a2.5 2.5 0 0 0 2.5-2.5V37.746a18.955 18.955 0 0 0 16.455-18.789A18.955 18.955 0 0 0 50 0zm-4.832 8.549a5.947 5.947 0 0 1 5.947 5.947a5.947 5.947 0 0 1-5.947 5.947a5.947 5.947 0 0 1-5.947-5.947a5.947 5.947 0 0 1 5.947-5.947z"
        />
      </Svg>
      {!claimed ? <View style={styles.propertyPinGloss} /> : null}
    </View>
  );
}

export default function DirectoryScreen() {
  const { mode, demo } = useLocalSearchParams<{ mode?: string; demo?: string }>();
  const { booting, isAuthenticated, isPublicDemo, setPublicDemo, logout, user } = useAuth();
  const { t } = useI18n();
  const [homes, setHomes] = useState<Home[]>(FALLBACK_HOMES);
  const [region, setRegion] = useState<Region>(initialRegion);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [homeCache, setHomeCache] = useState<Record<string, Home>>({});
  const [mapMode, setMapMode] = useState<MapMode>("default");
  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [mapModeHydrated, setMapModeHydrated] = useState(false);
  const [showMapModeMenu, setShowMapModeMenu] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showFavoritesPanel, setShowFavoritesPanel] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [claimedOnly, setClaimedOnly] = useState(false);
  const [showSearchedItems, setShowSearchedItems] = useState(false);
  const [showSearchedItemsPanelOpen, setShowSearchedItemsPanelOpen] = useState(true);
  const [isPoiInputFocused, setIsPoiInputFocused] = useState(false);
  const [poiInput, setPoiInput] = useState("");
  const [poiTerms, setPoiTerms] = useState<string[]>([]);
  const [searchedPins, setSearchedPins] = useState<SearchPin[]>([]);
  const searchedPinsRef = useRef<SearchPin[]>([]);
  const [poiSuggestions, setPoiSuggestions] = useState<string[]>([]);
  const [poiFetchNonce, setPoiFetchNonce] = useState(0);
  const [poiDebug, setPoiDebug] = useState<{
    count: number;
    base?: string;
    mode?: string;
    error?: string;
    terms?: string;
  }>({ count: 0 });
  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);
  const [addAck, setAddAck] = useState(false);
  const [doneAck, setDoneAck] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);

  const mapRef = useRef<MapView>(null);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const homeRequestSeqRef = useRef(0);
  const homeAbortRef = useRef<AbortController | null>(null);
  const homeMetricsRef = useRef({
    timeout: 0,
    selectionDrop: 0,
    pinFlicker: 0,
    latencyMs: 0,
    latencyP95Ms: 0,
    schemaMismatch: 0,
    emptyResponse: 0,
  });
  const homeLatencySamplesRef = useRef<number[]>([]);
  const poiFetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poiRequestSeqRef = useRef(0);
  const lastPoiRegionRef = useRef<Region | null>(null);
  const lastPoiFetchKeyRef = useRef<string>("");
  const searchRef = useRef<TextInput>(null);
  const poiInputRef = useRef<TextInput>(null);
  const suppressNextFocus = useRef(false);
  const selectedIdRef = useRef<string | null>(null);
  const homesRef = useRef<Home[]>(FALLBACK_HOMES);
  const homeCacheRef = useRef<Record<string, Home>>({});
  const demoMode = demo === "1" || isPublicDemo;

  useEffect(() => {
    if (booting) return;
    if (!isAuthenticated && !demoMode) {
      router.replace("/auth");
      return;
    }
    if (demo === "1" && !isPublicDemo) {
      setPublicDemo(true);
    }
  }, [booting, demo, demoMode, isAuthenticated, isPublicDemo, setPublicDemo]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    homesRef.current = homes;
  }, [homes]);

  useEffect(() => {
    homeCacheRef.current = homeCache;
  }, [homeCache]);

  const SHEET_COLLAPSED_OFFSET = Platform.OS === "android" ? 433 : 400;
  const sheetTranslateY = useRef(new Animated.Value(0)).current;
  const dragStartY = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 3,
      onPanResponderGrant: () => {
        dragStartY.current = (sheetTranslateY as any).__getValue?.() ?? 0;
      },
      onPanResponderMove: (_, gesture) => {
        const next = Math.max(0, Math.min(SHEET_COLLAPSED_OFFSET, dragStartY.current + gesture.dy));
        sheetTranslateY.setValue(next);
      },
      onPanResponderRelease: (_, gesture) => {
        const current = (sheetTranslateY as any).__getValue?.() ?? 0;
        const shouldCollapse = current > SHEET_COLLAPSED_OFFSET / 2 || gesture.vy > 0.55;
        Animated.spring(sheetTranslateY, {
          toValue: shouldCollapse ? SHEET_COLLAPSED_OFFSET : 0,
          useNativeDriver: true,
          bounciness: 4,
          speed: 16,
        }).start();
      },
    }),
  ).current;

  const fetchHomes = async (r: Region) => {
    const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

    const safeLatDelta = clamp(r.latitudeDelta, 0.004, 30);
    const safeLngDelta = clamp(r.longitudeDelta, 0.004, 60);

    const minLat = clamp(r.latitude - safeLatDelta / 2, -90, 90);
    const maxLat = clamp(r.latitude + safeLatDelta / 2, -90, 90);
    const minLng = clamp(r.longitude - safeLngDelta / 2, -180, 180);
    const maxLng = clamp(r.longitude + safeLngDelta / 2, -180, 180);
    const zoomApprox = Math.max(1, Math.round(11 - Math.log2(safeLngDelta)));

    const requestId = ++homeRequestSeqRef.current;
    const startedAt = Date.now();
    homeAbortRef.current?.abort();
    const controller = new AbortController();
    homeAbortRef.current = controller;

    try {
      let cursor: number | null = 0;
      const batch: Home[] = [];
      let pages = 0;

      while (cursor !== null && pages < 3) {
        let data: any = null;
        let ok = false;

        for (const base of API_BASE_CANDIDATES) {
          const perBaseController = new AbortController();
          const relayAbort = () => perBaseController.abort();
          controller.signal.addEventListener("abort", relayAbort, { once: true });
          const timeoutMs = Platform.OS === "ios" ? 2600 : 2200;
          const timeoutHandle = setTimeout(() => perBaseController.abort(), timeoutMs);

          try {
            const url: string = `${base}/directory/search?minLat=${minLat}&maxLat=${maxLat}&minLng=${minLng}&maxLng=${maxLng}&zoom=${zoomApprox}&limit=50&cursor=${cursor}`;
            const res: Response = await fetch(url, { signal: perBaseController.signal });
            const parsed: any = await res.json();
            if (res.ok && Array.isArray(parsed?.homes)) {
              const invalidHome = parsed.homes.find(
                (h: any) =>
                  !h ||
                  typeof h.id !== "string" ||
                  !Number.isFinite(Number(h.latitude)) ||
                  !Number.isFinite(Number(h.longitude)),
              );

              if (invalidHome) {
                homeMetricsRef.current.schemaMismatch += 1;
                continue;
              }

              data = parsed;
              ok = true;
              break;
            }
          } catch (err: any) {
            if (controller.signal.aborted) return;
            if (err?.name === "AbortError") {
              homeMetricsRef.current.timeout += 1;
            } else if (
              String(err?.message ?? "")
                .toLowerCase()
                .includes("timeout")
            ) {
              homeMetricsRef.current.timeout += 1;
            }
            // try next base candidate
          } finally {
            clearTimeout(timeoutHandle);
            controller.signal.removeEventListener("abort", relayAbort);
          }
        }

        if (!ok || !data) break;

        batch.push(...(data.homes as Home[]));
        cursor = typeof data?.page?.nextCursor === "number" ? data.page.nextCursor : null;
        pages += 1;
      }

      if (requestId !== homeRequestSeqRef.current) return;

      if (batch.length) {
        const selectedId = selectedIdRef.current;
        const hadSelectedInPrev = selectedId ? homesRef.current.some((h) => h.id === selectedId) : false;
        const hasSelectedNow = selectedId ? batch.some((h) => h.id === selectedId) : false;
        const hasSelectedInCache = selectedId ? Boolean(homeCacheRef.current[selectedId]) : false;
        if (selectedId && hadSelectedInPrev && !hasSelectedNow && !hasSelectedInCache) {
          homeMetricsRef.current.selectionDrop += 1;
        }

        setHomes(batch);
        setHomeCache((prev) => {
          const next = { ...prev };
          for (const h of batch) next[h.id] = h;
          return next;
        });
      } else {
        homeMetricsRef.current.emptyResponse += 1;
        if (homesRef.current.length > 0) {
          homeMetricsRef.current.pinFlicker += 1;
        }
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      if (
        String(err?.message ?? "")
          .toLowerCase()
          .includes("timeout")
      ) {
        homeMetricsRef.current.timeout += 1;
      }
      // Keep last-good map pins during transient failures; avoid empty/flicker resets.
    } finally {
      if (!controller.signal.aborted) {
        const elapsed = Date.now() - startedAt;
        homeMetricsRef.current.latencyMs = elapsed;
        const samples = homeLatencySamplesRef.current;
        samples.push(elapsed);
        if (samples.length > 30) samples.shift();
        const sorted = [...samples].sort((a, b) => a - b);
        const idx = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
        homeMetricsRef.current.latencyP95Ms = sorted[idx] ?? elapsed;
      }
    }
  };

  useEffect(() => {
    void fetchHomes(initialRegion);
    return () => {
      homeAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    void SecureStore.setItemAsync(LAST_SCREEN_KEY, "directory").catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync(MAP_MODE_PREF_KEY);
        if (!active) return;
        if (saved && modeOrder.includes(saved as MapMode)) {
          setMapMode(saved as MapMode);
        }
      } catch {
        // best-effort preference load
      } finally {
        if (active) setMapModeHydrated(true);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!mapModeHydrated) return;
    void SecureStore.setItemAsync(MAP_MODE_PREF_KEY, mapMode).catch(() => {
      // best-effort preference save
    });
  }, [mapMode, mapModeHydrated]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync(FAVORITES_PREF_KEY);
        if (!active || !saved) return;
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setFavoriteIds(parsed.filter((x) => typeof x === "string"));
      } catch {
        // best-effort
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void SecureStore.setItemAsync(FAVORITES_PREF_KEY, JSON.stringify(favoriteIds)).catch(() => {
      // best-effort
    });
  }, [favoriteIds]);

  const pinLimitPerTerm = useMemo(() => {
    if (region.longitudeDelta > 0.9) return 30;
    if (region.longitudeDelta > 0.45) return 40;
    if (region.longitudeDelta > 0.2) return 50;
    return 70;
  }, [region.longitudeDelta]);

  useEffect(() => {
    searchedPinsRef.current = searchedPins;
  }, [searchedPins]);

  useEffect(() => {
    if (!poiTerms.length) {
      setSearchedPins([]);
      setPoiSuggestions([]);
      setSelectedPoiId(null);
      setPoiDebug({ count: 0, mode: "disabled", terms: undefined });
      lastPoiFetchKeyRef.current = "";
      return;
    }

    // As long as term chips exist, always execute fetch pipeline.
    // Toggle only affects UI intent, not data pipeline readiness.
    setPoiDebug((prev) => ({ ...prev, mode: "fetching", error: prev.error }));

    if (poiFetchTimer.current) clearTimeout(poiFetchTimer.current);

    poiFetchTimer.current = setTimeout(() => {
      void (async () => {
        const requestId = ++poiRequestSeqRef.current;
        const fetchJsonWithTimeout = async (url: string, timeoutMs = 1800) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const res = await fetch(url, { signal: controller.signal });
            const data = await res.json();
            return { res, data };
          } finally {
            clearTimeout(timer);
          }
        };

        const minLat = region.latitude - region.latitudeDelta / 2;
        const maxLat = region.latitude + region.latitudeDelta / 2;
        const minLng = region.longitude - region.longitudeDelta / 2;
        const maxLng = region.longitude + region.longitudeDelta / 2;
        const fetchKey = [
          poiTerms.join(","),
          minLat.toFixed(5),
          maxLat.toFixed(5),
          minLng.toFixed(5),
          maxLng.toFixed(5),
          String(pinLimitPerTerm),
          String(poiFetchNonce),
        ].join("|");
        if (fetchKey === lastPoiFetchKeyRef.current) return;
        lastPoiFetchKeyRef.current = fetchKey;

        const inViewport = (lat: number, lng: number) =>
          lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
        const dedupeThreshold = 0.00035;
        const centerLat = (minLat + maxLat) / 2;
        const centerLng = (minLng + maxLng) / 2;

        const normalizePinsByTerm = (pins: SearchPin[]) => {
          const out: SearchPin[] = [];
          for (const term of poiTerms) {
            const termPins = pins
              .filter(
                (p) =>
                  p.term === term &&
                  Number.isFinite(p.latitude) &&
                  Number.isFinite(p.longitude) &&
                  inViewport(p.latitude, p.longitude),
              )
              .sort((a, b) => {
                const aDist = Math.hypot(a.latitude - centerLat, a.longitude - centerLng);
                const bDist = Math.hypot(b.latitude - centerLat, b.longitude - centerLng);
                return aDist - bDist || String(a.id).localeCompare(String(b.id));
              });

            const dedupedTerm: SearchPin[] = [];
            for (const pin of termPins) {
              const near = dedupedTerm.some(
                (d) =>
                  Math.abs(d.latitude - pin.latitude) < dedupeThreshold &&
                  Math.abs(d.longitude - pin.longitude) < dedupeThreshold,
              );
              if (near) continue;
              dedupedTerm.push(pin);
              if (dedupedTerm.length >= pinLimitPerTerm) break;
            }
            out.push(...dedupedTerm);
          }
          return out;
        };

        const next: SearchPin[] = [];
        const suggestionBag = new Set<string>();
        const failedTerms = new Set<string>();
        let debugBase: string | undefined;
        let debugMode: string | undefined;
        let debugError: string | undefined;

        // Phase 1: prefer a single server-side batch aggregation path.
        for (const base of API_BASE_CANDIDATES) {
          try {
            const batchUrl = `${base}/directory/poi-search/batch?terms=${encodeURIComponent(poiTerms.join(","))}&minLat=${minLat}&maxLat=${maxLat}&minLng=${minLng}&maxLng=${maxLng}&limit=${Math.max(40, pinLimitPerTerm)}`;
            const batchTimeoutMs = Platform.OS === "ios" ? 3000 : 3000;
            const { res: batchRes, data: batchData }: any = await fetchJsonWithTimeout(batchUrl, batchTimeoutMs);
            if (!batchRes.ok || !Array.isArray(batchData?.items)) continue;

            debugBase = base;
            debugMode = "server-batch";

            const batchPins: SearchPin[] = batchData.items
              .map((item: any) => {
                const term = String(item?.term ?? "")
                  .toLowerCase()
                  .trim();
                if (!term) return null;
                const termIdx = poiTerms.indexOf(term);
                const color = POI_COLORS[(termIdx >= 0 ? termIdx : 0) % POI_COLORS.length];
                return {
                  id: `${term}-${String(item?.id ?? `${item?.latitude}-${item?.longitude}`)}`,
                  term,
                  color,
                  latitude: Number(item?.latitude),
                  longitude: Number(item?.longitude),
                  name: String(item?.name ?? term),
                  displayName: String(item?.displayName ?? item?.name ?? term),
                  category: item?.category ?? null,
                  type: item?.type ?? null,
                } as SearchPin;
              })
              .filter(
                (x: SearchPin | null): x is SearchPin =>
                  x !== null && Number.isFinite(x.latitude) && Number.isFinite(x.longitude),
              );

            // Server batch endpoint is authoritative for ranking/dedupe/capping.
            const cappedByTermBatch: SearchPin[] = normalizePinsByTerm(batchPins);

            const failedBatchTerms = new Set<string>();
            const recoveredBatchTerms = new Set<string>();
            const perTermStatus = new Map<string, { status: string; count: number }>();
            const statusParts: string[] = [];
            if (Array.isArray(batchData?.perTerm)) {
              for (const row of batchData.perTerm) {
                const rowTerm = String(row?.term ?? "")
                  .toLowerCase()
                  .trim();
                const rowStatus = String(row?.status ?? "").toLowerCase();
                if (rowStatus) statusParts.push(`${rowTerm}:${rowStatus}`);
                const rowCount = Number(row?.count ?? 0);
                if (rowTerm) perTermStatus.set(rowTerm, { status: rowStatus || "unknown", count: rowCount });
                const minPerTerm = 5;
                if (
                  rowTerm &&
                  (rowStatus === "timeout" ||
                    rowStatus === "error" ||
                    rowStatus === "sparse" ||
                    (rowStatus === "ok" && rowCount < minPerTerm))
                ) {
                  failedBatchTerms.add(rowTerm);
                }
                if (Array.isArray(row?.suggestions)) {
                  for (const s of row.suggestions) if (typeof s === "string") suggestionBag.add(s);
                }
              }
            }

            if (failedBatchTerms.size) {
              for (const term of failedBatchTerms) {
                let recovered = false;
                for (const fallbackBase of API_BASE_CANDIDATES) {
                  try {
                    const fallbackUrl = `${fallbackBase}/directory/poi-search?term=${encodeURIComponent(term)}&minLat=${minLat}&maxLat=${maxLat}&minLng=${minLng}&maxLng=${maxLng}&limit=${Math.max(80, pinLimitPerTerm)}`;
                    const fallbackTimeoutMs = Platform.OS === "ios" ? 3200 : 2400;
                    const { res: fallbackRes, data: fallbackData }: any = await fetchJsonWithTimeout(
                      fallbackUrl,
                      fallbackTimeoutMs,
                    );
                    if (!fallbackRes.ok || !Array.isArray(fallbackData?.items)) continue;

                    if (Array.isArray(fallbackData?.suggestions)) {
                      for (const s of fallbackData.suggestions) if (typeof s === "string") suggestionBag.add(s);
                    }

                    const existingCount = cappedByTermBatch.filter((p) => p.term === term).length;
                    const remaining = Math.max(0, pinLimitPerTerm - existingCount);
                    if (remaining > 0) {
                      const termIdx = poiTerms.indexOf(term);
                      const color = POI_COLORS[(termIdx >= 0 ? termIdx : 0) % POI_COLORS.length];
                      const additions: SearchPin[] = [];
                      for (const item of fallbackData.items) {
                        if (additions.length >= remaining) break;
                        const latitude = Number(item?.latitude);
                        const longitude = Number(item?.longitude);
                        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
                        const id = `${term}-${String(item?.id ?? `${latitude}-${longitude}`)}`;
                        const dup = cappedByTermBatch.some(
                          (p) =>
                            p.term === term &&
                            (p.id === id ||
                              (Math.abs(p.latitude - latitude) < 0.00035 &&
                                Math.abs(p.longitude - longitude) < 0.00035)),
                        );
                        if (dup) continue;
                        additions.push({
                          id,
                          term,
                          color,
                          latitude,
                          longitude,
                          name: String(item?.name ?? term),
                          displayName: String(item?.displayName ?? item?.name ?? term),
                          category: item?.category ?? null,
                          type: item?.type ?? null,
                        });
                      }
                      cappedByTermBatch.push(...additions);
                    }

                    recovered = true;
                    recoveredBatchTerms.add(term);
                    break;
                  } catch {
                    // try next base candidate
                  }
                }
                if (!recovered && MAPBOX_PUBLIC_TOKEN) {
                  try {
                    const termIdx = poiTerms.indexOf(term);
                    const color = POI_COLORS[(termIdx >= 0 ? termIdx : 0) % POI_COLORS.length];
                    const existingCount = cappedByTermBatch.filter((p) => p.term === term).length;
                    const remaining = Math.max(0, pinLimitPerTerm - existingCount);
                    if (remaining > 0) {
                      const canonical = /^high\s*schools?$|^highschools?$/.test(term)
                        ? "high school"
                        : /\bschools?\b|academy|university|college|campus|elementary|kindergarten|k-?12/.test(term)
                          ? "school"
                          : /park|playground|recreation|sports\s*field|green\s*space/.test(term)
                            ? "park"
                            : term;

                      const fetchMapbox = async (query: string, bounded: boolean) => {
                        const mb = new URL(
                          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`,
                        );
                        mb.searchParams.set("access_token", MAPBOX_PUBLIC_TOKEN);
                        mb.searchParams.set("autocomplete", "true");
                        mb.searchParams.set("limit", String(Math.max(remaining, 40)));
                        mb.searchParams.set("types", "poi,address");
                        if (bounded) mb.searchParams.set("bbox", `${minLng},${minLat},${maxLng},${maxLat}`);
                        const { res: mbRes, data: mbData }: any = await fetchJsonWithTimeout(mb.toString(), 2800);
                        if (!mbRes.ok || !Array.isArray(mbData?.features)) return false;
                        let added = 0;
                        const latPad = Math.max((maxLat - minLat) * 0.15, 0.01);
                        const lngPad = Math.max((maxLng - minLng) * 0.15, 0.01);
                        for (const row of mbData.features) {
                          if (added >= remaining) break;
                          const [lon, lat] = row?.center ?? [];
                          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
                          if (
                            lat < minLat - latPad ||
                            lat > maxLat + latPad ||
                            lon < minLng - lngPad ||
                            lon > maxLng + lngPad
                          )
                            continue;
                          const id = `${term}-mbdirect-${String(row?.id ?? `${lat}-${lon}`)}`;
                          const dup = cappedByTermBatch.some(
                            (p) =>
                              p.term === term &&
                              (p.id === id ||
                                (Math.abs(p.latitude - lat) < 0.00035 && Math.abs(p.longitude - lon) < 0.00035)),
                          );
                          if (dup) continue;
                          cappedByTermBatch.push({
                            id,
                            term,
                            color,
                            latitude: Number(lat),
                            longitude: Number(lon),
                            name: String(row?.text ?? term),
                            displayName: String(row?.place_name ?? row?.text ?? term),
                            category: "poi",
                            type: "mapbox-direct",
                          });
                          added += 1;
                        }
                        return added > 0;
                      };

                      const variants = Array.from(
                        new Set([term, canonical, `${canonical} near me`, `${canonical} in area`]),
                      );
                      for (const v of variants) {
                        recovered = await fetchMapbox(v, true);
                        if (!recovered) recovered = await fetchMapbox(v, false);
                        if (recovered) break;
                      }
                      if (recovered) recoveredBatchTerms.add(term);
                    }
                  } catch {
                    // no-op
                  }
                }

                if (recovered) statusParts.push(`${term}:recovered`);
              }
            }

            const normalizedBatchPins = normalizePinsByTerm(cappedByTermBatch);
            const batchStatusSummary = statusParts.join("|");

            // If batch path yields no pins after recovery, fall through to legacy fanout path.
            if (normalizedBatchPins.length === 0) {
              debugError = batchStatusSummary || "batch_zero_after_recovery";
              continue;
            }

            const termDebug = poiTerms
              .map((term) => {
                const count = normalizedBatchPins.filter((p) => p.term === term).length;
                const status = recoveredBatchTerms.has(term)
                  ? "recovered"
                  : (perTermStatus.get(term)?.status ?? (failedBatchTerms.has(term) ? "sparse" : "ok"));
                return `${term}:${count}(${status})`;
              })
              .join("|");
            if (requestId !== poiRequestSeqRef.current) return;

            lastPoiRegionRef.current = {
              latitude: region.latitude,
              longitude: region.longitude,
              latitudeDelta: region.latitudeDelta,
              longitudeDelta: region.longitudeDelta,
            };
            let mergedForSelection: SearchPin[] = normalizedBatchPins;
            setSearchedPins((prev) => {
              if (!failedBatchTerms.size || prev.length === 0) {
                mergedForSelection = normalizedBatchPins;
                return normalizedBatchPins;
              }
              const merged = [...normalizedBatchPins];
              const preserveTerms = new Set([...failedBatchTerms].filter((term) => !recoveredBatchTerms.has(term)));
              if (!preserveTerms.size) {
                mergedForSelection = merged;
                return merged;
              }
              const seen = new Set(merged.map((p) => p.id));
              for (const pin of prev) {
                if (preserveTerms.has(pin.term) && inViewport(pin.latitude, pin.longitude) && !seen.has(pin.id)) {
                  merged.push(pin);
                  seen.add(pin.id);
                }
              }
              mergedForSelection = normalizePinsByTerm(merged);
              return mergedForSelection;
            });
            setPoiSuggestions(Array.from(suggestionBag).slice(0, 6));
            setPoiDebug({
              count: mergedForSelection.length,
              base: debugBase,
              mode: debugMode,
              error: batchStatusSummary || undefined,
              terms: termDebug || undefined,
            });
            setSelectedPoiId((prev) => (prev && mergedForSelection.some((p) => p.id === prev) ? prev : null));
            return;
          } catch {
            // try next base candidate
          }
        }

        // Stable-map mode: disable legacy client fan-out in normal operation.
        // If batch is unavailable, preserve prior pins (if any) and do not swap to a different fetch strategy.
        const USE_LEGACY_FANOUT_ON_BATCH_FAIL = false;
        const currentSearchedPins = searchedPinsRef.current;
        const preservedInView = currentSearchedPins.filter((p) => inViewport(p.latitude, p.longitude));
        const preservedTermsInView = new Set(preservedInView.map((p) => p.term));
        const minVisibleTarget = Math.max(6, poiTerms.length * 4);
        const allowEmergencyFanout =
          Platform.OS === "ios" ||
          currentSearchedPins.length < 20 ||
          preservedInView.length < minVisibleTarget ||
          preservedTermsInView.size < poiTerms.length;

        if (!USE_LEGACY_FANOUT_ON_BATCH_FAIL && !allowEmergencyFanout) {
          if (requestId !== poiRequestSeqRef.current) return;
          const preservedCount = currentSearchedPins.length;
          setPoiDebug({
            count: preservedCount,
            base: debugBase,
            mode: "server-batch",
            error: "batch_unavailable_preserved",
            terms: `inView=${preservedInView.length};termCoverage=${preservedTermsInView.size}/${poiTerms.length}`,
          });
          return;
        }
        if (!USE_LEGACY_FANOUT_ON_BATCH_FAIL && allowEmergencyFanout) {
          setPoiDebug((prev) => ({
            ...prev,
            mode: "server-batch",
            error: "batch_unavailable_emergency_fanout",
            terms: `inView=${preservedInView.length};termCoverage=${preservedTermsInView.size}/${poiTerms.length}`,
          }));
        }

        for (const [idx, term] of poiTerms.entries()) {
          const termStartLen = next.length;
          const color = POI_COLORS[idx % POI_COLORS.length];

          try {
            let data: any = null;
            let ok = false;

            for (const base of API_BASE_CANDIDATES) {
              try {
                const url = `${base}/directory/poi-search?term=${encodeURIComponent(term)}&minLat=${minLat}&maxLat=${maxLat}&minLng=${minLng}&maxLng=${maxLng}&limit=40`;
                const apiTimeoutMs = Platform.OS === "android" ? 2400 : 1500;
                const { res, data: parsed }: any = await fetchJsonWithTimeout(url, apiTimeoutMs);
                if (res.ok && Array.isArray(parsed?.items)) {
                  data = parsed;
                  ok = true;
                  debugBase = base;
                  debugMode = parsed?.mode;
                  break;
                }
                if (!res.ok) debugError = `http_${res.status}`;
              } catch {
                debugError = debugError ?? "api_timeout";
                // try next base
              }
            }

            if (ok && data) {
              if (Array.isArray(data?.suggestions)) {
                for (const s of data.suggestions) if (typeof s === "string") suggestionBag.add(s);
              }

              for (const item of data.items) {
                next.push({
                  id: `${term}-${item.id}`,
                  term,
                  color,
                  latitude: Number(item.latitude),
                  longitude: Number(item.longitude),
                  name: String(item.name ?? term),
                  displayName: String(item.displayName ?? ""),
                  category: item.category ?? null,
                  type: item.type ?? null,
                });
              }
            } else {
              debugError = debugError ?? "api_unreachable";

              const termBeforeFallback = next.length;
              const canonical = /^high\s*schools?$|^highschools?$/.test(term)
                ? "high school"
                : /\bschools?\b|academy|university|college|campus/.test(term)
                  ? "school"
                  : /park|playground|recreation|sports\s*field|green\s*space/.test(term)
                    ? "park"
                    : /beach|shore|coast|waterfront/.test(term)
                      ? "beach"
                      : /church|worship|cathedral|temple|mosque|synagogue/.test(term)
                        ? "church"
                        : /mall|shopping\s*center|plaza/.test(term)
                          ? "mall"
                          : /lake|pond|reservoir/.test(term)
                            ? "lake"
                            : term;

              const isRelevantResult = (qTerm: string, text: string, type: string) => {
                const hay = `${text} ${type}`.toLowerCase();
                const hasHouseNumberPrefix = /^\s*\d{1,6}\s+/.test(text);
                const hasZipTail = /,\s*[a-z]{2}\s+\d{5}(?:-\d{4})?\b/i.test(text);
                if (hasHouseNumberPrefix || hasZipTail) return false;

                if (/park|playground|recreation|green\s*space/.test(qTerm)) {
                  if (
                    /business\s*park|office\s*park|industrial\s*park|corporate\s*park|work\s*park|logistics\s*park|commercial\s*park/.test(
                      hay,
                    )
                  )
                    return false;
                  if (/address|street|road|avenue|boulevard|lane|drive|court|zip/.test(hay)) return false;
                  return /\bpark\b|playground|recreation|green\s*space|nature\s*reserve/.test(hay);
                }
                if (/high\s*school|highschools?/.test(qTerm)) {
                  return /high\s*school|secondary\s*school|senior\s*high|public\s*school|charter\s*school/.test(hay);
                }
                if (/school|academy|university|college|campus|kindergarten|elementary/.test(qTerm)) {
                  const isPoiLike = /poi|school|education|college|university|academy/.test(hay);
                  return isPoiLike && /school|academy|university|college|campus|kindergarten|elementary/.test(hay);
                }
                return true;
              };

              if (MAPBOX_PUBLIC_TOKEN) {
                try {
                  const extraVariants = /park|playground|recreation|green\s*space/.test(term)
                    ? ["park", "public park", "playground", "recreation area"]
                    : /high\s*school|highschools?/.test(term)
                      ? ["high school", "public high school", "secondary school"]
                      : /school|academy|university|college|campus|kindergarten|elementary/.test(term)
                        ? ["school", "elementary school", "middle school", "high school"]
                        : [];

                  const termVariants = Array.from(
                    new Set([term, canonical, `${canonical} near me`, `${canonical} in area`, ...extraVariants]),
                  );

                  const fetchMapboxDevice = async (query: string, bounded: boolean, types: string) => {
                    const mb = new URL(
                      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`,
                    );
                    mb.searchParams.set("access_token", MAPBOX_PUBLIC_TOKEN);
                    mb.searchParams.set("autocomplete", "true");
                    mb.searchParams.set("limit", "80");
                    mb.searchParams.set("types", types);
                    if (bounded) mb.searchParams.set("bbox", `${minLng},${minLat},${maxLng},${maxLat}`);

                    const { res: mbRes, data: mbData }: any = await fetchJsonWithTimeout(mb.toString(), 3200);
                    if (!mbRes.ok) {
                      debugError = debugError ?? `mb_http_${mbRes.status}`;
                      return false;
                    }

                    if (Array.isArray(mbData?.features)) {
                      const latPad = Math.max((maxLat - minLat) * 0.45, 0.03);
                      const lngPad = Math.max((maxLng - minLng) * 0.45, 0.03);
                      for (const row of mbData.features) {
                        const lon = Number(row?.center?.[0]);
                        const lat = Number(row?.center?.[1]);
                        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
                        if (
                          lat < minLat - latPad ||
                          lat > maxLat + latPad ||
                          lon < minLng - lngPad ||
                          lon > maxLng + lngPad
                        )
                          continue;
                        const text = String(row?.place_name ?? row?.text ?? term);
                        const type = String(row?.place_type?.[0] ?? row?.properties?.feature_type ?? "");
                        if (!isRelevantResult(term, text, type)) continue;
                        next.push({
                          id: `${term}-mapbox-${row.id}`,
                          term,
                          color,
                          latitude: lat,
                          longitude: lon,
                          name: String(row?.text ?? term),
                          displayName: text,
                          category: "poi",
                          type: "mapbox-device-poi",
                        });
                      }
                      return next.length > termBeforeFallback;
                    }
                    return false;
                  };

                  for (const q of termVariants) {
                    let got = await fetchMapboxDevice(q, true, "poi");
                    if (!got) got = await fetchMapboxDevice(q, false, "poi");
                    if (!got) got = await fetchMapboxDevice(q, true, "poi,address");
                    if (!got) got = await fetchMapboxDevice(q, false, "poi,address");
                    if (got) {
                      debugMode = "mapbox-device";
                      break;
                    }
                  }
                } catch {
                  debugError = debugError ?? "mb_fetch_failed";
                }
              } else {
                debugError = debugError ?? "mb_token_missing";
              }

              if (next.length === termBeforeFallback) {
                try {
                  const nomVariants = Array.from(new Set([canonical, term, "high school", "school"]));
                  const runNominatim = async (query: string, bounded: boolean) => {
                    const nominatim = new URL("https://nominatim.openstreetmap.org/search");
                    nominatim.searchParams.set("q", query);
                    nominatim.searchParams.set("format", "jsonv2");
                    nominatim.searchParams.set("limit", "80");
                    nominatim.searchParams.set("viewbox", `${minLng},${maxLat},${maxLng},${minLat}`);
                    if (bounded) nominatim.searchParams.set("bounded", "1");

                    const { res: fallbackRes, data: fallbackData }: any = await fetchJsonWithTimeout(
                      nominatim.toString(),
                      3200,
                    );
                    if (!fallbackRes.ok || !Array.isArray(fallbackData)) return false;

                    const latPad = Math.max((maxLat - minLat) * 0.45, 0.03);
                    const lngPad = Math.max((maxLng - minLng) * 0.45, 0.03);

                    for (const row of fallbackData) {
                      const lat = Number(row?.lat);
                      const lon = Number(row?.lon);
                      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
                      if (
                        lat < minLat - latPad ||
                        lat > maxLat + latPad ||
                        lon < minLng - lngPad ||
                        lon > maxLng + lngPad
                      )
                        continue;
                      const text = String(row?.display_name ?? "");
                      const type = String(row?.type ?? row?.category ?? "");
                      if (!isRelevantResult(term, text, type)) continue;
                      next.push({
                        id: `${term}-nominatim-${row.place_id}`,
                        term,
                        color,
                        latitude: lat,
                        longitude: lon,
                        name: text.split(",")[0],
                        displayName: text,
                        category: row?.category ?? "poi",
                        type: row?.type ?? "nominatim-poi",
                      });
                    }

                    return next.length > termBeforeFallback;
                  };

                  let got = false;
                  for (const q of nomVariants) {
                    got = await runNominatim(q, true);
                    if (!got) got = await runNominatim(q, false);
                    if (got) break;
                  }
                  if (got) debugMode = debugMode ?? "nominatim-device";
                } catch {
                  // no-op
                }
              }
            }
          } catch {
            // API error for this term
          }

          if (next.length === termStartLen) {
            failedTerms.add(term);
          }
        }

        // last-write wins via debounced timer; no stale apply guard needed here
        const deduped = next.filter((pin, idx, arr) => {
          const sameNear = arr.findIndex(
            (other, j) =>
              j < idx &&
              other.term === pin.term &&
              Math.abs(other.latitude - pin.latitude) < 0.00035 &&
              Math.abs(other.longitude - pin.longitude) < 0.00035,
          );
          return sameNear === -1;
        });

        const cappedByTerm: SearchPin[] = normalizePinsByTerm(deduped);
        const termDebug = poiTerms
          .map(
            (term) =>
              `${term}:${cappedByTerm.filter((p) => p.term === term).length}(${failedTerms.has(term) ? "fallback" : "ok"})`,
          )
          .join("|");

        if (requestId !== poiRequestSeqRef.current) return;
        lastPoiRegionRef.current = {
          latitude: region.latitude,
          longitude: region.longitude,
          latitudeDelta: region.latitudeDelta,
          longitudeDelta: region.longitudeDelta,
        };
        setSearchedPins((prev) => {
          const timeoutFailure =
            cappedByTerm.length === 0 && (debugError?.includes("timeout") || debugError === "api_unreachable");
          if (timeoutFailure && prev.length > 0) return prev;

          if (!failedTerms.size || prev.length === 0) return cappedByTerm;

          const merged = [...cappedByTerm];
          const seen = new Set(merged.map((p) => p.id));
          for (const pin of prev) {
            if (failedTerms.has(pin.term) && inViewport(pin.latitude, pin.longitude) && !seen.has(pin.id)) {
              merged.push(pin);
              seen.add(pin.id);
            }
          }
          return normalizePinsByTerm(merged);
        });
        setPoiSuggestions(Array.from(suggestionBag).slice(0, 6));
        setPoiDebug({
          count: cappedByTerm.length,
          base: debugBase,
          mode: debugMode,
          error: debugError,
          terms: termDebug || undefined,
        });
        setSelectedPoiId((prev) => (prev && cappedByTerm.some((p) => p.id === prev) ? prev : null));
      })();
    }, 40);

    return () => {
      if (poiFetchTimer.current) clearTimeout(poiFetchTimer.current);
    };
  }, [
    showSearchedItems,
    poiTerms,
    poiFetchNonce,
    pinLimitPerTerm,
    region.latitude,
    region.longitude,
    region.latitudeDelta,
    region.longitudeDelta,
  ]);

  const VIEWPORT_FETCH_DEBOUNCE_MS = 220;

  const onRegionChangeComplete = (r: Region) => {
    const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
    const safeRegion: Region = {
      latitude: clamp(r.latitude, -85, 85),
      longitude: clamp(r.longitude, -180, 180),
      latitudeDelta: clamp(r.latitudeDelta, 0.004, 30),
      longitudeDelta: clamp(r.longitudeDelta, 0.004, 60),
    };

    setRegion(safeRegion);
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    fetchTimer.current = setTimeout(() => {
      void fetchHomes(safeRegion);
    }, VIEWPORT_FETCH_DEBOUNCE_MS);
  };

  const toggleFavorite = (homeId: string) => {
    setFavoriteIds((prev) => (prev.includes(homeId) ? prev.filter((id) => id !== homeId) : [...prev, homeId]));
  };

  const resetFilters = () => {
    setFavoritesOnly(false);
    setClaimedOnly(false);
    setShowSearchedItems(false);
    setPoiTerms([]);
    setPoiInput("");
  };

  const normalizePoiTerm = (raw: string) => {
    const t = raw.toLowerCase().trim();
    const typoMap: Record<string, string> = {
      oarks: "parks",
      schols: "schools",
      highschols: "highschools",
      hichschools: "highschools",
    };
    return typoMap[t] ?? t;
  };

  const addPoiTerm = () => {
    const parts = poiInput
      .toLowerCase()
      .split(/,|&|\band\b/g)
      .map((s) => normalizePoiTerm(s))
      .filter(Boolean);

    if (!parts.length) return false;

    setPoiTerms((prev) => {
      const next = [...prev];
      for (const term of parts) {
        if (!next.includes(term)) next.push(term);
      }
      return next;
    });

    setPoiInput("");
    setShowSearchedItems(true);
    setPoiFetchNonce((n) => n + 1);
    setAddAck(true);
    setTimeout(() => setAddAck(false), 900);
    return true;
  };

  const selectedHome = useMemo(() => {
    if (!selectedId) return null;
    return homes.find((h) => h.id === selectedId) ?? homeCache[selectedId] ?? null;
  }, [homes, homeCache, selectedId]);
  const filteredHomes = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = homes.filter((h) => {
      if (q && !`${h.addr} ${h.price} ${h.meta}`.toLowerCase().includes(q)) return false;
      if (claimedOnly && !h.claimed) return false;
      if (favoritesOnly && !favoriteIds.includes(h.id)) return false;
      return true;
    });

    // Preserve selected card if current viewport response omits it but cache still has it.
    if (selectedHome && !base.some((h) => h.id === selectedHome.id)) {
      base.unshift(selectedHome);
    }

    // Prioritize claimed properties in current viewport result ordering.
    return base.sort((a, b) => Number(Boolean(b.claimed)) - Number(Boolean(a.claimed)));
  }, [homes, query, claimedOnly, favoritesOnly, favoriteIds, selectedHome]);

  const markerHomes = useMemo(() => {
    if (!selectedHome || filteredHomes.some((h) => h.id === selectedHome.id)) return filteredHomes;
    return [selectedHome, ...filteredHomes];
  }, [filteredHomes, selectedHome]);

  const selectedPoi = useMemo(
    () => searchedPins.find((p) => p.id === selectedPoiId) ?? null,
    [searchedPins, selectedPoiId],
  );

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (claimedOnly) count += 1;
    if (favoritesOnly) count += 1;
    if (showSearchedItems && poiTerms.length > 0) count += poiTerms.length;
    return count;
  }, [claimedOnly, favoritesOnly, showSearchedItems, poiTerms.length]);

  const handleFiltersDone = () => {
    if (poiInput.trim()) addPoiTerm();
    if (poiTerms.length > 0) setShowSearchedItems(true);
    setShowFilters(false);
    setPoiFetchNonce((n) => n + 1);
    setDoneAck(true);
    setTimeout(() => setDoneAck(false), 900);
  };

  useEffect(() => {
    if (poiTerms.length > 0 && !showSearchedItems) {
      setShowSearchedItems(true);
    }
  }, [poiTerms, showSearchedItems]);

  const visibleSearchedPins = useMemo(() => {
    // Render only pins inside current viewport (plus tiny edge pad) and not under lower occlusion.
    const latPad = Math.max(region.latitudeDelta * 0.08, 0.003);
    const lngPad = Math.max(region.longitudeDelta * 0.08, 0.003);
    const minLat = region.latitude - region.latitudeDelta / 2 - latPad;
    const maxLat = region.latitude + region.latitudeDelta / 2 + latPad;
    const minLng = region.longitude - region.longitudeDelta / 2 - lngPad;
    const maxLng = region.longitude + region.longitudeDelta / 2 + lngPad;

    const bottomOcclusionRatio = 0.12;
    const minVisibleLat = region.latitude - region.latitudeDelta / 2 + region.latitudeDelta * bottomOcclusionRatio;

    return searchedPins.filter(
      (pin) =>
        pin.latitude >= minVisibleLat &&
        pin.latitude >= minLat &&
        pin.latitude <= maxLat &&
        pin.longitude >= minLng &&
        pin.longitude <= maxLng,
    );
  }, [searchedPins, region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta]);

  const searchedRenderItems = useMemo<SearchedRenderItem[]>(() => {
    const radiusMiles = 0.5;
    const clusterMinCount = 5;
    const used = new Set<string>();
    const items: SearchedRenderItem[] = [];

    for (const pin of visibleSearchedPins) {
      if (used.has(pin.id)) continue;
      const group = visibleSearchedPins.filter(
        (other) =>
          !used.has(other.id) &&
          distanceMiles(pin.latitude, pin.longitude, other.latitude, other.longitude) <= radiusMiles,
      );

      if (group.length >= clusterMinCount) {
        for (const g of group) used.add(g.id);
        const lat = group.reduce((s, p) => s + p.latitude, 0) / group.length;
        const lng = group.reduce((s, p) => s + p.longitude, 0) / group.length;
        const termCounts = new Map<string, number>();
        for (const g of group) termCounts.set(g.term, (termCounts.get(g.term) ?? 0) + 1);
        const [dominantTerm] = [...termCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [pin.term, 1];
        const dominantColor = group.find((g) => g.term === dominantTerm)?.color ?? pin.color;
        items.push({
          kind: "cluster",
          id: `cluster-${dominantTerm}-${lat.toFixed(5)}-${lng.toFixed(5)}`,
          latitude: lat,
          longitude: lng,
          count: group.length,
          dominantTerm,
          dominantColor,
        });
      } else {
        used.add(pin.id);
        items.push({ kind: "pin", pin });
      }
    }

    return items;
  }, [visibleSearchedPins]);

  const searchedGlyph = (term: string) => {
    if (/high\s*school|school|academy|university|universities|college|campus|elementary|kindergarten|k-?12/.test(term))
      return "graduation-cap";
    if (/park|playground|recreation|sports\s*field|green\s*space/.test(term)) return "tree";
    if (/beach|shore|coast|waterfront/.test(term)) return "umbrella-beach";
    if (/church|worship|cathedral|temple|mosque|synagogue/.test(term)) return "place-of-worship";
    if (/mall|shopping\s*center|plaza/.test(term)) return "shopping-bag";
    if (/lake|pond|reservoir/.test(term)) return "water";
    return "map-marker-alt";
  };

  const mapType = mapMode === "3d" ? "hybrid" : mapMode === "satellite" ? "satellite" : "standard";

  const mapModeLabel =
    mapMode === "dark"
      ? t("directory.darkMapMode")
      : mapMode === "satellite"
        ? t("directory.satelliteMapMode")
        : mapMode === "3d"
          ? t("directory.3dMapMode")
          : t("directory.defaultMapMode");

  if (booting) {
    return (
      <View style={styles.container}>
        <View style={[styles.sheet, { marginTop: 0, justifyContent: "center", alignItems: "center" }]}>
          <Text style={styles.sheetTitle}>{t("directory.checkingSession")}</Text>
        </View>
      </View>
    );
  }

  if (!isAuthenticated && !demoMode) {
    return (
      <View style={styles.container}>
        <View
          style={[
            styles.sheet,
            { marginTop: 0, justifyContent: "center", alignItems: "center", paddingHorizontal: 24 },
          ]}
        >
          <Text style={styles.sheetTitle}>{t("directory.authRequired")}</Text>
          <Text style={styles.selectedHint}>{t("directory.authRequiredBody")}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.mapBg}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        initialRegion={initialRegion}
        onRegionChangeComplete={onRegionChangeComplete}
        onPress={() => {
          Keyboard.dismiss();
          searchRef.current?.blur();
          setShowMapModeMenu(false);
          setShowFilters(false);
          setShowFavoritesPanel(false);
          setSelectedPoiId(null);
        }}
        customMapStyle={Platform.OS === "android" ? (mapMode === "dark" ? DARK_MAP_STYLE : undefined) : undefined}
        mapType={mapType}
        userInterfaceStyle={Platform.OS === "ios" ? (mapMode === "dark" ? "dark" : "light") : undefined}
        showsUserLocation
        showsCompass
        pitchEnabled={mapMode === "3d"}
        rotateEnabled={mapMode === "3d"}
        showsBuildings={mapMode === "3d"}
      >
        {markerHomes.map((home) => (
          <Marker
            key={home.id}
            coordinate={{ latitude: home.latitude, longitude: home.longitude }}
            title={home.price}
            description={home.addr}
            onPress={() => setSelectedId(home.id)}
          >
            <PropertyPin claimed={home.claimed} selected={home.id === selectedId} />
          </Marker>
        ))}
        {searchedRenderItems.map((item) => {
          // Android reliability path: avoid custom marker children for searched-item pins/clusters.
          // Native pinColor markers render far more consistently under heavy updates.
          if (Platform.OS === "android") {
            if (item.kind === "pin") {
              return (
                <Marker
                  key={item.pin.id}
                  coordinate={{ latitude: item.pin.latitude, longitude: item.pin.longitude }}
                  title={item.pin.name}
                  description={item.pin.displayName ?? `Searched item: ${item.pin.term}`}
                  onPress={() => setSelectedPoiId((prev) => (prev === item.pin.id ? null : item.pin.id))}
                  pinColor={item.pin.color}
                />
              );
            }
            return (
              <Marker
                key={item.id}
                coordinate={{ latitude: item.latitude, longitude: item.longitude }}
                title={`${item.count} searched items`}
                description={`Cluster around ${item.dominantTerm}`}
                pinColor={item.dominantColor}
              />
            );
          }

          return item.kind === "pin" ? (
            <Marker
              key={item.pin.id}
              coordinate={{ latitude: item.pin.latitude, longitude: item.pin.longitude }}
              title={item.pin.name}
              description={item.pin.displayName ?? `Searched item: ${item.pin.term}`}
              onPress={() => setSelectedPoiId((prev) => (prev === item.pin.id ? null : item.pin.id))}
            >
              <View style={[styles.poiGlyphPin, { backgroundColor: item.pin.color }]}>
                <FontAwesome5 name={searchedGlyph(item.pin.term)} size={10} color="#FFFFFF" />
              </View>
            </Marker>
          ) : (
            <Marker
              key={item.id}
              coordinate={{ latitude: item.latitude, longitude: item.longitude }}
              title={`${item.count} searched items`}
              description={`Cluster around ${item.dominantTerm}`}
            >
              <View style={[styles.poiClusterBubble, { backgroundColor: item.dominantColor }]}>
                <Text style={styles.poiClusterCount}>{item.count}</Text>
              </View>
            </Marker>
          );
        })}
      </MapView>
      {mapMode === "dark" ? (
        <View
          pointerEvents="none"
          style={Platform.OS === "android" ? styles.androidDarkOverlay : styles.iosDarkOverlay}
        />
      ) : null}

      {__DEV__ && isMapboxEngineEnabled ? (
        <MapboxNativeSpike
          latitude={region.latitude}
          longitude={region.longitude}
          homes={markerHomes}
          searchedPins={visibleSearchedPins}
        />
      ) : null}

      <View style={styles.topBarMeta}>
        <Text style={styles.authModeLabel}>
          {demoMode
            ? t("directory.publicDemo")
            : t("directory.signedIn", { email: user?.email ?? t("directory.account") })}
        </Text>
        {!demoMode ? (
          <Pressable onPress={() => void logout(false)}>
            <Text style={styles.authModeAction}>{t("directory.logOut")}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.topBar}>
        <View style={styles.glassSearch}>
          <TextInput
            ref={searchRef}
            value={query}
            onChangeText={setQuery}
            onFocus={() => {
              if (suppressNextFocus.current) {
                suppressNextFocus.current = false;
                requestAnimationFrame(() => {
                  Keyboard.dismiss();
                  searchRef.current?.blur();
                });
                return;
              }
              setSearchFocused(true);
            }}
            onBlur={() => setSearchFocused(false)}
            onPressIn={() => {
              if (searchFocused) {
                suppressNextFocus.current = true;
                Keyboard.dismiss();
                searchRef.current?.blur();
              }
            }}
            placeholder={t("directory.searchPlaceholder")}
            placeholderTextColor="#cbd5e1"
            style={styles.searchInput}
          />
          <View style={styles.searchActionsInline}>
            <Pressable
              style={[styles.searchInlineBtn, (favoritesOnly || showFavoritesPanel) && styles.searchInlineBtnActive]}
              onPress={() => {
                setShowFavoritesPanel((v) => !v);
                setShowFilters(false);
                setShowMapModeMenu(false);
              }}
            >
              <FontAwesome5
                name="heart"
                size={14}
                color={favoritesOnly || showFavoritesPanel ? "#60A5FA" : "#E2E8F0"}
                solid={favoritesOnly || showFavoritesPanel}
              />
            </Pressable>
            <Pressable
              style={[styles.searchInlineBtn, (showFilters || activeFilterCount > 0) && styles.searchInlineBtnActive]}
              onPress={() => {
                setShowFilters((v) => !v);
                setShowFavoritesPanel(false);
                setShowMapModeMenu(false);
              }}
            >
              <FontAwesome5
                name="sliders-h"
                size={15}
                color={showFilters || activeFilterCount > 0 ? "#60A5FA" : "#E2E8F0"}
              />
              {activeFilterCount > 0 ? (
                <View style={styles.filterBadge}>
                  <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
                </View>
              ) : null}
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.topActions}>
        <View style={styles.glassPill}>
          <Text style={styles.pillText}>{t("directory.sortHomesForYou")}</Text>
        </View>
        <View style={styles.glassPill}>
          <Text style={styles.pillText}>{t("directory.saveSearch")}</Text>
        </View>
      </View>

      <View style={styles.mapModeRow}>
        <Pressable style={styles.mapModeBtn} onPress={() => setShowMapModeMenu((v) => !v)}>
          <FontAwesome5 name="map-marked-alt" size={14} color="#E2E8F0" />
          <Text style={styles.mapModeText}>{mapModeLabel}</Text>
          <FontAwesome5 name={showMapModeMenu ? "chevron-up" : "chevron-down"} size={11} color="#E2E8F0" />
        </Pressable>
        {showMapModeMenu ? (
          <View style={styles.mapModeMenu}>
            {modeOrder.map((modeOption) => (
              <Pressable
                key={modeOption}
                style={[styles.mapModeItem, mapMode === modeOption && styles.mapModeItemActive]}
                onPress={() => {
                  setMapMode(modeOption);
                  setShowMapModeMenu(false);
                }}
              >
                <Text style={[styles.mapModeItemText, mapMode === modeOption && styles.mapModeItemTextActive]}>
                  {modeOption === "dark"
                    ? t("directory.darkMapMode")
                    : modeOption === "satellite"
                      ? t("directory.satelliteMapMode")
                      : modeOption === "3d"
                        ? t("directory.3dMapMode")
                        : t("directory.defaultMapMode")}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {showFavoritesPanel ? (
        <View style={styles.filtersPanel}>
          <Text style={styles.filtersTitle}>{t("directory.favorites")}</Text>
          <Pressable style={styles.filterRow} onPress={() => setFavoritesOnly((v) => !v)}>
            <Text style={styles.filterRowText}>{t("directory.showFavoritesOnly")}</Text>
            <FontAwesome5
              name={favoritesOnly ? "check-circle" : "circle"}
              size={16}
              color={favoritesOnly ? "#60A5FA" : "#94A3B8"}
            />
          </Pressable>
          <View style={styles.filterActions}>
            <Pressable style={styles.filterActionBtn} onPress={() => setFavoritesOnly(false)}>
              <Text style={styles.filterActionText}>{t("directory.reset")}</Text>
            </Pressable>
            <Pressable
              style={[styles.filterActionBtn, styles.filterActionBtnPrimary]}
              onPress={() => setShowFavoritesPanel(false)}
            >
              <Text style={[styles.filterActionText, styles.filterActionTextPrimary]}>{t("directory.done")}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {showFilters ? (
        <View style={styles.filtersPanel}>
          <Text style={styles.filtersTitle}>{t("directory.filters")}</Text>
          <Pressable style={styles.filterRow} onPress={() => setClaimedOnly((v) => !v)}>
            <Text style={styles.filterRowText}>{t("directory.claimedPropertiesOnly")}</Text>
            <FontAwesome5
              name={claimedOnly ? "check-circle" : "circle"}
              size={16}
              color={claimedOnly ? "#60A5FA" : "#94A3B8"}
            />
          </Pressable>
          <Pressable style={styles.filterRow} onPress={() => setFavoritesOnly((v) => !v)}>
            <Text style={styles.filterRowText}>{t("directory.favoritesOnly")}</Text>
            <FontAwesome5
              name={favoritesOnly ? "check-circle" : "circle"}
              size={16}
              color={favoritesOnly ? "#60A5FA" : "#94A3B8"}
            />
          </Pressable>
          <View style={styles.filterRowSplit}>
            <Pressable
              style={styles.filterRowToggle}
              onPress={() => {
                setShowSearchedItems((v) => {
                  const next = !v;
                  if (next) {
                    setShowSearchedItemsPanelOpen(true);
                    setTimeout(() => poiInputRef.current?.focus(), 60);
                  }
                  return next;
                });
              }}
            >
              <Text style={styles.filterRowText}>{t("directory.showSearchedItems")}</Text>
              <FontAwesome5
                name={showSearchedItems ? "check-circle" : "circle"}
                size={16}
                color={showSearchedItems ? "#60A5FA" : "#94A3B8"}
              />
            </Pressable>
            {showSearchedItems ? (
              <Pressable style={styles.filterExpandBtn} onPress={() => setShowSearchedItemsPanelOpen((v) => !v)}>
                <FontAwesome5
                  name={showSearchedItemsPanelOpen ? "chevron-up" : "chevron-down"}
                  size={12}
                  color="#cbd5e1"
                />
              </Pressable>
            ) : null}
          </View>

          {showSearchedItems && showSearchedItemsPanelOpen ? (
            <View style={styles.poiSection}>
              <View style={styles.poiInputRow}>
                <TextInput
                  ref={poiInputRef}
                  value={poiInput}
                  onChangeText={setPoiInput}
                  onFocus={() => setIsPoiInputFocused(true)}
                  onBlur={() => setIsPoiInputFocused(false)}
                  onPressIn={() => {
                    if (isPoiInputFocused && !poiInput.trim()) {
                      Keyboard.dismiss();
                      poiInputRef.current?.blur();
                    }
                  }}
                  placeholder={t("directory.poiPlaceholder")}
                  placeholderTextColor="#94A3B8"
                  style={styles.poiInput}
                  onSubmitEditing={() => {
                    if (!poiInput.trim()) {
                      Keyboard.dismiss();
                      poiInputRef.current?.blur();
                      return;
                    }
                    addPoiTerm();
                  }}
                  onKeyPress={(e) => {
                    if (e.nativeEvent.key === "Enter" && !poiInput.trim()) {
                      Keyboard.dismiss();
                      poiInputRef.current?.blur();
                    }
                  }}
                  blurOnSubmit={false}
                  returnKeyType="done"
                />
                <Pressable style={[styles.poiAddBtn, addAck && styles.poiAddBtnAck]} onPress={addPoiTerm}>
                  <Text style={styles.poiAddBtnText}>{addAck ? t("directory.added") : t("directory.add")}</Text>
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
              {__DEV__ ? (
                <Text style={styles.poiSuggestLabel}>
                  debug build={BUILD_ID} pins={poiDebug.count} mode={poiDebug.mode ?? "-"} base={poiDebug.base ?? "-"}{" "}
                  err={poiDebug.error ?? "-"} terms={poiDebug.terms ?? "-"} mbToken={MAPBOX_PUBLIC_TOKEN ? "yes" : "no"}
                </Text>
              ) : null}
              {searchedPins.length === 0 && poiTerms.length > 0 && poiSuggestions.length > 0 ? (
                <View>
                  <Text style={styles.poiSuggestLabel}>{t("directory.noMatchesViewport")}</Text>
                  <View style={styles.poiChipWrap}>
                    {poiSuggestions.map((s) => (
                      <Pressable key={s} style={styles.poiChip} onPress={() => setPoiInput(s)}>
                        <Text style={styles.poiChipText}>{s}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={styles.filterActions}>
            <Pressable style={styles.filterActionBtn} onPress={resetFilters}>
              <Text style={styles.filterActionText}>{t("directory.reset")}</Text>
            </Pressable>
            <Pressable
              style={[styles.filterActionBtn, styles.filterActionBtnPrimary, doneAck && styles.filterActionBtnAck]}
              onPress={handleFiltersDone}
            >
              <Text style={[styles.filterActionText, styles.filterActionTextPrimary]}>
                {doneAck ? t("directory.applied") : t("directory.done")}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {selectedPoi ? (
        <View style={styles.poiInfoCard}>
          <Text style={styles.poiInfoTitle}>{selectedPoi.name}</Text>
          <Text style={styles.poiInfoMeta}>{selectedPoi.term}</Text>
          <Text style={styles.poiInfoDesc}>
            {selectedPoi.displayName ||
              t("directory.poiDescriptionFallback", {
                category: selectedPoi.category ?? t("directory.placeFallback"),
                type: selectedPoi.type ?? t("directory.searchResultFallback"),
              })}
          </Text>
        </View>
      ) : null}

      <Animated.View style={[styles.sheet, { transform: [{ translateY: sheetTranslateY }] }]}>
        <View style={styles.sheetDragZone} {...panResponder.panHandlers}>
          <View style={styles.sheetGrabWrap}>
            <View style={styles.sheetGrabber} />
          </View>
          <Text style={styles.sheetTitle}>
            {t("directory.homesRegisteredInArea", { count: filteredHomes.length.toLocaleString() })}
          </Text>
          {selectedHome ? (
            <Text style={styles.selectedHint}>
              {t("directory.selected", { address: selectedHome.addr })}
              {filteredHomes.some((h) => h.id === selectedHome.id) ? "" : t("directory.outsideViewport")}
            </Text>
          ) : null}
        </View>

        <ScrollView contentContainerStyle={styles.cardsWrap} showsVerticalScrollIndicator={false}>
          {filteredHomes.map((home) => (
            <Pressable
              key={home.id}
              style={[styles.card, home.claimed && styles.cardClaimed, home.id === selectedId && styles.cardSelected]}
              onPress={() => setSelectedId(home.id)}
            >
              <View style={styles.fakePhoto} />
              <View style={styles.cardBody}>
                <View style={styles.priceRow}>
                  <Text style={styles.price}>{home.price}</Text>
                  <Pressable onPress={() => toggleFavorite(home.id)} hitSlop={8}>
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
                {home.claimed ? <Text style={styles.claimedBadge}>{t("directory.claimedProperty")}</Text> : null}
              </View>
            </Pressable>
          ))}
          <Text style={styles.build}>
            LIVE BUILD {BUILD_ID} • {mode ?? "default"} • region@{region.latitude.toFixed(3)},
            {region.longitude.toFixed(3)} • m[to={homeMetricsRef.current.timeout}|selDrop=
            {homeMetricsRef.current.selectionDrop}|flicker={homeMetricsRef.current.pinFlicker}|lat=
            {homeMetricsRef.current.latencyMs}ms|p95={homeMetricsRef.current.latencyP95Ms}ms|schema=
            {homeMetricsRef.current.schemaMismatch}|empty={homeMetricsRef.current.emptyResponse}]
          </Text>
        </ScrollView>
      </Animated.View>

      <View style={styles.bottomNav}>
        <View style={styles.navItemWrap}>
          <FontAwesome5 name="search" size={13} color="#93C5FD" />
          <Text style={styles.navItemActive}>{t("directory.searchTab")}</Text>
        </View>
        <View style={styles.navItemWrap}>
          <FontAwesome5 name="newspaper" size={13} color="rgba(226,232,240,0.72)" />
          <Text style={styles.navItem}>{t("directory.feedTab")}</Text>
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
          <Text style={styles.navItem}>{t("directory.exploreTab")}</Text>
        </View>
        <View style={styles.navItemWrap}>
          <FontAwesome5 name="inbox" size={13} color="rgba(226,232,240,0.72)" />
          <Text style={styles.navItem}>{t("directory.inboxTab")}</Text>
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
  iosDarkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(20,56,96,0.34)",
  },
  androidDarkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(8,18,34,0.1)",
  },
  topBarMeta: {
    marginTop: 56,
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  authModeLabel: { color: "#93C5FD", fontSize: 11, fontWeight: "800" },
  authModeAction: { color: "#E2E8F0", fontSize: 12, fontWeight: "700" },
  topBar: { marginTop: 8, paddingHorizontal: 16, flexDirection: "row", alignItems: "center" },
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
  searchInlineBtnActive: {
    backgroundColor: "rgba(96,165,250,0.18)",
  },
  filterBadge: {
    position: "absolute",
    right: -6,
    top: -6,
    minWidth: 14,
    height: 14,
    paddingHorizontal: 3,
    borderRadius: 999,
    backgroundColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
  },
  filterBadgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "800",
  },
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
  mapModeItem: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  mapModeItemActive: {
    backgroundColor: "rgba(96,165,250,0.2)",
  },
  mapModeItemText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "600",
  },
  mapModeItemTextActive: {
    color: "#93C5FD",
  },
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
  filtersTitle: {
    color: "#E2E8F0",
    fontWeight: "700",
    fontSize: 14,
  },
  filterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  filterRowSplit: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  filterRowToggle: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  filterExpandBtn: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  filterRowText: {
    color: "#cbd5e1",
    fontSize: 14,
  },
  filterActions: {
    marginTop: 4,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  filterActionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
  },
  filterActionBtnPrimary: {
    backgroundColor: "rgba(96,165,250,0.18)",
    borderColor: "rgba(96,165,250,0.55)",
  },
  filterActionBtnAck: {
    backgroundColor: "rgba(34,197,94,0.2)",
    borderColor: "rgba(34,197,94,0.55)",
  },
  filterActionText: {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: "700",
  },
  filterActionTextPrimary: {
    color: "#93C5FD",
  },
  poiSection: {
    gap: 8,
  },
  poiInputRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
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
  poiAddBtnAck: {
    backgroundColor: "rgba(34,197,94,0.2)",
    borderColor: "rgba(34,197,94,0.55)",
  },
  poiAddBtnText: {
    color: "#93C5FD",
    fontSize: 12,
    fontWeight: "700",
  },
  poiChipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  poiChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  poiChipDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
  },
  poiChipText: {
    color: "#E2E8F0",
    fontSize: 12,
  },
  poiChipX: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "700",
  },
  poiSuggestLabel: {
    color: "#94A3B8",
    fontSize: 12,
    marginBottom: 6,
  },
  propertyPinWrap: {
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  propertyPinWrapSelected: {
    transform: [{ scale: 1.06 }],
  },
  propertyPinGloss: {
    position: "absolute",
    top: 2,
    width: 12,
    height: 8,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.28)",
  },
  poiPinWrap: {
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  poiGlyphPin: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
  },
  poiClusterBubble: {
    minWidth: 30,
    height: 30,
    borderRadius: 15,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.2,
    borderColor: "rgba(255,255,255,0.95)",
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  poiClusterCount: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 12,
  },
  poiInfoCard: {
    marginTop: 8,
    marginHorizontal: 16,
    borderRadius: 14,
    padding: 10,
    backgroundColor: "rgba(5, 10, 20, 0.94)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    gap: 2,
  },
  poiInfoTitle: {
    color: "#E2E8F0",
    fontSize: 14,
    fontWeight: "700",
  },
  poiInfoMeta: {
    color: "#93C5FD",
    fontSize: 12,
    textTransform: "capitalize",
  },
  poiInfoDesc: {
    color: "#94A3B8",
    fontSize: 12,
  },
  sheet: {
    marginTop: 120,
    flex: 1,
    backgroundColor: "#070f1d",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    paddingTop: 6,
  },
  sheetDragZone: { paddingTop: 4, paddingBottom: 6 },
  sheetGrabWrap: { alignItems: "center", justifyContent: "center", paddingBottom: 6 },
  sheetGrabber: { width: 42, height: 5, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.35)" },
  sheetTitle: {
    color: "#fff",
    textAlign: "center",
    fontSize: 23,
    fontWeight: "500",
    marginBottom: 6,
    paddingHorizontal: 10,
  },
  selectedHint: { color: "#93C5FD", textAlign: "center", fontSize: 12, marginBottom: 8 },
  cardsWrap: { paddingHorizontal: 14, paddingBottom: 120, gap: 12 },
  card: {
    borderRadius: 18,
    overflow: "hidden",
    borderColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    backgroundColor: "#0b1527",
  },
  cardClaimed: { borderColor: "#22C55E" },
  cardSelected: { borderColor: "#60A5FA" },
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
