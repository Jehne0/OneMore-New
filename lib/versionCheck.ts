import Constants from "expo-constants";
import { Platform } from "react-native";
import { doc, getDoc } from "firebase/firestore";

import { db } from "./firebase";
import type { Lang } from "./i18n";

export type VersionCheckResult = {
  level: "recommended" | "required";
  latestVersionName: string;
  message?: string;
  updateUrl?: string;
};

type VersionConfig = {
  latestVersionCode?: unknown;
  minimumRequiredVersionCode?: unknown;
  latestVersionName?: unknown;
  updateUrlAndroid?: unknown;
  updateUrlIos?: unknown;
  message?: Partial<Record<Lang, unknown>>;
};

function toPositiveNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function versionNameToCode(value: unknown): number {
  if (typeof value !== "string") return 0;
  const parts = value
    .split(".")
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part) && part >= 0);

  if (!parts.length) return 0;

  const [major = 0, minor = 0, patch = 0] = parts;
  return Math.floor(major) * 10000 + Math.floor(minor) * 100 + Math.floor(patch);
}

export function getCurrentVersionCode(): number {
  const c = Constants as any;
  return (
    toPositiveNumber(c?.expoConfig?.android?.versionCode) ||
    toPositiveNumber(c?.nativeBuildVersion) ||
    toPositiveNumber(c?.expoConfig?.ios?.buildNumber) ||
    versionNameToCode(c?.nativeApplicationVersion) ||
    versionNameToCode(c?.expoConfig?.version)
  );
}

export async function checkRemoteAppVersion(lang: Lang): Promise<VersionCheckResult | null> {
  try {
    const snap = await getDoc(doc(db, "appConfig", "versionCheck"));
    if (!snap.exists()) return null;

    const data = snap.data() as VersionConfig;
    const currentVersionCode = getCurrentVersionCode();
    const latestVersionCode = toPositiveNumber(data.latestVersionCode);
    const minimumRequiredVersionCode = toPositiveNumber(data.minimumRequiredVersionCode);

    if (!currentVersionCode) return null;

    const latestVersionName =
      typeof data.latestVersionName === "string" ? data.latestVersionName.trim() : "";
    const messageValue = data.message?.[lang];
    const message = typeof messageValue === "string" ? messageValue.trim() : undefined;
    const updateUrlRaw = Platform.OS === "ios" ? data.updateUrlIos : data.updateUrlAndroid;
    const updateUrl = typeof updateUrlRaw === "string" ? updateUrlRaw.trim() : undefined;

    if (minimumRequiredVersionCode > currentVersionCode) {
      return { level: "required", latestVersionName, message, updateUrl };
    }

    if (latestVersionCode > currentVersionCode) {
      return { level: "recommended", latestVersionName, message, updateUrl };
    }

    return null;
  } catch {
    return null;
  }
}
