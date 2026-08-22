import { Stack } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import { StatusBar } from "expo-status-bar";
import { AppState, Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ThemeProvider, useTheme } from "../lib/theme";
import { LanguageProvider } from "../lib/i18n";
import { initClock } from "../lib/clock";
import { initCloudSync, stopCloudSync } from "../lib/cloudSync";
import {
  CloudAccessProvider,
  setCloudAccessStatus,
  type CloudAccessStatus,
} from "../lib/cloudAccessGate";
import { AppAlertHost } from "../lib/appAlert";
import { UpdateGate } from "../lib/UpdateGate";
import { WhatsNewPopup } from "../lib/WhatsNewPopup";

const BACKGROUND_START_DELAY_MS = 750;

async function setForegroundNotificationHandler(): Promise<void> {
  const Notifications = await import("expo-notifications");
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

async function startAndroidBackgroundServices(): Promise<void> {
  const [{ startReminderNotificationRecovery }, { initRevenueCatAuth }] = await Promise.all([
    import("../lib/reminders"),
    import("../lib/revenuecat"),
  ]);
  try {
    startReminderNotificationRecovery();
  } catch {}
  try {
    initRevenueCatAuth();
  } catch {}
}

async function refreshAndroidPremium(): Promise<void> {
  const [{ restorePremium }, { syncPremiumFromRevenueCat }] = await Promise.all([
    import("../lib/premium"),
    import("../lib/revenuecat"),
  ]);
  await restorePremium();
  await syncPremiumFromRevenueCat();
}

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
  const { isReady } = useTheme();

  if (!isReady) {
    return <View style={{ flex: 1, backgroundColor: "#0B1220" }} />;
  }

  return <RootStack />;
}

export default function RootLayout() {
  const [cloudAccessStatus, setCloudAccessStatusState] = useState<CloudAccessStatus>("unverified");
  const startCloudSync = useCallback(() => {
    try {
      initCloudSync();
    } catch {}
  }, []);

  const updateCloudAccess = useCallback((status: CloudAccessStatus) => {
    setCloudAccessStatus(status);
    setCloudAccessStatusState(status);
    if (status !== "verified") stopCloudSync();
  }, []);

  useEffect(() => {
    void initClock().catch(() => {});

    // The failed iOS builds aborted from an asynchronous TurboModule call during
    // cold start. Keep optional native services out of the iOS launch path; their
    // feature screens load them on demand. Android retains its existing startup.
    if (Platform.OS === "ios") return;

    const timer = setTimeout(() => {
      void setForegroundNotificationHandler().catch(() => {});
      void startAndroidBackgroundServices().catch(() => {});
    }, BACKGROUND_START_DELAY_MS);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (Platform.OS === "ios") return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void refreshAndroidPremium().catch(() => {});
    });
    return () => subscription.remove();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#000" }}>
      <ThemeProvider>
        <LanguageProvider>
          <CloudAccessProvider status={cloudAccessStatus}>
            <AppAlertHost />
            <WhatsNewPopup />
            <UpdateGate
              onCloudAccessChange={updateCloudAccess}
              onCloudSyncAllowed={startCloudSync}
            />
            <AppShell />
          </CloudAccessProvider>
        </LanguageProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
