import { doc, getDoc, runTransaction, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./firebase";

export type UserProfile = {
  uid: string;
  username: string;
  usernameLower: string;
  createdAt?: any;
  updatedAt?: any;
};

function stripDiacritics(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function norm(username: string) {
  return stripDiacritics(username).trim().toLowerCase();
}

export async function claimUsername(uid: string, username: string) {
  const usernameTrim = username.trim();
  const usernameLower = norm(usernameTrim);

  if (!usernameTrim) throw new Error("Username je prázdné.");
  if (usernameTrim.length < 3) throw new Error("Username je moc krátké (min. 3 znaky).");
  if (usernameTrim.length > 20) throw new Error("Username je moc dlouhé (max. 20 znaků).");

  if (!/^[a-z0-9._-]+$/.test(usernameLower)) {
    throw new Error("Username může obsahovat písmena/čísla, tečku, podtržítko a pomlčku. Diakritika je povolená. Pozor na mezeru za svým jménem :)");
  }

  const unameRef = doc(db, "usernames", usernameLower);
  const userRef = doc(db, "users", uid);
  const publicProfileRef = doc(db, "publicProfiles", uid);

  await runTransaction(db, async (tx) => {
    const existing = await tx.get(unameRef);
    if (existing.exists() && existing.data()?.uid !== uid) {
      throw new Error("Tohle uživatelské jméno je už obsazené.");
    }

    const userSnap = await tx.get(userRef);
    const alreadyCreatedAt = userSnap.exists() ? userSnap.data()?.profile?.createdAt : null;

    tx.set(
      unameRef,
      {
        uid,
        usernameLower,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(
      userRef,
      {
        profile: {
          uid,
          username: usernameTrim,
          usernameLower,
          updatedAt: serverTimestamp(),
          ...(alreadyCreatedAt ? {} : { createdAt: serverTimestamp() }),
        },
      },
      { merge: true }
    );

    tx.set(
      publicProfileRef,
      {
        uid,
        username: usernameTrim,
        usernameLower,
        updatedAt: serverTimestamp(),
        ...(alreadyCreatedAt ? {} : { createdAt: serverTimestamp() }),
      },
      { merge: true }
    );
  });
}

export async function resolveUidByUsername(username: string): Promise<string | null> {
  const usernameLower = norm(username);
  if (!usernameLower) return null;

  const snap = await getDoc(doc(db, "usernames", usernameLower));
  if (!snap.exists()) return null;

  const uid = snap.data()?.uid;
  return typeof uid === "string" ? uid : null;
}

export async function getProfile(uid: string): Promise<UserProfile | null> {
  const publicSnap = await getDoc(doc(db, "publicProfiles", uid));

  if (publicSnap.exists()) {
    const p = publicSnap.data();

    return {
      uid,
      username: p.username ?? uid,
      usernameLower: p.usernameLower ?? "",
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }

  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;

  const data = snap.data();
  const p = data?.profile;

  if (!p) return null;

  return {
    uid,
    username: p.username ?? uid,
    usernameLower: p.usernameLower ?? "",
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function getMyUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Nejsi přihlášený.");
  return uid;
}

export async function changeUsername(uid: string, newUsername: string) {
  const newTrim = newUsername.trim();
  const newLower = norm(newTrim);

  if (!newTrim) throw new Error("Username je prázdné.");
  if (newTrim.length < 3) throw new Error("Username je moc krátké (min. 3 znaky).");
  if (newTrim.length > 20) throw new Error("Username je moc dlouhé (max. 20 znaků).");

  if (!/^[a-z0-9._-]+$/.test(newLower)) {
    throw new Error("Username může obsahovat písmena/čísla, tečku, podtržítko a pomlčku.");
  }

  const userRef = doc(db, "users", uid);
  const newUnameRef = doc(db, "usernames", newLower);
  const publicProfileRef = doc(db, "publicProfiles", uid);

  await runTransaction(db, async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists()) throw new Error("Profil neexistuje.");

    const profile = userSnap.data()?.profile;
    const oldLower = profile?.usernameLower;

    if (oldLower === newLower) return;

    const newSnap = await tx.get(newUnameRef);
    if (newSnap.exists() && newSnap.data()?.uid !== uid) {
      throw new Error("Tohle uživatelské jméno je už obsazené.");
    }

    if (oldLower) {
      const oldUnameRef = doc(db, "usernames", oldLower);
      tx.delete(oldUnameRef);
    }

    tx.set(newUnameRef, {
      uid,
      usernameLower: newLower,
      updatedAt: serverTimestamp(),
    });

    tx.set(
      userRef,
      {
        profile: {
          ...profile,
          username: newTrim,
          usernameLower: newLower,
          updatedAt: serverTimestamp(),
        },
      },
      { merge: true }
    );

    tx.set(
      publicProfileRef,
      {
        uid,
        username: newTrim,
        usernameLower: newLower,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });
}