import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { createUserWithEmailAndPassword, deleteUser, updateProfile } from "firebase/auth";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Alert } from "../lib/appAlert";
import { auth } from "../lib/firebase";
import { useTheme } from "../lib/theme";
import { claimUsername } from "../lib/usernames";

export default function RegisterScreen() {
  const router = useRouter();
  const { UI, isDark } = useTheme();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  const gradientColors = useMemo(() => (isDark ? [UI.bg, UI.bg, UI.bg] : [UI.bg, UI.bg, UI.bg]), [UI.bg, isDark]);

  const isEmailValid = (v: string) => {
    const s = v.trim();
    if (!s.includes("@")) return false;
    const parts = s.split("@");
    if (parts.length !== 2) return false;
    if (!parts[0] || !parts[1]) return false;
    return parts[1].includes(".");
  };

  const isUsernameValid = (v: string) => v.trim().length >= 2;
  const isPasswordValid = (v: string) => v.trim().length >= 6;

  const canRegister = isUsernameValid(username) && isEmailValid(email) && isPasswordValid(password) && !loading;

  const withTimeout = async <T,>(p: Promise<T>, ms: number) => {
    let t: any;
    const timeout = new Promise<never>((_, rej) => {
      t = setTimeout(() => rej({ code: "auth/timeout" }), ms);
    });
    try {
      return (await Promise.race([p, timeout])) as T;
    } finally {
      clearTimeout(t);
    }
  };

  const handleRegister = async () => {
    Keyboard.dismiss();
    if (loading) return;

    const nameTrim = username.trim();
    const emailTrim = email.trim();
    const passTrim = password.trim();

    if (!isUsernameValid(nameTrim)) {
      Alert.alert("Chybí jméno", "Zadej prosím uživatelské jméno (min. 2 znaky).");
      return;
    }
    if (!isEmailValid(emailTrim)) {
      Alert.alert("Neplatný e-mail", "Zadej prosím platný e-mail.");
      return;
    }
    if (!isPasswordValid(passTrim)) {
      Alert.alert("Slabé heslo", "Heslo musí mít alespoň 6 znaků.");
      return;
    }

    setLoading(true);
    try {
      const cred = await withTimeout(createUserWithEmailAndPassword(auth, emailTrim, passTrim), 12000);

      if (cred.user) {
        // ✅ displayName pro UI
        await updateProfile(cred.user, { displayName: nameTrim });
        await cred.user.reload();

        // ✅ Firestore: users/{uid} + usernames/{usernameLower}
       try {
          await claimUsername(cred.user.uid, nameTrim);
        } catch (err: any) {
          // když se nepodaří uložit profil/username, smažeme Auth účet, aby nezůstal viset
          try {
            await deleteUser(cred.user);
          } catch {
            // ignore
          }

          const codeRaw = String(err?.code ?? "");
          const msgRaw = String(err?.message ?? "");
          const c = (codeRaw || msgRaw).toLowerCase();

          // ✅ jen specifické chyby pro username (NE "already" obecně)
          if (
            c.includes("username-taken") ||
            c.includes("username_taken") ||
            c.includes("usernamealready") ||
            c.includes("username-already") ||
            c.includes("taken") && c.includes("username")
          ) {
            Alert.alert("Jméno je obsazené", "Zkus jiné uživatelské jméno.");
            return;
          }

          if (c.includes("permission-denied")) {
            Alert.alert(
              "Nemám přístup do cloudu",
              "Firestore pravidla blokují zápis (PERMISSION_DENIED). Zkontroluj Firestore Rules a zkus to znovu."
            );
            return;
          }

          console.log("CLAIM USERNAME ERROR:", err);
Alert.alert(
  "Chyba cloudu",
  `Nepodařilo se uložit profil do cloudu.\n\nCODE: ${String(err?.code ?? "unknown")}\nMSG: ${String(err?.message ?? "")}`
);
return;
        }
      }

      Alert.alert("Hotovo", "Účet byl vytvořen.");
      // po registraci rovnou do aplikace
      router.replace("/(tabs)");
    } catch (e: any) {
      const code = e?.code ?? "";
      if (code.includes("auth/email-already-in-use")) {
        Alert.alert("E-mail už existuje", "Tento e-mail už je zaregistrovaný. Zkus se přihlásit.");
      } else if (code.includes("auth/invalid-email")) {
        Alert.alert("Neplatný e-mail", "Zkontroluj prosím formát e-mailu.");
      } else if (code.includes("auth/weak-password")) {
        Alert.alert("Slabé heslo", "Zkus delší heslo (min. 6 znaků).");
      } else if (code.includes("auth/timeout")) {
        Alert.alert("Trvá to moc dlouho", "Registrace se zasekla (signál / Firebase). Zkus to prosím znovu.");
      } else {
        console.log("REGISTER ERROR:", e?.code, e?.message, e);
        Alert.alert(
          "Chyba",
          `Nepodařilo se registrovat. Zkus to prosím znovu.

(${code || "unknown"})`
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: UI.bg }]}>
      <LinearGradient
        colors={gradientColors as any}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: UI.bg }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.container}>
          <Text style={[styles.title, { color: UI.text }]}>Registrace</Text>
          <Text style={[styles.subtitle, { color: UI.sub }]}>Vytvoř si účet a pojď na to.</Text>

          <View style={{ marginTop: 22 }}>
            {/* USERNAME */}
            <View style={[styles.inputWrap, { backgroundColor: UI.card, borderColor: UI.stroke }]}>
              <TextInput
                value={username}
                onChangeText={setUsername}
                placeholder="Uživatelské jméno"
                placeholderTextColor={UI.sub}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="next"
                style={[styles.input, { color: UI.text }]}
              />
            </View>

            {/* EMAIL */}
            <View style={[styles.inputWrap, { backgroundColor: UI.card, borderColor: UI.stroke, marginTop: 14 }]}>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="E-mail"
                placeholderTextColor={UI.sub}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="next"
                style={[styles.input, { color: UI.text }]}
              />
            </View>

            {/* PASSWORD */}
            <View style={[styles.inputWrap, { backgroundColor: UI.card, borderColor: UI.stroke, marginTop: 14 }]}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Heslo"
                placeholderTextColor={UI.sub}
                secureTextEntry={!showPass}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleRegister}
                style={[styles.input, { color: UI.text, paddingRight: 52 }]}
              />

              <Pressable
                onPress={() => setShowPass((v) => !v)}
                style={({ pressed }) => [styles.eyeBtn, { opacity: pressed ? 0.75 : 1 }]}
                hitSlop={10}
              >
                <Text style={[styles.eyeText, { color: UI.sub }]}>{showPass ? "👁️" : "👁️‍🗨️"}</Text>
              </Pressable>
            </View>

            {/* REGISTER BUTTON */}
            <Pressable
              onPress={handleRegister}
              disabled={!canRegister}
              style={({ pressed }) => [
                styles.primaryBtn,
                { opacity: !canRegister ? 0.45 : pressed ? 0.9 : 1 },
              ]}
            >
              <LinearGradient
                colors={["#4B0011", "#F59E0B"]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.primaryBtnGradient}
              />
              {loading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator />
                  <Text style={styles.primaryBtnText}>VYTVÁŘÍM…</Text>
                </View>
              ) : (
                <Text style={styles.primaryBtnText}>VYTVOŘIT ÚČET</Text>
              )}
            </Pressable>

            {/* BACK TO LOGIN */}
            <View style={styles.backRow}>
              <Text style={[styles.backText, { color: UI.sub }]}>Už máš účet?</Text>
              <Pressable
                onPress={() => {
                  Keyboard.dismiss();
                  router.replace("/login");
                }}
                style={({ pressed }) => [pressed && { opacity: 0.85 }]}
              >
                <Text style={[styles.backLink, { color: UI.accent }]}>{" "}Přihlásit se</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },

  container: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: 54,
    paddingBottom: 90,
  },

  title: {
    fontSize: 40,
    fontWeight: "900",
    letterSpacing: -0.5,
  },

  subtitle: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: "600",
  },

  inputWrap: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 58,
    justifyContent: "center",
  },

  input: {
    fontSize: 15.5,
    fontWeight: "700",
  },

  eyeBtn: {
    position: "absolute",
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    width: 40,
  },

  eyeText: {
    fontSize: 18,
  },

  primaryBtn: {
    marginTop: 18,
    height: 62,
    borderRadius: 16,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },

  primaryBtnGradient: {
    ...StyleSheet.absoluteFillObject,
  },

  primaryBtnText: {
    color: "white",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 1,
  },

  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  backRow: {
    marginTop: 18,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    flexWrap: "wrap",
  },

  backText: {
    fontSize: 13.5,
    fontWeight: "700",
  },

  backLink: {
    fontSize: 13.5,
    fontWeight: "900",
  },
});
