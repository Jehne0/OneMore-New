
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Alert } from "../lib/appAlert";
import { useTheme } from "../lib/theme";
import { auth } from "../lib/firebase";
import { sendPasswordResetEmail } from "firebase/auth";

export default function ForgotScreen() {
  const router = useRouter();
  
  const safeBack = () => {
    // může být otevřeno přímo (deep link) – pak není kam se vracet
    const can = typeof (router as any)?.canGoBack === "function" ? (router as any).canGoBack() : false;
    if (can) safeBack();
    else router.replace("/login");
  };
const { UI } = useTheme();
  const [email, setEmail] = useState("");

  const canSend = email.trim().length > 3 && email.includes("@");

  const onSend = async () => {
    if (!canSend) return;

    try {
      const e = email.trim();
      await sendPasswordResetEmail(auth, e);
      Alert.alert(
        "Hotovo",
        "Pokud účet existuje, poslali jsme e-mail pro reset hesla."
      );
      safeBack();
    } catch (err: any) {
      const code = err?.code ?? "";
      if (code.includes("auth/invalid-email")) {
        Alert.alert("Neplatný e-mail", "Zkontroluj prosím formát e-mailu.");
      } else {
        // záměrně obecně – kvůli bezpečnosti neprozrazujeme, zda e-mail existuje
        Alert.alert("Chyba", "Nepodařilo se odeslat e-mail. Zkus to prosím znovu.");
      }
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: UI.bg }]}>
      <Text style={[styles.title, { color: UI.text }]}>Obnova hesla</Text>
      <Text style={[styles.sub, { color: UI.sub }]}>
        Zadej e-mail a pošleme ti odkaz pro nastavení nového hesla.
      </Text>

      <View style={{ marginTop: 18 }}>
        <Text style={[styles.label, { color: UI.sub }]}>E-mail</Text>
        <View style={[styles.inputWrap, { backgroundColor: UI.card, borderColor: UI.stroke }]}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="např. jan@email.cz"
            placeholderTextColor={UI.sub}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            style={[styles.input, { color: UI.text }]}
          />
        </View>

        <Pressable
          onPress={onSend}
          disabled={!canSend}
          style={({ pressed }) => [
            styles.btn,
            { backgroundColor: UI.accent, opacity: !canSend ? 0.5 : pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[styles.btnText, { color: UI.bg }]}>POSLAT E-MAIL</Text>
        </Pressable>

        <Pressable onPress={() => safeBack()} style={{ marginTop: 16 }}>
          <Text style={{ color: UI.sub, fontWeight: "700", textAlign: "center" }}>
            Zpět
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 22, paddingTop: 54 },
  title: { fontSize: 32, fontWeight: "900" },
  sub: { marginTop: 8, fontSize: 14, fontWeight: "700" },
  label: { fontSize: 13, fontWeight: "800" },
  inputWrap: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 54,
    justifyContent: "center",
    marginTop: 8,
  },
  input: { fontSize: 15.5, fontWeight: "800" },
  btn: {
    marginTop: 18,
    height: 56,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  btnText: { fontSize: 15, fontWeight: "900", letterSpacing: 0.6 },
});
