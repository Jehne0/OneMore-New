import { Stack } from "expo-router";
import { useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";

import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ThemeProvider, useTheme } from "../lib/theme";
import { LanguageProvider } from "../lib/i18n";
import { initClock } from "../lib/clock";
import { initCloudSync } from "../lib/cloudSync";
import { AppAlertHost } from "../lib/appAlert";

// ✅ NOVÉ — RevenueCat init
import { configureRevenueCat } from "../lib/revenuecat";

const REMEMBER_ME_KEY = "onemore_remember_me";

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
    initCloudSync();

    // ✅ RevenueCat init (Android platby)
    void configureRevenueCat();

    (async () => {
      try {
        const remember = await AsyncStorage.getItem(REMEMBER_ME_KEY);
        if (remember === "0") {
          await signOut(auth);
        }
      } catch {}
    })();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#000" }}>
      <ThemeProvider>
        <LanguageProvider>
          <AppAlertHost />
          <AppShell />
        </LanguageProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
