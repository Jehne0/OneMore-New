
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Alert } from "../lib/appAlert";
import { useTheme } from "../lib/theme";
import { auth } from "../lib/firebase";
import { sendPasswordResetEmail } from "firebase/auth";
import { useI18n, type Lang } from "../lib/i18n";

const FORGOT_STRINGS: Record<Lang, Record<string, string>> = {
  cs: { done: "Hotovo", sent: "Pokud účet existuje, poslali jsme e-mail pro reset hesla.", invalidTitle: "Neplatný e-mail", invalid: "Zkontroluj prosím formát e-mailu.", error: "Chyba", failed: "E-mail se nepodařilo odeslat. Zkus to prosím znovu.", title: "Obnova hesla", subtitle: "Zadej e-mail a pošleme ti odkaz pro nastavení nového hesla.", email: "E-mail", placeholder: "např. jan@email.cz", send: "POSLAT E-MAIL", back: "Zpět" },
  en: { done: "Done", sent: "If the account exists, we sent an email to reset the password.", invalidTitle: "Invalid email", invalid: "Please check the email format.", error: "Error", failed: "The email could not be sent. Please try again.", title: "Reset password", subtitle: "Enter your email and we will send you a link to set a new password.", email: "Email", placeholder: "e.g. jane@email.com", send: "SEND EMAIL", back: "Back" },
  pl: { done: "Gotowe", sent: "Jeśli konto istnieje, wysłaliśmy e-mail do zresetowania hasła.", invalidTitle: "Nieprawidłowy e-mail", invalid: "Sprawdź format adresu e-mail.", error: "Błąd", failed: "Nie udało się wysłać e-maila. Spróbuj ponownie.", title: "Resetowanie hasła", subtitle: "Wpisz e-mail, a wyślemy link do ustawienia nowego hasła.", email: "E-mail", placeholder: "np. jan@email.pl", send: "WYŚLIJ E-MAIL", back: "Wstecz" },
  de: { done: "Fertig", sent: "Falls das Konto existiert, haben wir eine E-Mail zum Zurücksetzen des Passworts gesendet.", invalidTitle: "Ungültige E-Mail-Adresse", invalid: "Bitte überprüfe das Format der E-Mail-Adresse.", error: "Fehler", failed: "Die E-Mail konnte nicht gesendet werden. Bitte versuche es erneut.", title: "Passwort zurücksetzen", subtitle: "Gib deine E-Mail-Adresse ein. Wir senden dir einen Link, mit dem du ein neues Passwort festlegen kannst.", email: "E-Mail", placeholder: "z. B. name@email.de", send: "E-MAIL SENDEN", back: "Zurück" },
};

export default function ForgotScreen() {
  const { lang } = useI18n();
  const tx = FORGOT_STRINGS[lang];
  const router = useRouter();
  const insets = useSafeAreaInsets();
  
  const safeBack = () => {
    // může být otevřeno přímo (deep link) – pak není kam se vracet
    const can = typeof (router as any)?.canGoBack === "function" ? (router as any).canGoBack() : false;
    if (can) router.back();
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
        tx.done,
        tx.sent
      );
      safeBack();
    } catch (err: any) {
      const code = err?.code ?? "";
      if (code.includes("auth/invalid-email")) {
        Alert.alert(tx.invalidTitle, tx.invalid);
      } else {
        // záměrně obecně – kvůli bezpečnosti neprozrazujeme, zda e-mail existuje
        Alert.alert(tx.error, tx.failed);
      }
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[
        styles.screen,
        {
          backgroundColor: UI.bg,
          paddingTop:
            Platform.OS === "ios" ? Math.max(54, insets.top + 20) : 54,
          paddingBottom:
            Platform.OS === "ios" ? Math.max(22, insets.bottom + 12) : 22,
        },
      ]}
    >
      <Text style={[styles.title, { color: UI.text }]}>{tx.title}</Text>
      <Text style={[styles.sub, { color: UI.sub }]}>
        {tx.subtitle}
      </Text>

      <View style={{ marginTop: 18 }}>
        <Text style={[styles.label, { color: UI.sub }]}>{tx.email}</Text>
        <View style={[styles.inputWrap, { backgroundColor: UI.card, borderColor: UI.stroke }]}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder={tx.placeholder}
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
          <Text style={[styles.btnText, { color: UI.bg }]}>{tx.send}</Text>
        </Pressable>

        <Pressable onPress={() => safeBack()} style={{ marginTop: 16 }}>
          <Text style={{ color: UI.sub, fontWeight: "700", textAlign: "center" }}>
            {tx.back}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
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
