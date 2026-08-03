import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { redeemInviteToken } from "../../lib/invites";
import { useTheme } from "../../lib/theme";
import { useI18n, type Lang } from "../../lib/i18n";

const FRIEND_INVITE_STRINGS: Record<Lang, Record<string, string>> = {
  cs: { missing: "Chybí identifikátor pozvánky.", failed: "Pozvánku se nepodařilo přijmout.", loading: "Přidávám přítele…", done: "Hotovo 🎉", success: "Uživatelé byli přidáni jako přátelé.", profile: "Zpět do profilu", error: "Tohle nevyšlo", back: "Zpět" },
  en: { missing: "The invitation identifier is missing.", failed: "The invitation could not be accepted.", loading: "Adding friend…", done: "Done 🎉", success: "The users are now friends.", profile: "Back to profile", error: "Something went wrong", back: "Back" },
  pl: { missing: "Brakuje identyfikatora zaproszenia.", failed: "Nie udało się zaakceptować zaproszenia.", loading: "Dodawanie znajomego…", done: "Gotowe 🎉", success: "Użytkownicy zostali dodani do znajomych.", profile: "Wróć do profilu", error: "Coś poszło nie tak", back: "Wstecz" },
  de: { missing: "Die Einladungs-ID fehlt.", failed: "Die Einladung konnte nicht angenommen werden.", loading: "Freund wird hinzugefügt…", done: "Fertig 🎉", success: "Die Benutzer sind jetzt Freunde.", profile: "Zurück zum Profil", error: "Etwas ist schiefgelaufen", back: "Zurück" },
};

export default function FriendInviteAcceptScreen() {
  const { inviteId } = useLocalSearchParams<{ inviteId?: string }>();
  const router = useRouter();
  const { UI } = useTheme();
  const { lang } = useI18n();
  const tx = FRIEND_INVITE_STRINGS[lang];

  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [errMsg, setErrMsg] = useState<string>("");

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const id = String(inviteId ?? "").trim();
        if (!id) throw new Error(tx.missing);
        await redeemInviteToken(id);
        if (!mounted) return;
        setState("ok");
      } catch (e: any) {
        if (!mounted) return;
        setState("error");
        setErrMsg(String(e?.message ?? tx.failed));
      }
    })();

    return () => {
      mounted = false;
    };
  }, [inviteId, tx.failed, tx.missing]);

  return (
    <View style={{ flex: 1, backgroundColor: UI.bg, alignItems: "center", justifyContent: "center", padding: 18 }}>
      {state === "loading" && (
        <View style={{ alignItems: "center", gap: 12 }}>
          <ActivityIndicator />
          <Text style={{ color: UI.text, fontWeight: "900", textAlign: "center" }}>{tx.loading}</Text>
        </View>
      )}

      {state === "ok" && (
        <View style={{ alignItems: "center", gap: 12 }}>
          <Text style={{ color: UI.text, fontWeight: "900", textAlign: "center", fontSize: 18 }}>{tx.done}</Text>
          <Text style={{ color: UI.sub, fontWeight: "800", textAlign: "center" }}>{tx.success}</Text>

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
            <Text style={{ color: "#0B1220", fontWeight: "900" }}>{tx.profile}</Text>
          </Pressable>
        </View>
      )}

      {state === "error" && (
        <View style={{ alignItems: "center", gap: 12 }}>
          <Text style={{ color: UI.text, fontWeight: "900", textAlign: "center", fontSize: 18 }}>{tx.error}</Text>
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
            <Text style={{ color: "#0B1220", fontWeight: "900" }}>{tx.back}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
