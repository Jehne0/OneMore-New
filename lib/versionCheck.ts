import Constants from "expo-constants";
import * as Application from "expo-application";
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

export type VersionCheckDecision =
  | { status: "verified"; update?: VersionCheckResult }
  | { status: "updateRequired"; update: VersionCheckResult }
  | { status: "unverified" };

type VersionConfig = {
  // Původní společné hodnoty necháváme jako fallback,
  // aby se nerozbila aktuální Android produkce.
  latestVersionCode?: unknown;
  minimumRequiredVersionCode?: unknown;
  latestVersionName?: unknown;

  // Nové hodnoty zvlášť pro Android.
  latestVersionCodeAndroid?: unknown;
  minimumRequiredVersionCodeAndroid?: unknown;
  latestVersionNameAndroid?: unknown;

  // Nové hodnoty zvlášť pro iOS.
  latestVersionCodeIos?: unknown;
  minimumRequiredVersionCodeIos?: unknown;
  latestVersionNameIos?: unknown;

  updateUrlAndroid?: unknown;
  updateUrlIos?: unknown;
  message?: Partial<Record<Lang, unknown>>;
};

function toPositiveNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getCurrentVersionCode(): number {
  const c = Constants as any;
  const nativeBuildVersion =
    toPositiveNumber(Application.nativeBuildVersion) ||
    toPositiveNumber(c?.nativeBuildVersion);

  if (nativeBuildVersion) return nativeBuildVersion;

  if (Platform.OS === "android") {
    return (
      toPositiveNumber(c?.platform?.android?.versionCode) ||
      toPositiveNumber(c?.expoConfig?.android?.versionCode) ||
      toPositiveNumber(c?.manifest?.android?.versionCode) ||
      toPositiveNumber(c?.manifest2?.extra?.expoClient?.android?.versionCode) ||
      toPositiveNumber(c?.easConfig?.android?.versionCode)
    );
  }

  if (Platform.OS === "ios") {
    return (
      toPositiveNumber(c?.expoConfig?.ios?.buildNumber) ||
      toPositiveNumber(c?.manifest?.ios?.buildNumber) ||
      toPositiveNumber(c?.manifest2?.extra?.expoClient?.ios?.buildNumber)
    );
  }

  return 0;
}

function getPlatformVersionConfig(data: VersionConfig) {
  if (Platform.OS === "ios") {
    return {
      latestVersionCode:
        toPositiveNumber(data.latestVersionCodeIos) ||
        toPositiveNumber(data.latestVersionCode),
      minimumRequiredVersionCode:
        toPositiveNumber(data.minimumRequiredVersionCodeIos) ||
        toPositiveNumber(data.minimumRequiredVersionCode),
      latestVersionName:
        toTrimmedString(data.latestVersionNameIos) ||
        toTrimmedString(data.latestVersionName),
      updateUrl: toTrimmedString(data.updateUrlIos),
    };
  }

  return {
    latestVersionCode:
      toPositiveNumber(data.latestVersionCodeAndroid) ||
      toPositiveNumber(data.latestVersionCode),
    minimumRequiredVersionCode:
      toPositiveNumber(data.minimumRequiredVersionCodeAndroid) ||
      toPositiveNumber(data.minimumRequiredVersionCode),
    latestVersionName:
      toTrimmedString(data.latestVersionNameAndroid) ||
      toTrimmedString(data.latestVersionName),
    updateUrl: toTrimmedString(data.updateUrlAndroid),
  };
}

export async function checkRemoteAppVersion(lang: Lang): Promise<VersionCheckDecision> {
  try {
    const snap = await getDoc(doc(db, "appConfig", "versionCheck"));
    if (!snap.exists()) return { status: "verified" };

    const data = snap.data() as VersionConfig;
    const currentVersionCode = getCurrentVersionCode();
    const {
      latestVersionCode,
      minimumRequiredVersionCode,
      latestVersionName,
      updateUrl,
    } = getPlatformVersionConfig(data);

    if (!currentVersionCode) {
      if (__DEV__) {
        console.log("[versionCheck]", {
          currentVersionCode: null,
          latestVersionCode,
          minimumRequiredVersionCode,
          platform: Platform.OS,
          updateUrl: null,
          updateType: "none",
        });
      }
      return { status: "unverified" };
    }

    const messageValue = data.message?.[lang];
    const message = typeof messageValue === "string" ? messageValue.trim() : undefined;

    if (minimumRequiredVersionCode > currentVersionCode) {
      if (__DEV__) {
        console.log("[versionCheck]", {
          currentVersionCode,
          latestVersionCode,
          minimumRequiredVersionCode,
          platform: Platform.OS,
          updateUrl,
          updateType: "required",
        });
      }
      return {
        status: "updateRequired",
        update: { level: "required", latestVersionName, message, updateUrl },
      };
    }

    if (latestVersionCode > currentVersionCode) {
      if (__DEV__) {
        console.log("[versionCheck]", {
          currentVersionCode,
          latestVersionCode,
          minimumRequiredVersionCode,
          platform: Platform.OS,
          updateUrl,
          updateType: "recommended",
        });
      }
      return {
        status: "verified",
        update: { level: "recommended", latestVersionName, message, updateUrl },
      };
    }

    if (__DEV__) {
      console.log("[versionCheck]", {
        currentVersionCode,
        latestVersionCode,
        minimumRequiredVersionCode,
        platform: Platform.OS,
        updateUrl,
        updateType: "none",
      });
    }

    return { status: "verified" };
  } catch {
    return { status: "unverified" };
  }
}
