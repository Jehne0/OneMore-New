import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";

export async function registerPushTokenForCurrentUser() {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;

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

  if (finalStatus !== "granted") {
    return null;
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    console.log("Missing EAS projectId for push token");
    return null;
  }

  const tokenResult = await Notifications.getExpoPushTokenAsync({
    projectId,
  });

  const token = tokenResult.data;

  await setDoc(
    doc(db, "users", uid),
    {
      expoPushToken: token,
      pushTokenPlatform: Platform.OS,
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
}