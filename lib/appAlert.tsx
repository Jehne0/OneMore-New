import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "./theme";

export type AlertButton = {
  text?: string;
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
};

type AlertPayload = {
  title?: string;
  message?: string;
  buttons?: AlertButton[];
};

type Listener = (p: AlertPayload) => void;
const listeners = new Set<Listener>();

function emit(payload: AlertPayload) {
  listeners.forEach((fn) => fn(payload));
}

/**
 * Drop-in náhrada za react-native Alert.alert(...) – ale vykreslíme vlastní
 * jemně oranžový modal (žádné bílé systémové okno).
 */
export const Alert = {
  alert(title?: string, message?: string, buttons?: AlertButton[]) {
    emit({ title, message, buttons });
  },
};

function normalizeButtons(btns?: AlertButton[]): Required<AlertButton>[] {
  const b = (btns ?? []).filter(Boolean);
  if (b.length === 0) {
    return [{ text: "OK", onPress: () => {}, style: "default" }];
  }

  // pokud není cancel, dovolíme zavřít tapem na pozadí
  return b.map((x) => ({
    text: x.text ?? "OK",
    onPress: x.onPress ?? (() => {}),
    style: x.style ?? "default",
  }));
}

export function AppAlertHost() {
  const { UI, isDark } = useTheme();
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<AlertPayload>({});

  useEffect(() => {
    const fn: Listener = (p) => {
      setPayload(p);
      setOpen(true);
    };
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  const buttons = useMemo(() => normalizeButtons(payload.buttons), [payload.buttons]);
  const hasCancel = buttons.some((b) => b.style === "cancel");

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
      btnDanger: {
        borderColor: "rgba(255,0,0,0.22)",
      },
      btnText: {
        color: UI.text,
        fontWeight: "900",
      },
    });
  }, [UI, isDark]);

  function close() {
    setOpen(false);
  }

  function press(btn: Required<AlertButton>) {
    close();
    // onPress může dělat async; nečekáme
    try {
      btn.onPress();
    } catch {}
  }

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <Pressable
        style={styles.backdrop}
        onPress={() => {
          // jen když není cancel button
          if (!hasCancel) close();
        }}
      >
        <Pressable style={styles.card} onPress={() => {}}>
          {!!payload.title && <Text style={styles.title}>{payload.title}</Text>}
          {!!payload.message && <Text style={styles.msg}>{payload.message}</Text>}

          <View style={styles.btnRow}>
            {buttons.map((b, idx) => {
              const isCancel = b.style === "cancel";
              const isDestructive = b.style === "destructive";
              const isPrimary = !isCancel && idx === buttons.length - 1;
              return (
                <Pressable
                  key={`${idx}-${b.text}`}
                  onPress={() => press(b)}
                  style={({ pressed }) => [
                    styles.btn,
                    isPrimary && styles.btnPrimary,
                    isDestructive && styles.btnDanger,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={styles.btnText}>{b.text}</Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
