export const MAP_ENGINE = (process.env.EXPO_PUBLIC_MAP_ENGINE ?? "rn-maps").trim().toLowerCase();

export const isMapboxEngineEnabled = MAP_ENGINE === "mapbox";
