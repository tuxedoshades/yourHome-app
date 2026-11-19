import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useI18n } from "../src/i18n/context";

const API_BASE = Platform.OS === "android" ? "http://10.0.2.2:3000" : "http://localhost:3000";

type Candidate = {
  id: string;
  source: string;
  county: string;
  state: string;
  address: string;
  confidence: number;
  decision: "claimed" | "rejected" | "unsure" | null;
};

export default function PropertyDiscoveryResultsScreen() {
  const { runId } = useLocalSearchParams<{ runId?: string }>();
  const { t } = useI18n();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [status, setStatus] = useState(t("discoveryResults.loading"));

  const loadRun = useCallback(async () => {
    if (!runId) return;
    try {
      const res = await fetch(`${API_BASE}/property-discovery/runs/${encodeURIComponent(runId)}`);
      const data = await res.json();
      if (!res.ok) {
        setStatus(data?.error ? String(data.error) : "run_load_failed");
        return;
      }
      setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      setStatus("");
    } catch {
      setStatus(t("discovery.networkError"));
    }
  }, [runId, t]);

  useEffect(() => {
    void loadRun();
  }, [loadRun]);

  const decide = async (candidateId: string, decision: "claimed" | "rejected" | "unsure") => {
    try {
      const res = await fetch(`${API_BASE}/property-discovery/candidates/${encodeURIComponent(candidateId)}/decision`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) return;
      setCandidates((prev) => prev.map((c) => (c.id === candidateId ? { ...c, decision } : c)));
    } catch {
      // no-op
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t("discoveryResults.title")}</Text>
      <Text style={styles.subtitle}>{t("discoveryResults.subtitle")}</Text>
      {status ? <Text style={styles.status}>{status}</Text> : null}

      {candidates.map((c) => (
        <View key={c.id} style={styles.card}>
          <Text style={styles.address}>{c.address}</Text>
          <Text style={styles.meta}>
            {c.county}, {c.state} • {t("discoveryResults.confidence", { value: Math.round(c.confidence * 100) })} •{" "}
            {c.source}
          </Text>
          <View style={styles.row}>
            <Action
              label={t("discoveryResults.thisIsMine")}
              active={c.decision === "claimed"}
              onPress={() => void decide(c.id, "claimed")}
            />
            <Action
              label={t("discoveryResults.notMine")}
              active={c.decision === "rejected"}
              onPress={() => void decide(c.id, "rejected")}
            />
            <Action
              label={t("discoveryResults.unsure")}
              active={c.decision === "unsure"}
              onPress={() => void decide(c.id, "unsure")}
            />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function Action({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.action, active && styles.actionActive]} onPress={onPress}>
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, backgroundColor: "#050d1a", minHeight: "100%", gap: 10 },
  title: { color: "#FFFFFF", fontSize: 24, fontWeight: "700", textAlign: "center", marginTop: 12 },
  subtitle: { color: "#9CB2D2", fontSize: 13, textAlign: "center", marginBottom: 6 },
  status: { color: "#60A5FA", fontSize: 12, textAlign: "center", marginBottom: 4 },
  card: {
    backgroundColor: "#081424",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(229, 231, 235, 0.2)",
    padding: 14,
    gap: 8,
  },
  address: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  meta: { color: "#9CB2D2", fontSize: 12, lineHeight: 16 },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  action: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(229, 231, 235, 0.2)",
    backgroundColor: "#0A1122",
  },
  actionActive: { borderColor: "#3663E6", backgroundColor: "#1F3D8F" },
  actionText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
});
