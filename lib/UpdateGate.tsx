import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useI18n } from "./i18n";
import { useTheme } from "./theme";
import { checkRemoteAppVersion, type VersionCheckDecision, type VersionCheckResult } from "./versionCheck";
import { getSafeModalMetrics } from "./safeModalLayout";
import { createVersionGateController, type VersionGateController } from "./updateStartupPolicy";
import type { CloudAccessStatus } from "./cloudAccessGate";
import { Alert } from "./appAlert";

const UNVERIFIED_RETRY_MS = 15_000;

function getUpdateOpenError(lang: string): string {
  switch (lang) {
    case "cs":
      return "Odkaz na aktualizaci se nepodařilo otevřít. Zkuste prosím obchod otevřít ručně.";
    case "pl":
      return "Nie udało się otworzyć linku do aktualizacji. Spróbuj otworzyć sklep ręcznie.";
    case "de":
      return "Der Update-Link konnte nicht geöffnet werden. Bitte öffne den Store manuell.";
    default:
      return "Could not open the update link. Please try opening the store manually.";
  }
}

export function UpdateGate({
  onCloudAccessChange,
  onCloudSyncAllowed,
}: {
  onCloudAccessChange: (status: CloudAccessStatus) => void;
  onCloudSyncAllowed: () => void;
}) {
  const { lang, t } = useI18n();
  const { UI, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const safeModal = getSafeModalMetrics({
    windowHeight,
    topInset: insets.top,
    bottomInset: insets.bottom,
    heightRatio: 0.86,
  });
  const [update, setUpdate] = useState<VersionCheckResult | null>(null);
  const checkRef = useRef(() => checkRemoteAppVersion(lang));
  const accessChangeRef = useRef(onCloudAccessChange);
  const cloudAllowedRef = useRef(onCloudSyncAllowed);
  const cancelledRef = useRef(false);
  const controllerRef = useRef<VersionGateController | null>(null);

  checkRef.current = () => checkRemoteAppVersion(lang);
  accessChangeRef.current = onCloudAccessChange;
  cloudAllowedRef.current = onCloudSyncAllowed;

  if (!controllerRef.current) {
    controllerRef.current = createVersionGateController({
      check: () => checkRef.current(),
      isCancelled: () => cancelledRef.current,
      onDecision: (decision: VersionCheckDecision) => {
        accessChangeRef.current(decision.status);
        setUpdate(decision.status === "unverified" ? null : decision.update ?? null);
      },
      startCloudSync: () => cloudAllowedRef.current(),
    });
  }

  const verifyVersion = useCallback(() => {
    void controllerRef.current?.verify();
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    verifyVersion();
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && controllerRef.current?.currentStatus() === "unverified") {
        verifyVersion();
      }
    });
    const retry = setInterval(() => {
      if (AppState.currentState === "active" && controllerRef.current?.currentStatus() === "unverified") {
        verifyVersion();
      }
    }, UNVERIFIED_RETRY_MS);

    return () => {
      cancelledRef.current = true;
      appStateSubscription.remove();
      clearInterval(retry);
    };
  }, [verifyVersion]);

  const styles = useMemo(() => {
    const sheetBg = isDark ? "rgba(60, 44, 33, 0.96)" : "#FFF3E8";
    const sheetBorder = isDark ? "rgba(255,159,45,0.35)" : "rgba(255,159,45,0.25)";
    const btnBg = isDark ? UI.btnBg : "#FFF0E3";
    const btnBgPrimary = isDark ? UI.card2 : "#FFE1C7";

    return StyleSheet.create({
      backdrop: {
        flex: 1,
        backgroundColor: UI.backdrop,
        justifyContent: "center",
        paddingHorizontal: 18,
        paddingTop: safeModal.paddingTop,
        paddingBottom: safeModal.paddingBottom,
      },
      card: {
        width: "100%",
        maxWidth: 420,
        alignSelf: "center",
        backgroundColor: sheetBg,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: sheetBorder,
        padding: 14,
        maxHeight: safeModal.maxHeight,
      },
      title: {
        color: UI.text,
        fontWeight: "900",
        fontSize: 16,
        marginBottom: 8,
      },
      msg: {
        color: UI.text,
        fontWeight: "700",
        fontSize: 14,
        lineHeight: 20,
      },
      btnRow: {
        flexDirection: "row",
        justifyContent: "flex-end",
        gap: 10,
        marginTop: 12,
        flexWrap: "wrap",
      },
      btn: {
        paddingHorizontal: 14,
        paddingVertical: 10,
        minHeight: 44,
        justifyContent: "center",
        alignItems: "center",
        borderRadius: 14,
        borderWidth: 1,
        borderColor: sheetBorder,
        backgroundColor: btnBg,
      },
      btnPrimary: {
        backgroundColor: btnBgPrimary,
      },
      btnText: {
        color: UI.text,
        fontWeight: "900",
      },
    });
  }, [UI, isDark, safeModal.maxHeight, safeModal.paddingBottom, safeModal.paddingTop]);

  if (!update) return null;

  const required = update.level === "required";
  const title = required ? t.update.requiredTitle : t.update.recommendedTitle;
  const message =
    update.message || (required ? t.update.requiredMessage : t.update.recommendedMessage);

  function close() {
    if (!required) setUpdate(null);
  }

  async function openUpdateUrl() {
    const updateUrl = update?.updateUrl?.trim();

    if (__DEV__) {
      console.log("[UpdateGate] update button pressed", {
        platform: Platform.OS,
        updateUrl: updateUrl || null,
      });
    }

    if (!updateUrl) {
      Alert.alert(title, getUpdateOpenError(lang));
      return;
    }

    try {
      const canOpen = await Linking.canOpenURL(updateUrl);

      if (__DEV__) {
        console.log("[UpdateGate] Linking.canOpenURL", {
          platform: Platform.OS,
          updateUrl,
          result: canOpen ? "passed" : "failed",
        });
      }
    } catch (error) {
      if (__DEV__) {
        console.log("[UpdateGate] Linking.canOpenURL failed", {
          platform: Platform.OS,
          updateUrl,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    try {
      await Linking.openURL(updateUrl);
    } catch (error) {
      if (__DEV__) {
        console.log("[UpdateGate] Linking.openURL failed", {
          platform: Platform.OS,
          updateUrl,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      Alert.alert(title, getUpdateOpenError(lang));
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <ScrollView style={styles.card} contentContainerStyle={{ flexGrow: 0, paddingBottom: 2 }}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.msg}>{message}</Text>

          <View style={styles.btnRow}>
            {!required && (
              <Pressable
                accessibilityRole="button"
                onPress={close}
                style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.btnText}>{t.update.laterButton}</Text>
              </Pressable>
            )}

            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => void openUpdateUrl()}
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.btnText}>{t.update.updateButton}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
