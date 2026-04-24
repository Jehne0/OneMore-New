// app/(tabs)/_layout.tsx
import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React, { useEffect } from "react";
import { InteractionManager } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../lib/theme";
import { ensureFastKeys } from "../../lib/storage";
import { useI18n } from "../../lib/i18n";


export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { UI, isDark } = useTheme();

  useEffect(() => {
    // Připrav fast keys na pozadí, aby Historie nebyla nikdy blokovaná.
    const task = InteractionManager.runAfterInteractions(() => {
      void ensureFastKeys();
    });
    return () => task.cancel();
  }, []);

  const tabBg = isDark ? UI.tabBg : UI.accent;
  const tabActive = isDark ? UI.tabActive : UI.bg;
  const tabInactive = isDark ? UI.tabInactive : "rgba(255,255,255,0.78)";
  const { lang } = useI18n();

  return (
    <Tabs
      screenOptions={{
        // Header nechceme – obsah si řídí jednotlivé obrazovky (viz design).
        headerShown: false,
        sceneStyle: { backgroundColor: UI.bg },

        // TAB BAR
        tabBarStyle: {
          backgroundColor: tabBg,
          borderTopWidth: isDark ? 1 : 0,
          borderTopColor: isDark ? UI.tabBorder : "transparent",
          elevation: 0,
          height: 66 + Math.max(insets.bottom, 10),
          paddingTop: 6,
          paddingBottom: Math.max(insets.bottom, 10),
        },
        tabBarActiveTintColor: tabActive,
        tabBarInactiveTintColor: tabInactive,
        tabBarLabelStyle: {
          fontSize: 13,
          fontWeight: "700",
          marginTop: 2,
        },
        tabBarItemStyle: {
          paddingVertical: 6,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarLabel: "OneMore",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "flame" : "flame-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="challenges"
        options={{
          // ✅ Výzvy jsou nyní součástí OneMore (zjednodušení do jedné záložky).
          // Screen necháváme v routeru kvůli interní navigaci (např. plus tlačítko),
          // ale úplně ho skryjeme z tabbaru.
          href: null,
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          tabBarLabel: lang === "en" ? "Profile" : "Profil",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "person" : "person-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
