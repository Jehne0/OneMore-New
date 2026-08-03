import { AppState } from "react-native";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../lib/firebase";
import { syncIosWidgetState } from "../lib/iosWidgetService";

let authReady = false;
void auth.authStateReady().finally(() => { authReady = true; void syncIosWidgetState(); });
onAuthStateChanged(auth, () => { if (authReady) void syncIosWidgetState(); });
AppState.addEventListener("change", (state) => { if (state === "active" && authReady) void syncIosWidgetState(); });
