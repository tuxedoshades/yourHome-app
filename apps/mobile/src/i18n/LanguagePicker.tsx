import { Pressable, StyleSheet, Text, View } from "react-native";
import { getLanguageOption } from "./config";
import { useI18n } from "./context";

export function LanguagePicker({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { language, languageOptions, setLanguage, t } = useI18n();

  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.card}>
        <Text style={styles.title}>{t("auth.languagePickerTitle")}</Text>
        <Text style={styles.subtitle}>{t("auth.languagePickerSubtitle")}</Text>
        <View style={styles.list}>
          {languageOptions.map((option) => {
            const active = option.code === language;
            return (
              <Pressable
                key={option.code}
                style={[styles.option, active && styles.optionActive]}
                onPress={() => {
                  void setLanguage(option.code);
                  onClose();
                }}
              >
                <View style={styles.optionLeft}>
                  <Text style={styles.flag}>{option.flag}</Text>
                  <View>
                    <Text style={styles.optionTitle}>{option.name}</Text>
                    <Text style={styles.optionSubtitle}>{option.nativeName}</Text>
                  </View>
                </View>
                <Text style={[styles.code, active && styles.codeActive]}>
                  {getLanguageOption(option.code).shortLabel}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable style={styles.cancelButton} onPress={onClose}>
          <Text style={styles.cancelText}>{t("common.cancel")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2, 6, 23, 0.72)",
    justifyContent: "center",
    paddingHorizontal: 22,
    zIndex: 40,
  },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(229,231,235,0.24)",
    backgroundColor: "#081424",
    padding: 18,
    gap: 12,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
  },
  subtitle: {
    color: "#9CB2D2",
    fontSize: 13,
    lineHeight: 18,
  },
  list: {
    gap: 8,
  },
  option: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(229,231,235,0.14)",
    backgroundColor: "#0A1122",
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  optionActive: {
    borderColor: "rgba(96,165,250,0.7)",
    backgroundColor: "rgba(54,99,230,0.16)",
  },
  optionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  flag: {
    fontSize: 22,
  },
  optionTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
  optionSubtitle: {
    color: "#9CB2D2",
    fontSize: 12,
    marginTop: 2,
  },
  code: {
    color: "#D6E4FF",
    fontSize: 13,
    fontWeight: "800",
  },
  codeActive: {
    color: "#93C5FD",
  },
  cancelButton: {
    alignSelf: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cancelText: {
    color: "#93C5FD",
    fontSize: 14,
    fontWeight: "700",
  },
});
