import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { BrandMark } from "../src/components/BrandMark";
import { API_BASE, useAuth } from "../src/auth/session";
import { useI18n } from "../src/i18n/context";

type StartPayload = {
  ok?: boolean;
  channel?: string;
  alreadyVerified?: boolean;
  expiresAt?: string | null;
  delivery?: { mode?: string; filePath?: string };
  error?: string;
  message?: string;
};

type ConfirmPayload = {
  verified?: boolean;
  alreadyVerified?: boolean;
  user?: { emailVerifiedAt?: string | null };
  error?: string;
  message?: string;
};

async function parseJson<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

function payloadMessage(payload: { error?: string; message?: string } | null, fallback: string) {
  if (!payload) return fallback;
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.error === "string") return payload.error.replaceAll("_", " ");
  return fallback;
}

export default function VerifyCodeScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const { isAuthenticated, user, restoreSession, config } = useAuth();
  const { t } = useI18n();
  const email = useMemo(
    () =>
      typeof params.email === "string"
        ? decodeURIComponent(params.email).trim().toLowerCase()
        : (user?.email?.toLowerCase() ?? ""),
    [params.email, user?.email],
  );
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [deliveryHint, setDeliveryHint] = useState("");
  const autoSentEmailRef = useRef<string | null>(null);

  const emailOtpStatus = config?.methods?.emailOtpVerification?.status ?? "unknown";

  const sendCode = useCallback(async () => {
    if (!email) {
      setError(t("verify.missingEmail"));
      return;
    }

    setError("");
    setMessage("");
    setResending(true);
    try {
      const res = await fetch(`${API_BASE}/verification/email/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = await parseJson<StartPayload>(res);
      if (!res.ok) throw new Error(payloadMessage(payload, t("verify.couldNotSend")));

      if (payload?.alreadyVerified) {
        setMessage(t("verify.alreadyVerified"));
      } else {
        setMessage(t("verify.codeSent"));
      }

      if (payload?.delivery?.mode === "local_outbox") {
        setDeliveryHint(
          payload.delivery.filePath
            ? t("verify.devDeliveryPath", { path: payload.delivery.filePath })
            : t("verify.devDelivery"),
        );
      } else {
        setDeliveryHint(t("verify.checkInbox"));
      }
    } catch (err: any) {
      setError(String(err?.message ?? t("verify.couldNotSend")));
    } finally {
      setResending(false);
    }
  }, [email, t]);

  useEffect(() => {
    if (autoSentEmailRef.current === email) return;
    autoSentEmailRef.current = email;
    void sendCode();
  }, [email, sendCode]);

  const submit = async () => {
    if (!email) {
      setError(t("verify.missingEmail"));
      return;
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setError(t("verify.enterCode"));
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(`${API_BASE}/verification/email/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, code: code.trim() }),
      });
      const payload = await parseJson<ConfirmPayload>(res);
      if (!res.ok || !payload?.verified) throw new Error(payloadMessage(payload, t("verify.verificationFailed")));
      await restoreSession();
      setMessage(t("verify.verifiedYoureIn"));
      router.replace(isAuthenticated ? "/directory" : "/signup?mode=login");
    } catch (err: any) {
      setError(String(err?.message ?? t("verify.verificationFailed")));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.logoWrap}>
        <BrandMark color="#FFFFFF" />
      </View>

      <View style={styles.contentBlock}>
        <Text style={styles.titleOutside}>{t("verify.checkYourEmail")}</Text>

        <View style={styles.panel}>
          <Text style={styles.subtitle}>{t("verify.sentCodeTo", { email: email || "your email" })}</Text>
          <Text style={styles.body}>{t("verify.flowLive")}</Text>
          <Text style={styles.note}>{t("verify.authConfigStatus", { status: emailOtpStatus })}</Text>
          {deliveryHint ? <Text style={styles.note}>{deliveryHint}</Text> : null}
          {message ? <Text style={styles.success}>{message}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TextInput
            value={code}
            onChangeText={(value) => setCode(value.replace(/[^0-9]/g, "").slice(0, 6))}
            placeholder={t("verify.codePlaceholder")}
            placeholderTextColor="#8AA0C2"
            keyboardType="number-pad"
            style={styles.input}
            autoFocus
            maxLength={6}
          />

          <Pressable
            style={[styles.primaryBtn, loading && styles.buttonDisabled]}
            onPress={() => void submit()}
            disabled={loading}
          >
            <Text style={styles.primaryBtnText}>{loading ? t("verify.verifying") : t("verify.verifyEmail")}</Text>
          </Pressable>

          <Pressable
            style={[styles.secondaryBtn, resending && styles.buttonDisabled]}
            onPress={() => void sendCode()}
            disabled={resending}
          >
            <Text style={styles.secondaryBtnText}>{resending ? t("verify.sending") : t("verify.resendCode")}</Text>
          </Pressable>

          <Pressable
            style={styles.tertiaryBtn}
            onPress={() => router.replace(isAuthenticated ? "/directory" : "/signup?mode=login")}
          >
            <Text style={styles.tertiaryBtnText}>
              {isAuthenticated ? t("verify.continueApp") : t("verify.goToEmailSignIn")}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050d1a", justifyContent: "center", paddingHorizontal: 24 },
  logoWrap: { position: "absolute", top: 49, left: 0, right: 0, alignItems: "center" },
  contentBlock: { marginTop: 45 },
  panel: {
    backgroundColor: "#081424",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(229, 231, 235, 0.2)",
    padding: 20,
    gap: 12,
  },
  titleOutside: {
    color: "#FFFFFF",
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "500",
    textAlign: "center",
    marginBottom: 10,
  },
  subtitle: { color: "#60A5FA", fontSize: 16, textAlign: "center", lineHeight: 22 },
  body: { color: "#D6E4FF", fontSize: 14, lineHeight: 20, textAlign: "center" },
  note: { color: "#9CB2D2", fontSize: 13, lineHeight: 19, textAlign: "center" },
  success: { color: "#86EFAC", fontSize: 14, lineHeight: 20, textAlign: "center" },
  error: { color: "#FCA5A5", fontSize: 14, lineHeight: 20, textAlign: "center" },
  input: {
    backgroundColor: "#0A1122",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(229,231,235,0.25)",
    color: "#FFFFFF",
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 6,
    textAlign: "center",
  },
  primaryBtn: { backgroundColor: "#3663E6", borderRadius: 14, paddingVertical: 13, alignItems: "center" },
  primaryBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  secondaryBtn: {
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(96,165,250,0.4)",
    backgroundColor: "#0A1122",
  },
  secondaryBtnText: { color: "#BFDBFE", fontSize: 15, fontWeight: "700" },
  tertiaryBtn: { paddingVertical: 6, alignItems: "center" },
  tertiaryBtnText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
  buttonDisabled: { opacity: 0.6 },
});
