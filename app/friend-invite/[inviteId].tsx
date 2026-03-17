import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { redeemInviteToken } from "../../lib/invites";
import { useTheme } from "../../lib/theme";

export default function FriendInviteAcceptScreen() {
  const { inviteId } = useLocalSearchParams<{ inviteId?: string }>();
  const router = useRouter();
  const { UI } = useTheme();

  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [errMsg, setErrMsg] = useState<string>("");

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const id = String(inviteId ?? "").trim();
        if (!id) throw new Error("Chybí inviteId.");
        await redeemInviteToken(id);
        if (!mounted) return;
        setState("ok");
      } catch (e: any) {
        if (!mounted) return;
        setState("error");
        setErrMsg(String(e?.message ?? "Nepodařilo se pozvánku přijmout."));
      }
    })();

    return () => {
      mounted = false;
    };
  }, [inviteId]);

  return (
    <View style={{ flex: 1, backgroundColor: UI.bg, alignItems: "center", justifyContent: "center", padding: 18 }}>
      {state === "loading" && (
        <View style={{ alignItems: "center", gap: 12 }}>
          <ActivityIndicator />
          <Text style={{ color: UI.text, fontWeight: "900", textAlign: "center" }}>Přidávám přítele…</Text>
        </View>
      )}

      {state === "ok" && (
        <View style={{ alignItems: "center", gap: 12 }}>
          <Text style={{ color: UI.text, fontWeight: "900", textAlign: "center", fontSize: 18 }}>Hotovo 🎉</Text>
          <Text style={{ color: UI.sub, fontWeight: "800", textAlign: "center" }}>Uživatelé byli přidáni jako přátelé.</Text>

          <Pressable
            onPress={() => router.replace("/(tabs)/profile")}
            style={({ pressed }) => [
              {
                marginTop: 10,
                borderRadius: 14,
                paddingVertical: 12,
                paddingHorizontal: 18,
                backgroundColor: UI.accent,
                opacity: pressed ? 0.9 : 1,
              },
            ]}
          >
            <Text style={{ color: "#0B1220", fontWeight: "900" }}>Zpět do profilu</Text>
          </Pressable>
        </View>
      )}

      {state === "error" && (
        <View style={{ alignItems: "center", gap: 12 }}>
          <Text style={{ color: UI.text, fontWeight: "900", textAlign: "center", fontSize: 18 }}>Tohle nevyšlo</Text>
          <Text style={{ color: UI.sub, fontWeight: "800", textAlign: "center" }}>{errMsg}</Text>

          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              {
                marginTop: 10,
                borderRadius: 14,
                paddingVertical: 12,
                paddingHorizontal: 18,
                backgroundColor: UI.accent,
                opacity: pressed ? 0.9 : 1,
              },
            ]}
          >
            <Text style={{ color: "#0B1220", fontWeight: "900" }}>Zpět</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
