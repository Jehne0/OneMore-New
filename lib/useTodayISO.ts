import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { getTodayISO, subscribeClock } from "./clock";

export function useTodayISO(): string {
  const [today, setToday] = useState(getTodayISO());
  const todayRef = useRef(today);
  todayRef.current = today;

  useEffect(() => {
    const unsubscribe = subscribeClock(() => setToday(getTodayISO()));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";

    const scheduleMidnight = () => {
      if (timer) clearTimeout(timer);
      const next = new Date();
      next.setHours(24, 0, 0, 50);
      timer = setTimeout(() => {
        setToday(getTodayISO());
        timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
        scheduleMidnight();
      }, Math.max(50, next.getTime() - Date.now()));
    };
    const refreshForCurrentZone = () => {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
      setToday(getTodayISO());
      scheduleMidnight();
    };

    scheduleMidnight();
    const appStateSubscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") refreshForCurrentZone();
    });
    const zonePoll = setInterval(() => {
      const currentTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
      if (currentTimeZone !== timeZone || getTodayISO() !== todayRef.current) {
        refreshForCurrentZone();
      }
    }, 30_000);

    return () => {
      unsubscribe();
      appStateSubscription.remove();
      clearInterval(zonePoll);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return today;
}
