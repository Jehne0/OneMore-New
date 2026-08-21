import { AppState } from "react-native";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../lib/firebase";
import { syncIosWidgetState } from "../lib/iosWidgetService";

let authReady = false;

function requestWidgetSync(): void {
  void syncIosWidgetState().catch(() => {});
}

void (async () => {
  try {
    await auth.authStateReady();
  } catch {}
  authReady = true;
  requestWidgetSync();
})();

onAuthStateChanged(auth, () => {
  if (authReady) requestWidgetSync();
});
AppState.addEventListener("change", (state) => {
  if (state === "active" && authReady) requestWidgetSync();
});
