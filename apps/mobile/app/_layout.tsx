import { Slot } from "expo-router";
import { AuthProvider } from "../src/auth/session";
import { I18nProvider } from "../src/i18n/context";

export default function RootLayout() {
  return (
    <AuthProvider>
      <I18nProvider>
        <Slot />
      </I18nProvider>
    </AuthProvider>
  );
}
