import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

// NOTE: používáme expo-av. Pokud přidáš tenhle soubor do projektu poprvé,
// ujisti se, že máš nainstalované: npx expo install expo-av
import { Audio } from "expo-av";

const KEY_SOUND_ENABLED = "onemore_sound_enabled";

export async function getSoundEnabled(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(KEY_SOUND_ENABLED);
    if (v == null) return true; // default: ON
    return v === "1" || v === "true";
  } catch {
    return true;
  }
}

export async function setSoundEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_SOUND_ENABLED, enabled ? "1" : "0");
  } catch {
    // ignore
  }
}

export function useSoundEnabled(): [boolean, (v: boolean) => void] {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let mounted = true;
    getSoundEnabled().then((v) => mounted && setEnabled(v));
    return () => {
      mounted = false;
    };
  }, []);

  const set = (v: boolean) => {
    setEnabled(v);
    void setSoundEnabled(v);
  };

  return [enabled, set];
}

let cached: Audio.Sound | null = null;

async function getOrCreateSound(): Promise<Audio.Sound> {
  if (cached) return cached;
  const { sound } = await Audio.Sound.createAsync(
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("../assets/sfx/success.wav"),
    { shouldPlay: false }
  );
  cached = sound;
  return sound;
}

export async function playSuccessIfEnabled(): Promise<void> {
  const enabled = await getSoundEnabled();
  if (!enabled) return;

  try {
    const sound = await getOrCreateSound();
    await sound.setPositionAsync(0);
    await sound.playAsync();
  } catch {
    // ignore – zvuk nesmí nikdy rozbít flow
  }
}
