import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { signInWithEmailAndPassword } from "firebase/auth";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
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
import { revenueCatLogin } from "../lib/revenuecat";
import { useTheme } from "../lib/theme";
import { useI18n } from "../lib/i18n";

const SAVED_LOGIN_KEY = "onemore_saved_login";
const REMEMBER_ME_KEY = "onemore_remember_me";

// ✅ dočasné "logo" aplikace (zatím než budete mít finální)
const APP_LOGO = require("../assets/brand/flame_plus1.png");

export default function LoginScreen() {
  const router = useRouter();
  const { UI, isDark, toggle } = useTheme();
  const { lang, setLang, t } = useI18n();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  // ✅ "Zapamatovat" = uloží e-mail (a volitelně i heslo) pro automatické přihlášení po restartu aplikace.
  // Pozn.: Heslo je uložené lokálně v AsyncStorage (pro nejrychlejší funkčnost v Expo). Pokud budeš chtít později, můžeme to přepnout na SecureStore.
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SAVED_LOGIN_KEY);
        if (!raw) return;

        const parsed = JSON.parse(raw);
        const savedEmail = String(parsed?.email ?? "").trim();
        if (!savedEmail) {
          await AsyncStorage.removeItem(SAVED_LOGIN_KEY);
          return;
        }

        if (alive) {
          setEmail(savedEmail);
          setRemember(true);
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const gradientColors = useMemo(
    () => (isDark ? [UI.bg, UI.bg, UI.bg] : [UI.bg, UI.bg, UI.bg]),
    [UI.bg, isDark]
  );

  const isEmailValid = (v: string) => {
    const s = v.trim();
    if (!s.includes("@")) return false;
    const parts = s.split("@");
    if (parts.length !== 2) return false;
    if (!parts[0] || !parts[1]) return false;
    return parts[1].includes(".");
  };

  const canLogin = isEmailValid(email) && password.trim().length > 0;

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

  const handleLogin = async () => {
    Keyboard.dismiss();
    if (loading) return;

    const emailTrim = email.trim();
    const passTrim = password.trim();

    if (!isEmailValid(emailTrim)) {
      Alert.alert(t.login.invalidEmailTitle, t.login.invalidEmailText);
      return;
    }
    if (!passTrim) {
      Alert.alert(t.login.missingPasswordTitle, t.login.missingPasswordText);
      return;
    }

    setLoading(true);
    try {
      const cred = await withTimeout(
        signInWithEmailAndPassword(auth, emailTrim, passTrim),
        9000
      );

      // ✅ propojit RevenueCat s účtem (UID)
      // Nesmí blokovat přihlášení – když RevenueCat selže, uživatel se má i tak dostat do appky.
      try {
        await revenueCatLogin(cred.user.uid);
      } catch (rcErr: any) {
        console.log("REVENUECAT LOGIN ERROR:", rcErr?.code, rcErr?.message, rcErr);
      }

      // ✅ Email verification vypnuto – neblokujeme přihlášení a nic nezobrazujeme.

      await AsyncStorage.setItem(REMEMBER_ME_KEY, remember ? "1" : "0");
      if (remember) {
        await AsyncStorage.setItem(
          SAVED_LOGIN_KEY,
          JSON.stringify({ email: emailTrim, password: passTrim })
        );
      } else {
        await AsyncStorage.removeItem(SAVED_LOGIN_KEY);
      }

      router.replace("/(tabs)");
    } catch (e: any) {
      const code = e?.code ?? "";
      if (code.includes("auth/user-not-found")) {
        Alert.alert(t.login.accountNotFoundTitle, t.login.accountNotFoundText);
      } else if (
        code.includes("auth/wrong-password") ||
        code.includes("auth/invalid-credential")
      ) {
        Alert.alert(t.login.loginFailedTitle, t.login.loginFailedText);
      } else if (code.includes("auth/invalid-email")) {
        Alert.alert(t.login.invalidEmailTitle, t.login.invalidEmailText);
      } else if (code.includes("auth/timeout")) {
        Alert.alert(t.login.timeoutTitle, t.login.timeoutText);
      } else {
        console.log("LOGIN ERROR:", e?.code, e?.message, e);
        Alert.alert(
          t.login.genericErrorTitle,
          `${t.login.genericErrorText}\n\n(${code || "unknown"})`
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const onForgot = () => {
    Keyboard.dismiss();
    router.replace("/forgot");
  };

  const onRegister = () => {
    Keyboard.dismiss();
    router.replace("/register");
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
          {/* LOGO */}
          <View style={styles.logoWrap}>
            <View
              style={[
                styles.logoCircle,
                {
                  backgroundColor: isDark ? UI.card : UI.card2,
                  borderColor: UI.stroke,
                },
              ]}
            >
              <LinearGradient
                pointerEvents="none"
                colors={
                  isDark
                    ? (["rgba(245,158,11,0.22)", "rgba(245,158,11,0.06)"] as any)
                    : (["rgba(245,158,11,0.26)", "rgba(245,158,11,0.08)"] as any)
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />

              <Image source={APP_LOGO} style={styles.logoImg} resizeMode="contain" />
            </View>
          </View>

          {/* TITLE */}
          <Text style={[styles.title, { color: UI.text }]}>
            {t.login.welcome}{" "}
            <Text style={[styles.titleAccent, { color: UI.accent }]}>OneMore!</Text>
          </Text>
          <Text style={[styles.subtitle, { color: UI.sub }]}>{t.login.subtitle}</Text>

          {/* LANGUAGE SWITCH */}
          <View style={styles.langDropdownWrap}>
            <Pressable
              onPress={() => setLangMenuOpen((v) => !v)}
              style={({ pressed }) => [
                styles.langDropdownBtn,
                {
                  borderColor: UI.stroke,
                  backgroundColor: UI.card,
                  opacity: pressed ? 0.9 : 1,
                },
              ]}
            >
              <Text style={[styles.langBtnText, { color: UI.text }]}>
                🌍 {lang === "cs" ? "CZ" : lang === "en" ? "EN" : lang === "pl" ? "PL" : "DE"}
              </Text>

              <Text style={[styles.langBtnText, { color: UI.text }]}>
                {langMenuOpen ? "⌃" : "⌄"}
              </Text>
            </Pressable>

            {langMenuOpen && (
              <View
                style={[
                  styles.langDropdownMenu,
                  {
                    backgroundColor: UI.card,
                    borderColor: UI.stroke,
                  },
                ]}
              >
                {lang !== "cs" && (
                  <Pressable
                    onPress={() => {
                      void setLang("cs");
                      setLangMenuOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.langDropdownItem,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <Text style={[styles.langDropdownText, { color: UI.text }]}>
                      CZ · Čeština
                    </Text>
                  </Pressable>
                )}

                {lang !== "en" && (
                  <Pressable
                    onPress={() => {
                      void setLang("en");
                      setLangMenuOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.langDropdownItem,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <Text style={[styles.langDropdownText, { color: UI.text }]}>
                      EN · English
                    </Text>
                  </Pressable>
                )}

                {lang !== "pl" && (
                  <Pressable
                    onPress={() => {
                      void setLang("pl");
                      setLangMenuOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.langDropdownItem,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <Text style={[styles.langDropdownText, { color: UI.text }]}>
                      PL · Polski
                    </Text>
                  </Pressable>
                )}

                {lang !== "de" && (
                  <Pressable
                    onPress={() => {
                      void setLang("de");
                      setLangMenuOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.langDropdownItem,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <Text style={[styles.langDropdownText, { color: UI.text }]}>
                      DE · Deutsch
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>

          {/* INPUTS */}
          <View style={{ marginTop: 22 }}>
            <View
              style={[
                styles.inputWrap,
                { backgroundColor: UI.card, borderColor: UI.stroke },
              ]}
            >
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder={t.login.email}
                placeholderTextColor={UI.sub}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="next"
                style={[styles.input, { color: UI.text }]}
              />
            </View>

            <View
              style={[
                styles.inputWrap,
                {
                  backgroundColor: UI.card,
                  borderColor: UI.stroke,
                  marginTop: 14,
                },
              ]}
            >
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder={t.login.password}
                placeholderTextColor={UI.sub}
                secureTextEntry={!showPass}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
                style={[styles.input, { color: UI.text, paddingRight: 52 }]}
              />

              <Pressable
                onPress={() => setShowPass((v) => !v)}
                style={({ pressed }) => [styles.eyeBtn, { opacity: pressed ? 0.75 : 1 }]}
                hitSlop={10}
              >
                <Text style={[styles.eyeText, { color: UI.sub }]}>
                  {showPass ? "👁️" : "👁️‍🗨️"}
                </Text>
              </Pressable>
            </View>

            {/* REMEMBER + FORGOT */}
            <View style={styles.rowBetween}>
              <Pressable
                onPress={() => setRemember((v) => !v)}
                style={({ pressed }) => [styles.rememberRow, pressed && { opacity: 0.85 }]}
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: UI.stroke,
                      backgroundColor: remember ? UI.accent : "transparent",
                    },
                  ]}
                >
                  {remember ? <Text style={[styles.checkMark, { color: UI.bg }]}>✓</Text> : null}
                </View>
                <Text style={[styles.rememberText, { color: UI.sub }]}>{t.login.remember}</Text>
              </Pressable>

              <Pressable onPress={onForgot} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
                <Text style={[styles.forgotText, { color: UI.sub }]}>{t.login.forgot}</Text>
              </Pressable>
            </View>

            {/* LOGIN BUTTON */}
            <Pressable
              onPress={handleLogin}
              disabled={!canLogin || loading}
              style={({ pressed }) => [
                styles.loginBtn,
                { opacity: !canLogin || loading ? 0.45 : pressed ? 0.9 : 1 },
              ]}
            >
              <LinearGradient
                colors={["#4B0011", "#F59E0B"]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.loginBtnGradient}
              />
              {loading ? (
                <View style={styles.loginLoadingRow}>
                  <ActivityIndicator />
                  <Text style={styles.loginBtnText}>{t.login.loggingIn}</Text>
                </View>
              ) : (
                <Text style={styles.loginBtnText}>{t.login.login}</Text>
              )}
            </Pressable>

            {/* REGISTER */}
            <View style={styles.registerRow}>
              <Text style={[styles.registerText, { color: UI.sub }]}>{t.login.noAccount}</Text>
              <Pressable onPress={onRegister} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
                <Text style={[styles.registerLink, { color: UI.accent }]}>
                  {" "}
                  {t.login.registerHere}
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Tmavý/Světlý režim */}
          <View style={styles.darkToggleWrap} pointerEvents="box-none">
            <Pressable
              onPress={() => void toggle()}
              hitSlop={12}
              style={({ pressed }) => [
                styles.darkToggleBtn,
                {
                  borderColor: UI.stroke,
                  backgroundColor: UI.card,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}
            >
              <Text style={[styles.darkToggleText, { color: UI.text }]}>
                {isDark ? t.login.lightMode : t.login.darkMode}
              </Text>
            </Pressable>
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
  paddingTop: 96,
  paddingBottom: 90,
},

  logoWrap: {
    alignItems: "flex-start",
    marginBottom: 30,
  },

  logoCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },

  logoImg: {
    width: 100,
    height: 100,
  },

  title: {
    fontSize: 40,
    fontWeight: "900",
    letterSpacing: -0.5,
  },

  titleAccent: {
    fontSize: 40,
    fontWeight: "900",
  },

  subtitle: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: "600",
  },

  langRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 14,
  },

  langBtn: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 58,
    alignItems: "center",
  },

  langBtnText: {
    fontSize: 13,
    fontWeight: "900",
  },

langDropdownWrap: {
  position: "absolute",
  top: 50,
  right: 22,
  zIndex: 50,
},

  langDropdownBtn: {
    minWidth: 120,
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  langDropdownMenu: {
    position: "absolute",
    top: 44,
    left: 0,
    right: 0,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    zIndex: 100,
  },

  langDropdownItem: {
    paddingVertical: 12,
    paddingHorizontal: 14,
  },

  langDropdownText: {
    fontSize: 13,
    fontWeight: "800",
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

  rowBetween: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  rememberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  checkMark: {
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 14,
  },

  rememberText: {
    fontSize: 14,
    fontWeight: "700",
  },

  forgotText: {
    fontSize: 14,
    fontWeight: "700",
  },

  loginBtn: {
    marginTop: 18,
    height: 62,
    borderRadius: 16,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },

  loginBtnGradient: {
    ...StyleSheet.absoluteFillObject,
  },

  loginBtnText: {
    color: "white",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 1,
  },

  registerRow: {
    marginTop: 18,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    flexWrap: "wrap",
  },

  registerText: {
    fontSize: 13.5,
    fontWeight: "700",
  },

  registerLink: {
    fontSize: 13.5,
    fontWeight: "900",
  },

  loginLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  darkToggleWrap: {
    position: "absolute",
    right: 22,
    bottom: 70,
  },

  darkToggleBtn: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  darkToggleText: {
    fontSize: 12.5,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
});