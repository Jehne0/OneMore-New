import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyBbzyKF-7mc_o4Cc7WRMhhYcXMb9rz6JsQ",
  authDomain: "onemore-ca918.firebaseapp.com",
  projectId: "onemore-ca918",
  storageBucket: "onemore-ca918.firebasestorage.app",
  messagingSenderId: "1082535851082",
  appId: "1:1082535851082:web:fed0a9d0820ed024cb22b3",
  measurementId: "G-7F8W07QVSS",
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);

export const db = getFirestore(app);
export const functions = getFunctions(app, "europe-west1");