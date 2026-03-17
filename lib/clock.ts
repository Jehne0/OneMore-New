import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

const DEBUG_TODAY_KEY = "onemore_debug_today"; // "YYYY-MM-DD"

let cachedDebugToday: string | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {}
  });
}

function realTodayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function initClock() {
  cachedDebugToday = await AsyncStorage.getItem(DEBUG_TODAY_KEY);
  notify();
}

export function getTodayISO(): string {
  return cachedDebugToday ?? realTodayISO();
}

export function subscribeClock(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function setDebugTodayISO(iso: string) {
  await AsyncStorage.setItem(DEBUG_TODAY_KEY, iso);
  cachedDebugToday = iso;
  notify();
}

export async function clearDebugTodayISO() {
  await AsyncStorage.removeItem(DEBUG_TODAY_KEY);
  cachedDebugToday = null;
  notify();
}

export function useTodayISO(): string {
  const [today, setToday] = useState(getTodayISO());

  useEffect(() => {
    return subscribeClock(() => setToday(getTodayISO()));
  }, []);

  return today;
}
