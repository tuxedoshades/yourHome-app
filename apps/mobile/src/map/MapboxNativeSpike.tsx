import { useMemo } from "react";
import Constants from "expo-constants";
import { Platform, StyleSheet, Text, View } from "react-native";

type HomeLike = {
  id: string;
  price: string;
  latitude: number;
  longitude: number;
  claimed?: boolean;
};

type PoiLike = {
  id: string;
  term: string;
  color: string;
  latitude: number;
  longitude: number;
  name: string;
};

type Props = {
  latitude?: number;
  longitude?: number;
  homes?: HomeLike[];
  searchedPins?: PoiLike[];
};

const MAPBOX_PUBLIC_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

function loadMapboxNative() {
  try {
    // Lazy require prevents Expo Go from crashing when native module isn't present.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@rnmapbox/maps");
    return mod?.default ?? mod;
  } catch {
    return null;
  }
}

export function MapboxNativeSpike({ latitude = 25.87, longitude = -80.2, homes = [], searchedPins = [] }: Props) {
  const unsupported = Platform.OS === "web";
  const inExpoGo = Constants.appOwnership === "expo";
  const MapboxGL = loadMapboxNative();

  if (MAPBOX_PUBLIC_TOKEN && MapboxGL?.setAccessToken) {
    try {
      MapboxGL.setAccessToken(MAPBOX_PUBLIC_TOKEN);
    } catch {
      // noop in unsupported runtime paths
    }
  }

  const camera = useMemo(
    () => ({
      centerCoordinate: [longitude, latitude] as [number, number],
      zoomLevel: 11,
    }),
    [latitude, longitude],
  );

  const homesShape = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: homes
        .filter((h) => Number.isFinite(h.latitude) && Number.isFinite(h.longitude))
        .map((h) => ({
          type: "Feature" as const,
          id: h.id,
          geometry: {
            type: "Point" as const,
            coordinates: [h.longitude, h.latitude],
          },
          properties: {
            id: h.id,
            label: h.price,
            claimed: Boolean(h.claimed),
          },
        })),
    }),
    [homes],
  );

  const poiShape = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: searchedPins
        .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
        .map((p) => ({
          type: "Feature" as const,
          id: p.id,
          geometry: {
            type: "Point" as const,
            coordinates: [p.longitude, p.latitude],
          },
          properties: {
            id: p.id,
            term: p.term,
            label: p.name,
            color: p.color,
          },
        })),
    }),
    [searchedPins],
  );

  if (unsupported) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Mapbox spike unavailable on web</Text>
        <Text style={styles.copy}>Native spike runs on iOS/Android only.</Text>
      </View>
    );
  }

  if (inExpoGo || !MapboxGL) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Mapbox spike requires native dev build</Text>
        <Text style={styles.copy}>
          Expo Go cannot load @rnmapbox/maps native module. Use a dev client/EAS build for Mapbox spike.
        </Text>
      </View>
    );
  }

  if (!MAPBOX_PUBLIC_TOKEN) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Mapbox spike blocked (missing token)</Text>
        <Text style={styles.copy}>Set EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN to render native Mapbox spike.</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Mapbox native spike (feature-flag)</Text>
      <Text style={styles.copy}>
        Phase B.3 active: ShapeSource + CircleLayer + SymbolLayer using live homes/POI data.
      </Text>
      <View style={styles.mapFrame}>
        <MapboxGL.MapView style={styles.map} styleURL={MapboxGL.StyleURL.Street}>
          <MapboxGL.Camera
            centerCoordinate={camera.centerCoordinate}
            zoomLevel={camera.zoomLevel}
            animationMode="none"
          />

          <MapboxGL.ShapeSource id="yh-homes-source" shape={homesShape as any}>
            <MapboxGL.CircleLayer
              id="yh-homes-circles"
              style={{
                circleRadius: 5,
                circleColor: ["case", ["get", "claimed"], "#22C55E", "#0B1220"],
                circleStrokeColor: "#E2E8F0",
                circleStrokeWidth: 1,
              }}
            />
            <MapboxGL.SymbolLayer
              id="yh-homes-labels"
              style={{
                textField: ["get", "label"],
                textSize: 10,
                textColor: "#FFFFFF",
                textHaloColor: "#0F172A",
                textHaloWidth: 1,
                textOffset: [0, 1.1],
              }}
            />
          </MapboxGL.ShapeSource>

          <MapboxGL.ShapeSource
            id="yh-poi-source"
            shape={poiShape as any}
            cluster
            clusterRadius={36}
            clusterMaxZoomLevel={12}
          >
            <MapboxGL.CircleLayer
              id="yh-poi-cluster-circles"
              filter={["has", "point_count"] as any}
              style={{
                circleRadius: ["step", ["get", "point_count"], 14, 20, 17, 60, 20] as any,
                circleColor: "#1E293B",
                circleStrokeColor: "#E2E8F0",
                circleStrokeWidth: 1.2,
              }}
            />
            <MapboxGL.SymbolLayer
              id="yh-poi-cluster-count"
              filter={["has", "point_count"] as any}
              style={{
                textField: ["get", "point_count"] as any,
                textSize: 11,
                textColor: "#FFFFFF",
              }}
            />
            <MapboxGL.CircleLayer
              id="yh-poi-circles"
              filter={["!", ["has", "point_count"]] as any}
              style={{
                circleRadius: 4,
                circleColor: ["coalesce", ["get", "color"], "#38BDF8"] as any,
                circleStrokeColor: "#E2E8F0",
                circleStrokeWidth: 0.8,
              }}
            />
          </MapboxGL.ShapeSource>
        </MapboxGL.MapView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 84,
    right: 12,
    left: 12,
    borderRadius: 12,
    padding: 12,
    backgroundColor: "rgba(15,23,42,0.94)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
    zIndex: 1000,
  },
  title: {
    color: "#E2E8F0",
    fontWeight: "700",
    marginBottom: 4,
  },
  copy: {
    color: "#94A3B8",
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 8,
  },
  mapFrame: {
    overflow: "hidden",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.30)",
    height: 180,
  },
  map: {
    flex: 1,
  },
});
