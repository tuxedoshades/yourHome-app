module.exports = ({ config }) => {
  const expo = {
    ...config,
    plugins: [...(config.plugins ?? [])],
    extra: config.extra
      ? {
          ...config.extra,
          eas: config.extra.eas ? { ...config.extra.eas } : undefined,
        }
      : undefined,
    updates: config.updates ? { ...config.updates } : undefined,
  };

  if (process.env.YOURHOME_EXPO_GO === "1") {
    // Expo Go owns its native runtime and cannot load an app-specific EAS
    // runtime. Keep the EAS settings for native development/production builds.
    delete expo.runtimeVersion;
    delete expo.updates;
    if (expo.extra) {
      delete expo.extra.eas;
      if (Object.keys(expo.extra).length === 0) delete expo.extra;
    }
  }

  return expo;
};
