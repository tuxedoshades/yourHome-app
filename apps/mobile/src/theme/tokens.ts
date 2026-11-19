export const uiTokens = {
  color: {
    textPrimary: "#FFFFFF",
    textMuted: "#94A3B8",
    surfaceDark: "#111827",
    surfaceDarkSoft: "#0F172A",
    accentCyan: "#22D3EE",
    accentPurple: "#A78BFA",
    accentOrange: "#F97316",
    accentRose: "#F43F5E",
    accentSky: "#38BDF8",
    accentYellow: "#FACC15",
  },
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
  },
} as const;

export const poiPalette = [
  uiTokens.color.accentCyan,
  uiTokens.color.accentPurple,
  uiTokens.color.accentOrange,
  uiTokens.color.accentRose,
  uiTokens.color.accentSky,
  uiTokens.color.accentYellow,
] as const;
