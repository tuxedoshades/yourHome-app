import { StyleSheet, Text, View } from "react-native";

type BrandMarkProps = {
  compact?: boolean;
  color?: string;
};

export function BrandMark({ compact = false, color = "#FFFFFF" }: BrandMarkProps) {
  return (
    <View style={styles.wrap}>
      <View style={[styles.roof, compact && styles.roofCompact]}>
        <View style={[styles.roofLeft, { backgroundColor: color }, compact && styles.roofLeftCompact]} />
        <View style={[styles.roofRight, { backgroundColor: color }, compact && styles.roofRightCompact]} />
      </View>
      <Text style={[styles.wordmark, { color }, compact && styles.wordmarkCompact]}>yourHome</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
  },
  roof: {
    width: 140,
    height: 40,
    marginBottom: 11,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  roofCompact: {
    width: 118,
    height: 34,
    marginBottom: 9,
  },
  roofLeft: {
    width: 80,
    height: 3,
    transform: [{ rotate: "-32deg" }],
    position: "absolute",
    left: -3,
    top: 24,
    borderRadius: 3,
  },
  roofRight: {
    width: 80,
    height: 3,
    transform: [{ rotate: "32deg" }],
    position: "absolute",
    right: -3,
    top: 24,
    borderRadius: 3,
  },
  roofLeftCompact: {
    width: 68,
    top: 20,
    left: -2,
  },
  roofRightCompact: {
    width: 68,
    top: 20,
    right: -2,
  },
  wordmark: {
    fontSize: 28,
    fontWeight: "bold",
    letterSpacing: 0.1,
  },
  wordmarkCompact: {
    fontSize: 24,
  },
});
