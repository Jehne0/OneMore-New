import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect } from "expo-router";
import { onAuthStateChanged, signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../lib/firebase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { revenueCatLogin } from "../lib/revenuecat";
import { registerPushTokenForCurrentUser } from "../lib/pushTokens";
import { loadState } from "../lib/storage";

const SAVED_LOGIN_KEY = "onemore_saved_login";

export default function Index() {
  const [ready, setReady] = useState(false);
  const [logged, setLogged] = useState(false);
  const autoTriedRef = useRef(false);
  const hasLocalStateRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let authResolved = false;

    const withTimeout = <T,>(p: Promise<T>, ms: number) =>
      Promise.race([
        p,
        new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
      ]);

    void (async () => {
      try {
        const local = await loadState();
        const hasLocal =
          (local.challenges ?? []).length > 0 ||
          (local.history ?? []).length > 0 ||
          Object.keys(local.challengeStats ?? {}).length > 0;

        if (cancelled) return;
        hasLocalStateRef.current = hasLocal;

        setTimeout(() => {
          if (!cancelled && !authResolved && hasLocal) {
            setLogged(true);
            setReady(true);
          }
        }, 1200);
      } catch {}
    })();

    const unsub = onAuthStateChanged(auth, async (user) => {
      authResolved = true;
      if (user?.uid) {
        try {
          await revenueCatLogin(user.uid);
        } catch {}

        try {
          await registerPushTokenForCurrentUser();
        } catch {
          if (__DEV__) {
            console.log("Push token registration failed");
          }
        }
      }

      if (cancelled) return;

      if (user) {
        setLogged(true);
        setReady(true);
        return;
      }

      // Když není uživatel v paměti Auth SDK, zkusíme "Zapamatovat".
      if (!autoTriedRef.current) {
        autoTriedRef.current = true;
        try {
          const saved = await AsyncStorage.getItem(SAVED_LOGIN_KEY);
          if (saved) {
            const parsed = JSON.parse(saved);
            const email = String(parsed?.email ?? "");
            const password = String(parsed?.password ?? "");
            if (email && password) {
              await withTimeout(signInWithEmailAndPassword(auth, email, password), 9000);
              if (!cancelled) {
                setLogged(true);
                setReady(true);
                return;
              }
            }
          }
        } catch {
          if (!cancelled && hasLocalStateRef.current) {
            setLogged(true);
            setReady(true);
            return;
          }
          // když se auto-login nepovede, spadneme na klasický login
        }
      }

      setLogged(hasLocalStateRef.current);
      setReady(true);
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return <Redirect href={logged ? "/(tabs)" : "/login"} />;
}
