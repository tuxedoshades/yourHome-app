import { useEffect, useMemo, useState } from "react";
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { FontAwesome5 } from "@expo/vector-icons";
import Svg, { Path } from "react-native-svg";
import { LEGAL_LINKS } from "../src/legal";
import { BrandMark } from "../src/components/BrandMark";
import { useAuth } from "../src/auth/session";
import { startOAuth, type OAuthPlatform, type OAuthProvider } from "./oauth";
import { LanguagePicker } from "../src/i18n/LanguagePicker";
import { useI18n, useLanguageLabel } from "../src/i18n/context";

function getPlatform(): OAuthPlatform {
  if (Platform.OS === "web") return "web";
  if (Platform.OS === "android") return "android";
  return "ios";
}

function getRedirectUri(platform: OAuthPlatform): string {
  const envWeb = process.env.EXPO_PUBLIC_OAUTH_WEB_REDIRECT_URI;
  const envNative = process.env.EXPO_PUBLIC_OAUTH_NATIVE_REDIRECT_URI;

  if (platform === "web") {
    if (envWeb) return envWeb;
    if (typeof window !== "undefined") return `${window.location.origin}/oauth/callback`;
  }

  if (envNative) return envNative;
  return "yourhome://oauth/callback";
}

export default function AuthDecisionScreen() {
  const { booting, config, isAuthenticated } = useAuth();
  const { t } = useI18n();
  const language = useLanguageLabel();
  const [languagePickerVisible, setLanguagePickerVisible] = useState(false);

  useEffect(() => {
    if (!booting && isAuthenticated) {
      router.replace("/directory");
    }
  }, [booting, isAuthenticated]);

  const authSummary = useMemo(() => {
    const methods = config?.methods;
    return {
      passwordLive: methods?.password?.supported !== false,
      googleLive: methods?.googleOAuth?.supported === true && methods?.googleOAuth?.ready === true,
      appleLive: methods?.appleOAuth?.supported === true && methods?.appleOAuth?.ready === true,
      facebookLive: methods?.facebookOAuth?.supported === true && methods?.facebookOAuth?.ready === true,
    };
  }, [config]);

  const providerButtons = useMemo(
    () => [
      { provider: "google" as const, enabled: true, faded: false },
      { provider: "apple" as const, enabled: authSummary.appleLive, faded: true },
      { provider: "facebook" as const, enabled: authSummary.facebookLive, faded: true },
    ],
    [authSummary.appleLive, authSummary.facebookLive],
  );

  const openLegalLink = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      // no-op for now
    }
  };

  const onOAuthPress = async (provider: OAuthProvider) => {
    try {
      const platform = getPlatform();
      const redirectUri = getRedirectUri(platform);
      const started = await startOAuth({ provider, platform, redirectUri });

      if (!started?.authorizationUrl) {
        throw new Error("OAuth start response missing authorizationUrl");
      }

      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.location.assign(started.authorizationUrl);
        return;
      }

      await Linking.openURL(started.authorizationUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("auth.oauthStartFailed");
      if (Platform.OS === "web") throw new Error(message);
      Alert.alert(t("auth.oauthErrorTitle"), message);
    }
  };

  if (booting) {
    return (
      <View style={styles.container}>
        <View style={styles.logoContainer}>
          <BrandMark color="#FFFFFF" />
        </View>

        <Text style={styles.subtitle}>{t("auth.restoringSession")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.languageRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("auth.languageButtonA11y")}
          style={styles.languageButton}
          onPress={() => setLanguagePickerVisible(true)}
        >
          <Text style={styles.languageFlag}>{language.flag}</Text>
          <Text style={styles.languageCode}>{language.shortLabel}</Text>
          <FontAwesome5 name="chevron-down" size={11} color="#0F172A" />
        </Pressable>
      </View>

      <View style={styles.logoContainer}>
        <BrandMark color="#FFFFFF" />
      </View>

      <Text style={styles.subtitle}>{t("auth.welcome")}</Text>

      <View style={styles.actions}>
        <Button
          text={t("auth.signUp")}
          kind="primary"
          onPress={() => router.push({ pathname: "/signup", params: { mode: "signup" } })}
        />
        <Button
          text={t("auth.login")}
          kind="secondary"
          onPress={() => router.push({ pathname: "/signup", params: { mode: "login" } })}
        />

        <>
          <View style={styles.orWrap}>
            <View style={styles.orLine} />
            <Text style={styles.orText}>{t("auth.orUsing")}</Text>
            <View style={styles.orLine} />
          </View>

          <View style={styles.oauthIconsRow}>
            {providerButtons.map(({ provider, enabled, faded }) => (
              <TouchableOpacity
                key={provider}
                style={[styles.oauthIconButton, faded && styles.oauthIconButtonFaded]}
                onPress={enabled ? () => void onOAuthPress(provider) : undefined}
                activeOpacity={enabled ? 0.85 : 1}
                disabled={!enabled}
              >
                {renderProviderIcon(provider, faded)}
              </TouchableOpacity>
            ))}
          </View>
        </>

        {!authSummary.passwordLive ? <Text style={styles.blockedNote}>{t("auth.passwordAuthDisabled")}</Text> : null}
      </View>

      <Text style={styles.legal}>
        {t("auth.legalPrefix")}
        <Text
          style={styles.legalLink}
          onPress={() => void openLegalLink(LEGAL_LINKS.termsOfUse)}
        >{` ${t("auth.termsOfUse")} `}</Text>
        {t("auth.and")}
        <Text
          style={styles.legalLink}
          onPress={() => void openLegalLink(LEGAL_LINKS.privacyPolicy)}
        >{` ${t("auth.privacyPolicy")}`}</Text>
        .
      </Text>

      <LanguagePicker visible={languagePickerVisible} onClose={() => setLanguagePickerVisible(false)} />
    </View>
  );
}

function Button({ text, onPress, kind }: { text: string; onPress: () => void; kind: "primary" | "secondary" }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.button,
        kind === "primary" && styles.buttonPrimary,
        kind === "secondary" && styles.buttonSecondary,
      ]}
      activeOpacity={0.9}
    >
      <Text
        style={[
          styles.buttonText,
          kind === "primary" && styles.buttonTextPrimary,
          kind === "secondary" && styles.buttonTextSecondary,
        ]}
      >
        {text}
      </Text>
    </TouchableOpacity>
  );
}

function renderProviderIcon(icon: OAuthProvider, disabled = false) {
  const opacity = disabled ? 0.38 : 1;

  if (icon === "google") {
    return (
      <Svg width={29} height={29} viewBox="0 0 18 18" opacity={opacity}>
        <Path
          fill="#4285F4"
          d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.8 2.717v2.258h2.909c1.703-1.567 2.687-3.875 2.687-6.615z"
        />
        <Path
          fill="#34A853"
          d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.909-2.258c-.806.54-1.837.86-3.047.86-2.344 0-4.328-1.583-5.036-3.71H.96v2.332A9 9 0 0 0 9 18z"
        />
        <Path
          fill="#FBBC05"
          d="M3.964 10.712A5.41 5.41 0 0 1 3.682 9c0-.594.102-1.172.282-1.712V4.956H.96A9 9 0 0 0 0 9c0 1.452.348 2.826.96 4.044l3.004-2.332z"
        />
        <Path
          fill="#EA4335"
          d="M9 3.578c1.322 0 2.51.455 3.444 1.347l2.582-2.582C13.463.89 11.426 0 9 0A9 9 0 0 0 .96 4.956l3.004 2.332c.708-2.127 2.692-3.71 5.036-3.71z"
        />
      </Svg>
    );
  }
  if (icon === "apple") {
    return <FontAwesome5 name="apple" size={29} color={disabled ? "rgba(255,255,255,0.42)" : "#FFFFFF"} />;
  }
  return (
    <Svg width={30} height={30} viewBox="0 0 16 16" fill="none" opacity={opacity}>
      <Path
        fill="#1877F2"
        d="M15 8a7 7 0 00-7-7 7 7 0 00-1.094 13.915v-4.892H5.13V8h1.777V6.458c0-1.754 1.045-2.724 2.644-2.724.766 0 1.567.137 1.567.137v1.723h-.883c-.87 0-1.14.54-1.14 1.093V8h1.941l-.31 2.023H9.094v4.892A7.001 7.001 0 0015 8z"
      />
      <Path
        fill="#ffffff"
        d="M10.725 10.023L11.035 8H9.094V6.687c0-.553.27-1.093 1.14-1.093h.883V3.87s-.801-.137-1.567-.137c-1.6 0-2.644.97-2.644 2.724V8H5.13v2.023h1.777v4.892a7.037 7.037 0 002.188 0v-4.892h1.63z"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050d1a",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  languageRow: {
    position: "absolute",
    top: 54,
    right: 24,
    zIndex: 20,
  },
  languageButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#F8FAFC",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.9)",
  },
  languageFlag: { fontSize: 16 },
  languageCode: {
    color: "#0F172A",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: 28,
  },
  subtitle: {
    color: "#FFFFFF",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 20,
  },
  actions: {
    gap: 12,
  },
  button: {
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: "center",
  },
  buttonPrimary: {
    backgroundColor: "#3663E6",
  },
  buttonSecondary: {
    borderWidth: 1,
    borderColor: "rgba(229, 231, 235, 0.25)",
    backgroundColor: "#0A1122",
  },
  orWrap: {
    marginTop: 2,
    marginBottom: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  orLine: {
    flex: 1,
    height: 1,
    backgroundColor: "rgba(229, 231, 235, 0.22)",
  },
  orText: {
    color: "#60A5FA",
    fontSize: 13,
    fontWeight: "600",
  },
  oauthIconsRow: {
    marginTop: 4,
    flexDirection: "row",
    justifyContent: "center",
    gap: 14,
  },
  oauthIconButton: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 0,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  oauthIconButtonFaded: {
    opacity: 0.68,
  },
  blockedNote: {
    color: "#FCA5A5",
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
    marginTop: 4,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "700",
  },
  buttonTextPrimary: {
    color: "#FFFFFF",
  },
  buttonTextSecondary: {
    color: "#FFFFFF",
  },
  legal: {
    color: "#7C8CA8",
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 12,
    paddingHorizontal: 10,
  },
  legalLink: {
    color: "#93C5FD",
    textDecorationLine: "underline",
    fontWeight: "600",
  },
});
