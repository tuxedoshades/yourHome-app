import { router } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useI18n } from "../src/i18n/context";

const API_BASE = Platform.OS === "android" ? "http://10.0.2.2:3000" : "http://localhost:3000";

export default function PropertyDiscoveryScreen() {
  const { t } = useI18n();
  const [fullName, setFullName] = useState("");
  const [currentAddress, setCurrentAddress] = useState("");
  const [priorAddress, setPriorAddress] = useState("");
  const [emailOrPhone, setEmailOrPhone] = useState("");
  const [birthMonthYear, setBirthMonthYear] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const runDiscovery = async () => {
    if (!consent || !fullName.trim()) return;
    setBusy(true);
    setStatus("");
    try {
      const res = await fetch(`${API_BASE}/property-discovery/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim(),
          currentAddress: currentAddress.trim(),
          priorAddress: priorAddress.trim(),
          emailOrPhone: emailOrPhone.trim(),
          birthMonthYear: birthMonthYear.trim(),
          consent: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.runId) {
        setStatus(data?.error ? String(data.error) : t("discovery.startFailed"));
      } else {
        router.push(`/property-discovery-results?runId=${encodeURIComponent(String(data.runId))}`);
      }
    } catch {
      setStatus(t("discovery.networkError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.panel}>
        <Text style={styles.title}>{t("discovery.title")}</Text>
        <Text style={styles.subtitle}>{t("discovery.subtitle")}</Text>

        <View style={styles.form}>
          <TextInput
            value={fullName}
            onChangeText={setFullName}
            placeholder={t("discovery.fullLegalName")}
            placeholderTextColor="#FFFFFF"
            style={styles.input}
          />
          <TextInput
            value={currentAddress}
            onChangeText={setCurrentAddress}
            placeholder={t("discovery.currentAddress")}
            placeholderTextColor="#FFFFFF"
            style={styles.input}
          />
          <TextInput
            value={priorAddress}
            onChangeText={setPriorAddress}
            placeholder={t("discovery.priorAddress")}
            placeholderTextColor="#FFFFFF"
            style={styles.input}
          />
          <TextInput
            value={emailOrPhone}
            onChangeText={setEmailOrPhone}
            placeholder={t("discovery.emailOrPhone")}
            placeholderTextColor="#FFFFFF"
            style={styles.input}
          />
          <TextInput
            value={birthMonthYear}
            onChangeText={setBirthMonthYear}
            placeholder={t("discovery.birthMonthYear")}
            placeholderTextColor="#FFFFFF"
            style={styles.input}
          />

          <Pressable style={styles.checkboxRow} onPress={() => setConsent((v) => !v)}>
            <View style={[styles.checkbox, consent && styles.checkboxOn]}>
              {consent ? <Text style={styles.check}>✓</Text> : null}
            </View>
            <Text style={styles.checkboxText}>{t("discovery.consent")}</Text>
          </Pressable>

          <Pressable
            style={[styles.primaryBtn, (!consent || busy) && styles.primaryBtnDisabled]}
            disabled={!consent || busy}
            onPress={runDiscovery}
          >
            <Text style={styles.primaryBtnText}>{busy ? t("discovery.running") : t("discovery.run")}</Text>
          </Pressable>
          {status ? <Text style={styles.status}>{status}</Text> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050d1a", justifyContent: "center", paddingHorizontal: 24 },
  panel: {
    backgroundColor: "#081424",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(229, 231, 235, 0.2)",
    padding: 20,
  },
  title: { color: "#FFFFFF", fontSize: 24, lineHeight: 30, fontWeight: "700", textAlign: "center", marginBottom: 8 },
  subtitle: { color: "#FFFFFF", fontSize: 13, lineHeight: 19, textAlign: "center", marginBottom: 14 },
  form: { gap: 10 },
  input: {
    backgroundColor: "#0A1122",
    borderWidth: 1,
    borderColor: "rgba(229, 231, 235, 0.25)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: "#FFFFFF",
    fontSize: 14,
  },
  checkboxRow: { marginTop: 4, flexDirection: "row", gap: 10, alignItems: "center" },
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
  primaryBtn: { marginTop: 6, backgroundColor: "#3663E6", borderRadius: 18, paddingVertical: 15, alignItems: "center" },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  status: { marginTop: 4, color: "#60A5FA", fontSize: 12, textAlign: "center" },
});
