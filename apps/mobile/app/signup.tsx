import Constants from "expo-constants";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesome5 } from "@expo/vector-icons";
import {
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { LEGAL_LINKS } from "../src/legal";
import { BrandMark } from "../src/components/BrandMark";
import { useAuth } from "../src/auth/session";
import { useI18n } from "../src/i18n/context";

type Mode = "signup" | "login";
type ContactStatus = "idle" | "checking" | "invalid" | "taken" | "available";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getApiBaseUrl() {
  const envBase =
    (Platform.OS === "android" ? process.env.EXPO_PUBLIC_API_BASE_URL_ANDROID : undefined) ??
    (Platform.OS === "ios" ? process.env.EXPO_PUBLIC_API_BASE_URL_IOS : undefined) ??
    process.env.EXPO_PUBLIC_API_BASE_URL;

  if (envBase) return envBase.replace(/\/$/, "");

  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as any)?.manifest?.debuggerHost ??
    (Constants as any)?.manifest2?.extra?.expoGo?.developer?.tool ??
    "";

  const host = String(hostUri)
    .replace(/^[a-zA-Z]+:\/\//, "")
    .split("/")[0]
    .split(":")[0]
    .trim();
  if (host) return `http://${host}:3000`;

  return Platform.OS === "android" ? "http://10.0.2.2:3000" : "http://127.0.0.1:3000";
}

const API_BASE = getApiBaseUrl();

export default function SignupScreen() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const initialMode: Mode = params.mode === "login" ? "login" : "signup";
  const { login, register } = useAuth();
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [contactStatus, setContactStatus] = useState<ContactStatus>("idle");
  const [contactMessage, setContactMessage] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const contactCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastNameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const normalizeNameInput = (value: string) => value.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    setFormError("");
    setContactStatus("idle");
    setContactMessage("");
    if (mode === "login") {
      setAccepted(false);
      setConfirmPassword("");
    }
  }, [mode]);

  const passwordChecks = {
    minLen: password.length >= 10,
    hasUpper: /[A-Z]/.test(password),
    hasLower: /[a-z]/.test(password),
    hasNumber: /\d/.test(password),
    hasSpecial: /[^A-Za-z0-9]/.test(password),
  };
  const isPasswordStrong = Object.values(passwordChecks).every(Boolean);
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const showPasswordMismatch = mode === "signup" && confirmPassword.length > 0 && password !== confirmPassword;

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (!EMAIL_REGEX.test(email.trim().toLowerCase())) return false;
    if (mode === "login") return password.length > 0;
    return Boolean(
      firstName.trim() &&
      lastName.trim() &&
      contactStatus !== "invalid" &&
      contactStatus !== "taken" &&
      isPasswordStrong &&
      passwordsMatch &&
      accepted,
    );
  }, [
    accepted,
    contactStatus,
    email,
    firstName,
    isPasswordStrong,
    lastName,
    mode,
    password.length,
    passwordsMatch,
    submitting,
  ]);

  const validateEmailAvailability = async (rawValue: string) => {
    const value = rawValue.trim().toLowerCase();
    if (!EMAIL_REGEX.test(value)) {
      setContactStatus("invalid");
      setContactMessage(t("signup.enterValidEmail"));
      return;
    }

    setContactStatus("checking");
    setContactMessage(t("signup.checkingEmail"));

    try {
      const res = await fetch(`${API_BASE}/auth/email-check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: value }),
      });
      const data = await res.json();

      if (!res.ok) {
        setContactStatus("idle");
        setContactMessage(t("signup.emailCheckUnavailable"));
        return;
      }

      if (data?.available === true) {
        setContactStatus("available");
        setContactMessage(t("signup.emailAvailable"));
      } else if (data?.available === false) {
        setContactStatus("taken");
        setContactMessage(t("signup.emailInUse"));
      } else {
        setContactStatus("idle");
        setContactMessage(t("signup.emailCheckUnavailable"));
      }
    } catch {
      setContactStatus("idle");
      setContactMessage(t("signup.emailCheckUnavailable"));
    }
  };

  const openLegalLink = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      // no-op
    }
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    setFormError("");

    if (contactCheckTimer.current) clearTimeout(contactCheckTimer.current);

    const trimmed = value.trim().toLowerCase();
    if (mode === "login") {
      setContactStatus("idle");
      setContactMessage("");
      return;
    }

    if (!trimmed) {
      setContactStatus("idle");
      setContactMessage("");
      return;
    }

    if (!emailRegex.test(trimmed)) {
      setContactStatus("invalid");
      setContactMessage(trimmed.includes("@") ? t("signup.finishTypingEmail") : t("signup.useEmailAddress"));
      return;
    }

    setContactStatus("checking");
    setContactMessage(t("signup.checkingEmail"));
    contactCheckTimer.current = setTimeout(() => {
      void validateEmailAvailability(trimmed);
    }, 350);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setFormError("");

    try {
      const normalizedEmail = email.trim().toLowerCase();

      if (mode === "login") {
        await login({ email: normalizedEmail, password });
        router.replace("/directory");
      } else {
        await register({ email: normalizedEmail, password });
        router.replace({ pathname: "/verify-code", params: { email: normalizedEmail } });
      }
    } catch (error: any) {
      setFormError(String(error?.message ?? t("signup.authFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Pressable style={styles.container} onPress={Keyboard.dismiss}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.logoWrap}>
            <BrandMark color="#FFFFFF" />
          </View>

          <View style={styles.contentBlock}>
            <View style={styles.form}>
              {mode === "signup" ? (
                <View style={styles.nameRow}>
                  <TextInput
                    value={firstName}
                    onChangeText={(value) => setFirstName(normalizeNameInput(value))}
                    placeholder={t("signup.firstName")}
                    placeholderTextColor="#FFFFFF"
                    style={[styles.input, styles.nameInput]}
                    autoCapitalize="words"
                    blurOnSubmit={false}
                    returnKeyType="next"
                    onSubmitEditing={() => lastNameRef.current?.focus()}
                  />
                  <TextInput
                    ref={lastNameRef}
                    value={lastName}
                    onChangeText={(value) => setLastName(normalizeNameInput(value))}
                    placeholder={t("signup.lastName")}
                    placeholderTextColor="#FFFFFF"
                    style={[styles.input, styles.nameInput]}
                    autoCapitalize="words"
                    blurOnSubmit={false}
                    returnKeyType="next"
                    onSubmitEditing={() => emailRef.current?.focus()}
                  />
                </View>
              ) : null}

              <TextInput
                ref={emailRef}
                value={email}
                onChangeText={handleEmailChange}
                placeholder={t("signup.email")}
                placeholderTextColor="#FFFFFF"
                style={[
                  styles.input,
                  (contactStatus === "invalid" || contactStatus === "taken") && mode === "signup" && styles.inputError,
                  contactStatus === "available" && mode === "signup" && styles.inputSuccess,
                ]}
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
              {mode === "signup" && contactMessage ? (
                <Text
                  style={[
                    styles.inputMessage,
                    (contactStatus === "invalid" || contactStatus === "taken") && styles.inputMessageError,
                    contactStatus === "available" && styles.inputMessageSuccess,
                  ]}
                >
                  {contactMessage}
                </Text>
              ) : null}

              <View style={styles.inputWithAction}>
                <TextInput
                  ref={passwordRef}
                  value={password}
                  onChangeText={(value) => {
                    setPassword(value);
                    setFormError("");
                  }}
                  placeholder={t("signup.password")}
                  placeholderTextColor="#FFFFFF"
                  style={[
                    styles.input,
                    styles.inputWithActionField,
                    mode === "signup" && password.length > 0 && !isPasswordStrong && styles.inputError,
                  ]}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  textContentType="password"
                  returnKeyType={mode === "signup" ? "next" : "done"}
                  onSubmitEditing={() => (mode === "signup" ? confirmRef.current?.focus() : handleSubmit())}
                />
                <Pressable style={styles.eyeBtn} onPress={() => setShowPassword((v) => !v)}>
                  <FontAwesome5 name={showPassword ? "eye-slash" : "eye"} size={16} color="#93C5FD" />
                </Pressable>
              </View>

              {mode === "signup" && password.length > 0 ? (
                <View style={styles.rulesWrap}>
                  <Rule ok={passwordChecks.minLen} text={t("signup.passwordRuleMin")} />
                  <Rule ok={passwordChecks.hasUpper} text={t("signup.passwordRuleUpper")} />
                  <Rule ok={passwordChecks.hasLower} text={t("signup.passwordRuleLower")} />
                  <Rule ok={passwordChecks.hasNumber} text={t("signup.passwordRuleNumber")} />
                  <Rule ok={passwordChecks.hasSpecial} text={t("signup.passwordRuleSpecial")} />
                </View>
              ) : null}

              {mode === "signup" ? (
                <>
                  <View style={styles.inputWithAction}>
                    <TextInput
                      ref={confirmRef}
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      placeholder={t("signup.confirmPassword")}
                      placeholderTextColor="#FFFFFF"
                      style={[
                        styles.input,
                        styles.inputWithActionField,
                        showPasswordMismatch && styles.inputError,
                        passwordsMatch && styles.inputSuccess,
                      ]}
                      secureTextEntry={!showConfirmPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      spellCheck={false}
                      textContentType="password"
                      returnKeyType="done"
                      onSubmitEditing={handleSubmit}
                    />
                    <Pressable style={styles.eyeBtn} onPress={() => setShowConfirmPassword((v) => !v)}>
                      <FontAwesome5 name={showConfirmPassword ? "eye-slash" : "eye"} size={16} color="#93C5FD" />
                    </Pressable>
                  </View>
                  {showPasswordMismatch ? (
                    <Text style={[styles.inputMessage, styles.inputMessageError]}>
                      {t("signup.passwordsDontMatch")}
                    </Text>
                  ) : null}

                  <Pressable style={styles.checkboxRow} onPress={() => setAccepted((v) => !v)}>
                    <View style={[styles.checkbox, accepted && styles.checkboxOn]}>
                      {accepted ? <Text style={styles.check}>✓</Text> : null}
                    </View>
                    <Text style={styles.checkboxText}>
                      {t("signup.agreePrefix")}
                      <Text
                        style={styles.checkboxLink}
                        onPress={() => void openLegalLink(LEGAL_LINKS.termsOfUse)}
                      >{` ${t("auth.termsOfUse")} `}</Text>
                      {t("auth.and")}
                      <Text
                        style={styles.checkboxLink}
                        onPress={() => void openLegalLink(LEGAL_LINKS.privacyPolicy)}
                      >{` ${t("auth.privacyPolicy")}`}</Text>
                    </Text>
                  </Pressable>
                </>
              ) : null}

              {formError ? <Text style={[styles.inputMessage, styles.inputMessageError]}>{formError}</Text> : null}

              <Pressable
                style={[styles.primaryBtn, !canSubmit && styles.primaryBtnDisabled]}
                disabled={!canSubmit}
                onPress={handleSubmit}
              >
                <Text style={styles.primaryBtnText}>
                  {submitting
                    ? mode === "signup"
                      ? t("signup.creating")
                      : t("signup.signingIn")
                    : mode === "signup"
                      ? t("signup.createAccountButton")
                      : t("signup.loginButton")}
                </Text>
              </Pressable>
            </View>
          </View>

          {mode === "login" ? (
            <Pressable style={styles.switchLink} onPress={() => setMode("signup")}>
              <Text style={styles.switchLinkText}>{t("signup.needAccount")}</Text>
            </Pressable>
          ) : null}

          <Pressable style={styles.secondaryLink} onPress={() => router.back()}>
            <Text style={styles.secondaryLinkText}>{t("common.back")}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Pressable>
  );
}

function Rule({ ok, text }: { ok: boolean; text: string }) {
  return (
    <Text style={[styles.ruleText, ok ? styles.ruleOk : styles.rulePending]}>
      {ok ? "✓" : "•"} {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: "#050d1a" },
  scrollContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, paddingTop: 40, paddingBottom: 28 },
  logoWrap: { alignItems: "center", marginBottom: 28 },
  contentBlock: { marginTop: 8, width: "100%", maxWidth: 440, alignSelf: "center" },
  form: { gap: 10 },
  nameRow: { flexDirection: "row", gap: 10 },
  nameInput: { flex: 1 },
  input: {
    backgroundColor: "#0A1122",
    borderWidth: 1,
    borderColor: "rgba(229, 231, 235, 0.25)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: "#FFFFFF",
    fontSize: 15,
  },
  inputWithAction: { position: "relative" },
  inputWithActionField: { paddingRight: 44 },
  eyeBtn: {
    position: "absolute",
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    width: 24,
  },
  inputError: { borderColor: "#EF4444" },
  inputSuccess: { borderColor: "#22C55E" },
  inputMessage: { marginTop: -4, marginBottom: 2, fontSize: 13, color: "#93C5FD" },
  inputMessageError: { color: "#EF4444" },
  inputMessageSuccess: { color: "#22C55E" },
  rulesWrap: { marginTop: -4, marginBottom: 2, gap: 2 },
  ruleText: { fontSize: 12, lineHeight: 16 },
  ruleOk: { color: "#22C55E" },
  rulePending: { color: "#94A3B8" },
  checkboxRow: { marginTop: 2, flexDirection: "row", gap: 10, alignItems: "center" },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(229, 231, 235, 0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: "#3663E6", borderColor: "#3663E6" },
  check: { color: "#FFFFFF", fontSize: 12, fontWeight: "700", marginTop: -1 },
  checkboxText: { flex: 1, color: "#9CB2D2", fontSize: 12, lineHeight: 16 },
  checkboxLink: { color: "#93C5FD", textDecorationLine: "underline", fontWeight: "600" },
  primaryBtn: { marginTop: 6, backgroundColor: "#3663E6", borderRadius: 18, paddingVertical: 15, alignItems: "center" },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  switchLink: { marginTop: 14, alignItems: "center" },
  switchLinkText: { color: "#60A5FA", fontSize: 15, fontWeight: "500" },
  secondaryLink: { marginTop: 12, alignItems: "center" },
  secondaryLinkText: { color: "#60A5FA", fontSize: 15, fontWeight: "500" },
});
