import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

export type ThemeMode = "light" | "dark";

const THEME_KEY = "onemore_theme_mode";

export const LIGHT = {
  bg: "#FFFFFF",
  text: "#0B1220",
  accent: "#FFB266",
  accentSoft: "rgba(255,178,102,0.22)",
  sub: "rgba(11,18,32,0.65)",
  card: "#FBFBFB",
  card2: "#F6F6F6",
  stroke: "#EAEAEA",
  goodBg: "#E7F7EA",
  goodStroke: "#BFE8C8",
  sheetBg: "#FFFFFF",
  sheetStroke: "#E6E6E6",
  btnBg: "#FFFFFF",
  btnStroke: "#111111",
  backdrop: "rgba(0,0,0,0.35)",
  rowDivider: "#F0F0F0",
  tabBg: "#FFFFFF",
  tabBorder: "#EAEAEA",
  tabActive: "#111111",
  tabInactive: "rgba(11,18,32,0.55)",
};

export const DARK = {
  bg: "#0B1220",
  text: "#EAF0FF",
  sub: "rgba(234,240,255,0.72)",
  accent: "#FF9A3D",
  accentSoft: "rgba(255,154,61,0.18)",
  card: "rgba(255,255,255,0.08)",
  card2: "rgba(255,255,255,0.10)",
  stroke: "rgba(255,255,255,0.12)",
  goodBg: "rgba(71, 212, 126, 0.18)",
  goodStroke: "rgba(71, 212, 126, 0.30)",
  sheetBg: "#0F172A",
  sheetStroke: "rgba(255,255,255,0.12)",
  btnBg: "rgba(255,255,255,0.06)",
  btnStroke: "rgba(255,255,255,0.18)",
  backdrop: "rgba(0,0,0,0.55)",
  rowDivider: "rgba(255,255,255,0.10)",
  tabBg: "#0B1220",
  tabBorder: "rgba(255,255,255,0.12)",
  tabActive: "#EAF0FF",
  tabInactive: "rgba(234,240,255,0.55)",
};

type ThemeContextValue = {
  mode: ThemeMode;
  isDark: boolean;
  UI: typeof LIGHT;
  setMode: (m: ThemeMode) => Promise<void>;
  toggle: () => Promise<void>;
  isReady: boolean;
};

const ThemeCtx = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("dark");
  const [isReady, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(THEME_KEY);
        if (saved === "dark" || saved === "light") setModeState(saved);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const isDark = mode === "dark";
  const UI = useMemo(() => (isDark ? DARK : LIGHT), [isDark]);

  const setMode = async (m: ThemeMode) => {
    setModeState(m);
    await AsyncStorage.setItem(THEME_KEY, m);
  };

  const toggle = async () => setMode(isDark ? "light" : "dark");

  const value = useMemo(
    () => ({ mode, isDark, UI, setMode, toggle, isReady }),
    [mode, isDark, UI, isReady]
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
