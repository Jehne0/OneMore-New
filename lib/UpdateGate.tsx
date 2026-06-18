import React, { useEffect, useMemo, useState } from "react";
import { Linking, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { useI18n } from "./i18n";
import { useTheme } from "./theme";
import { checkRemoteAppVersion, type VersionCheckResult } from "./versionCheck";

export function UpdateGate() {
  const { lang, t } = useI18n();
  const { UI, isDark } = useTheme();
  const [update, setUpdate] = useState<VersionCheckResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const result = await checkRemoteAppVersion(lang);
        if (!cancelled) setUpdate(result);
      })();
    }, 1500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [lang]);

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
        padding: 18,
      },
      card: {
        backgroundColor: sheetBg,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: sheetBorder,
        padding: 14,
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
  }, [UI, isDark]);

  if (!update) return null;

  const required = update.level === "required";
  const title = required ? t.update.requiredTitle : t.update.recommendedTitle;
  const message =
    update.message || (required ? t.update.requiredMessage : t.update.recommendedMessage);
  const canUpdate = !!update.updateUrl;

  function close() {
    if (!required) setUpdate(null);
  }

  async function openUpdateUrl() {
    if (!update?.updateUrl) return;

    try {
      await Linking.openURL(update.updateUrl);
    } catch {}
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.msg}>{message}</Text>

          <View style={styles.btnRow}>
            {!required && (
              <Pressable
                onPress={close}
                style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.btnText}>{t.update.laterButton}</Text>
              </Pressable>
            )}

            <Pressable
              disabled={!canUpdate}
              onPress={() => void openUpdateUrl()}
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                !canUpdate && { opacity: 0.45 },
                pressed && canUpdate && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.btnText}>{t.update.updateButton}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
