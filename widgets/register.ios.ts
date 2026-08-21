type StopRegistration = () => void;

let activeStop: StopRegistration | null = null;

/**
 * Start iOS widget synchronization only after the React tree has mounted.
 * Android keeps its native widget task registration in register.android.ts;
 * iOS has no background JS entry point that must run before Expo Router.
 */
export function startIosWidgetRegistration(): StopRegistration {
  if (activeStop) return activeStop;

  let stopped = false;
  let removeAuthListener: StopRegistration | undefined;
  let removeAppStateListener: StopRegistration | undefined;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    removeAuthListener?.();
    removeAppStateListener?.();
    if (activeStop === stop) activeStop = null;
  };
  activeStop = stop;

  void (async () => {
    const [{ AppState }, { onAuthStateChanged }, { auth }, { syncIosWidgetState }] =
      await Promise.all([
        import("react-native"),
        import("firebase/auth"),
        import("../lib/firebase"),
        import("../lib/iosWidgetService"),
      ]);
    if (stopped) return;

    let authReady = false;
    const requestWidgetSync = () => {
      if (!stopped && authReady) void syncIosWidgetState().catch(() => {});
    };

    removeAuthListener = onAuthStateChanged(auth, requestWidgetSync);
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") requestWidgetSync();
    });
    removeAppStateListener = () => appStateSubscription.remove();

    try {
      await auth.authStateReady();
    } catch {}
    if (stopped) return;
    authReady = true;
    requestWidgetSync();
  })().catch(() => stop());

  return stop;
}
