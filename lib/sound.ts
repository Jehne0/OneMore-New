import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

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

let cached: import("expo-audio").AudioPlayer | null = null;

async function getOrCreateSound(): Promise<import("expo-audio").AudioPlayer> {
  if (cached) return cached;
  const { createAudioPlayer } = await import("expo-audio");
  cached = createAudioPlayer(
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require("../assets/sfx/success.wav"),
  );
  return cached;
}

export async function playSuccessIfEnabled(): Promise<void> {
  const enabled = await getSoundEnabled();
  if (!enabled) return;

  try {
    const sound = await getOrCreateSound();
    await sound.seekTo(0);
    sound.play();
  } catch {
    // ignore – zvuk nesmí nikdy rozbít flow
  }
}
