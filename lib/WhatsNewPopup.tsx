import { Ionicons } from "@expo/vector-icons";
import { onAuthStateChanged } from "firebase/auth";
import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { auth } from "./firebase";
import { useI18n } from "./i18n";
import { getSafeModalMetrics } from "./safeModalLayout";
import { getResponsiveLayout } from "./responsiveLayout";
import { useTheme } from "./theme";
import { getWhatsNewCopy } from "./whatsNew";
import { markWhatsNewSeen, shouldAutoShowWhatsNew } from "./whatsNewStorage";

export function WhatsNewPopup() {
  const { lang } = useI18n();
  const { UI, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [uid, setUid] = useState("");
  const [visible, setVisible] = useState(false);
  const copy = getWhatsNewCopy(lang);
  const safe = getSafeModalMetrics({ windowHeight: height, topInset: insets.top, bottomInset: insets.bottom });
  const responsive = getResponsiveLayout(width);

  useEffect(() => onAuthStateChanged(auth, (user) => {
    const nextUid = user?.uid ?? "";
    setUid(nextUid);
    setVisible(false);
    if (nextUid) void shouldAutoShowWhatsNew(nextUid).then(setVisible).catch(() => {});
  }), []);

  const close = () => {
    setVisible(false);
    void markWhatsNewSeen(uid).catch(() => {});
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={[styles.wrap, { paddingTop: safe.paddingTop, paddingBottom: safe.paddingBottom }]}>
        <Pressable style={[StyleSheet.absoluteFillObject, { backgroundColor: UI.backdrop }]} onPress={close} />
        <View style={[styles.card, { width: responsive.modalWidth, maxHeight: safe.maxHeight, backgroundColor: isDark ? UI.sheetBg : "#FFF2E4", borderColor: isDark ? UI.sheetStroke : "#FF8A1F" }]}>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={[styles.icon, { backgroundColor: UI.card2, borderColor: UI.stroke }]}><Ionicons name="sparkles" size={27} color={UI.accent} /></View>
            <Text style={[styles.title, { color: UI.text }]}>{copy.title}</Text>
            <Text style={[styles.eyebrow, { color: UI.accent }]}>{copy.popupEyebrow}</Text>
            <Text style={[styles.body, { color: UI.sub }]}>{copy.popupBody}</Text>
            <Pressable onPress={close} style={({ pressed }) => [styles.button, { backgroundColor: UI.accent }, pressed && { opacity: 0.88 }]}>
              <Text style={styles.buttonText}>{copy.close}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "center", paddingHorizontal: 18 },
  card: { alignSelf: "center", borderRadius: 24, borderWidth: 1, overflow: "hidden" },
  content: { alignItems: "center", padding: 22 },
  icon: { width: 54, height: 54, borderRadius: 27, borderWidth: 1, alignItems: "center", justifyContent: "center", marginBottom: 13 },
  title: { fontSize: 23, lineHeight: 29, fontWeight: "900", textAlign: "center" },
  eyebrow: { marginTop: 10, fontSize: 16, lineHeight: 22, fontWeight: "900", textAlign: "center" },
  body: { marginTop: 10, fontSize: 15, lineHeight: 22, fontWeight: "700", textAlign: "center" },
  button: { width: "100%", minHeight: 48, borderRadius: 15, alignItems: "center", justifyContent: "center", marginTop: 20 },
  buttonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
});
