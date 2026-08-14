import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import { isCloudAccessVerified } from "./cloudAccessGate";

export async function registerPushTokenForCurrentUser() {
  if (!isCloudAccessVerified()) return null;
  const uid = auth.currentUser?.uid;
  if (!uid) return null;

  const userRef = doc(db, "users", uid);

  try {
    await setDoc(
      userRef,
      {
        pushTokenStatus: "started",
        pushTokenPlatform: Platform.OS,
        pushTokenUpdatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Default",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#ff7a00",
      });
    }

    const permission = await Notifications.getPermissionsAsync();
    let finalStatus = permission.status;

    if (finalStatus !== "granted") {
      const request = await Notifications.requestPermissionsAsync();
      finalStatus = request.status;
    }

    await setDoc(
      userRef,
      {
        pushTokenPermission: finalStatus,
        pushTokenUpdatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    if (finalStatus !== "granted") {
      await setDoc(
        userRef,
        {
          pushTokenStatus: "permission_denied",
          pushTokenUpdatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      return null;
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    await setDoc(
      userRef,
      {
        pushTokenProjectId: projectId ?? null,
        pushTokenUpdatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    if (!projectId) {
      await setDoc(
        userRef,
        {
          pushTokenStatus: "missing_project_id",
          pushTokenUpdatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      return null;
    }

    const tokenResult = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    const token = tokenResult.data;

    await setDoc(
      userRef,
      {
        expoPushToken: token,
        pushTokenPlatform: Platform.OS,
        pushTokenStatus: "saved",
        pushTokenUpdatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    await setDoc(
      doc(db, "users", uid, "pushTokens", token),
      {
        token,
        platform: Platform.OS,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return token;
  } catch (e: any) {
    await setDoc(
      userRef,
      {
        pushTokenStatus: "error",
        pushTokenError: String(e?.message ?? e),
        pushTokenUpdatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return null;
  }
}
