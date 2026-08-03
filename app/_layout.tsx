import { Stack } from "expo-router";
import { useEffect } from "react";

import { StatusBar } from "expo-status-bar";
import { AppState, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ThemeProvider, useTheme } from "../lib/theme";
import { LanguageProvider } from "../lib/i18n";
import { initClock } from "../lib/clock";
import { initCloudSync } from "../lib/cloudSync";
import { initRevenueCatAuth, syncPremiumFromRevenueCat } from "../lib/revenuecat";
import { AppAlertHost } from "../lib/appAlert";
import { UpdateGate } from "../lib/UpdateGate";
import { WhatsNewPopup } from "../lib/WhatsNewPopup";
import { restorePremium } from "../lib/premium";
import * as Notifications from "expo-notifications";
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function RootStack() {
  const { UI, isDark } = useTheme();

  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: UI.bg },
          animation: "fade",
        }}
      />
    </>
  );
}

function AppShell() {
  const { isReady, UI } = useTheme();

  if (!isReady) {
    return <View style={{ flex: 1, backgroundColor: "#0B1220" }} />;
  }

  return <RootStack />;
}

export default function RootLayout() {
  useEffect(() => {
    void initClock();

    // ✅ Cloud sync (Firestore)
    try {
      initCloudSync();
    } catch {}

    try {
      initRevenueCatAuth();
    } catch {}

  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void restorePremium().then(() => syncPremiumFromRevenueCat()).catch(() => {});
    });
    return () => subscription.remove();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#000" }}>
      <ThemeProvider>
        <LanguageProvider>
          <AppAlertHost />
          <WhatsNewPopup />
          <UpdateGate />
          <AppShell />
        </LanguageProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
