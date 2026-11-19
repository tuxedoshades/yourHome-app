import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { BrandMark } from "../src/components/BrandMark";
import { useI18n } from "../src/i18n/context";
import { dictionaries } from "../src/i18n/dictionaries";

const STARTUP_PREFIX: Record<string, string> = {
  en: "Where you can check your",
  es: "Donde puedes revisar tu",
  fr: "Où vous pouvez vérifier votre",
  ht: "Kote ou ka verifye",
  pt: "Onde você pode verificar seu",
  ar: "حيث يمكنك التحقق من",
  de: "Wo du dein überprüfen kannst",
  it: "Dove puoi controllare il tuo",
  nl: "Waar je je kunt controleren",
  ru: "Где вы можете проверить свой",
};

export default function StartupScreen() {
  const { language } = useI18n();
  const rotatingWords = useMemo(() => {
    const raw = dictionaries[language]?.["startup.rotatingWords"] ?? dictionaries.en["startup.rotatingWords"];
    return Array.isArray(raw) ? raw : ["Home"];
  }, [language]);
  const startupPrefix = STARTUP_PREFIX[language] ?? STARTUP_PREFIX.en;
  const [currentWord, setCurrentWord] = useState(rotatingWords[0]);

  useEffect(() => {
    setCurrentWord(rotatingWords[0]);
  }, [rotatingWords]);

  useEffect(() => {
    const nav = setTimeout(() => router.replace("/auth"), 4200);

    const wordInterval = setInterval(() => {
      setCurrentWord((prevWord) => {
        const currentIndex = rotatingWords.indexOf(prevWord);
        const nextIndex = (currentIndex + 1) % rotatingWords.length;
        return rotatingWords[nextIndex];
      });
    }, 1200);

    return () => {
      clearTimeout(nav);
      clearInterval(wordInterval);
    };
  }, [rotatingWords]);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <BrandMark color="#FFFFFF" />
      </View>
      <Text style={styles.subtitle}>
        {startupPrefix}
        <Text style={styles.rotatingWord}>{currentWord}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050d1a",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    backgroundColor: "#081424",
    borderRadius: 36,
    padding: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(229, 231, 235, 0.2)",
    width: "55%",
    aspectRatio: 1,
  },
  subtitle: {
    color: "#60A5FA",
    fontSize: 16,
    textAlign: "center",
    marginTop: 24,
  },
  rotatingWord: {
    color: "#FFFFFF",
  },
});
