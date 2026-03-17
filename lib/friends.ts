import { collection, doc, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "./firebase";

export type FriendStatus = "pending" | "accepted" | "blocked";

export type FriendEdge = {
  otherUid: string;
  status: FriendStatus;
  initiatedBy: string;
  createdAt?: any;
  updatedAt?: any;
};

function myUid() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Nejsi přihlášený.");
  return uid;
}

function edgeRef(uid: string, otherUid: string) {
  return doc(db, "friends", uid, "list", otherUid);
}

export async function sendFriendRequest(otherUid: string) {
  myUid();
  const call = httpsCallable(functions, "requestFriend");
  await call({ otherUid });
}

export async function acceptFriend(otherUid: string) {
  myUid();
  const call = httpsCallable(functions, "acceptFriend");
  await call({ otherUid });
}

export async function declineFriend(otherUid: string) {
  myUid();
  const call = httpsCallable(functions, "declineFriend");
  await call({ otherUid });
}

export async function removeFriend(otherUid: string) {
  // same as decline
  return declineFriend(otherUid);
}

export async function blockUser(otherUid: string) {
  myUid();
  const call = httpsCallable(functions, "blockFriend");
  await call({ otherUid });
}

export function subscribeFriends(onEdges: (edges: FriendEdge[]) => void, onError?: (e: any) => void): Unsubscribe {
  const uid = myUid();
  const col = collection(db, "friends", uid, "list");
  return onSnapshot(
    col,
    (snap) => {
      const edges: FriendEdge[] = [];
      snap.forEach((d) => {
        const data = d.data() as any;
        edges.push({ otherUid: d.id, status: data.status, initiatedBy: data.initiatedBy, createdAt: data.createdAt, updatedAt: data.updatedAt });
      });
      // stable order
      edges.sort((a, b) => (a.otherUid < b.otherUid ? -1 : 1));
      onEdges(edges);
    },
    (err) => onError?.(err)
  );
}
