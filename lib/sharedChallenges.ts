import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { auth, db } from "./firebase";

export type SharedChallengePeriod = "daily" | "every2" | "custom";
export type SharedChallengeStatus = "pending" | "active" | "declined";

export const MAX_SHARED_MEMBERS = 10; // včetně mě

export type SharedChallenge = {
  id: string;
  title: string;
  createdBy: string;
  memberUids: string[];
  targetPerDay: number;
  period: SharedChallengePeriod;
  customDays: number[];
  periodAnchor?: string | null;
  enabled: boolean;
  status: SharedChallengeStatus;
  acceptedBy: string[];
  leftBy?: string[];
  createdAt?: any;
  updatedAt?: any;
};

export type SharedChallengeCreateInput = {
  title: string;
  friendUids: string[];
  targetPerDay?: number;
  period?: SharedChallengePeriod;
  customDays?: number[];
  periodAnchor?: string | null;
};

export type SharedChallengeUserDayProgress = {
  completedCount: number;
  completed: boolean;
  updatedAt?: any;
};

export type SharedChallengeDayProgress = {
  date: string;
  users: Record<string, SharedChallengeUserDayProgress>;
  updatedAt?: any;
};

function myUid() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Nejsi přihlášený.");
  return uid;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function ensureISODate(value?: string | null) {
  if (typeof value !== "string") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function dedupeDays(days?: number[]) {
  const safe = Array.isArray(days)
    ? days
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= 6)
        .map((n) => Math.floor(n))
    : [];

  return Array.from(new Set(safe)).sort((a, b) => a - b);
}

function dedupeMemberUids(input: string[], me: string) {
  const safe = Array.isArray(input)
    ? input
        .map((x) => String(x ?? "").trim())
        .filter(Boolean)
        .filter((x) => x !== me)
    : [];

  const uniqueFriends = Array.from(new Set(safe)).slice(0, MAX_SHARED_MEMBERS - 1);
  return [me, ...uniqueFriends];
}

export function getTodayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 0=Po ... 6=Ne
export function dowMon0(dateISO: string): number {
  const d = new Date(`${dateISO}T00:00:00`);
  const js = d.getDay(); // 0=Ne..6=So
  return (js + 6) % 7;
}

export function diffDaysISO(aISO: string, bISO: string): number {
  const a = new Date(`${aISO}T00:00:00`).getTime();
  const b = new Date(`${bISO}T00:00:00`).getTime();
  return Math.floor((a - b) / 86400000);
}

export function isSharedChallengeActiveOnDate(
  challenge: Pick<SharedChallenge, "enabled" | "period" | "customDays" | "periodAnchor" | "status">,
  dateISO: string
): boolean {
  if (!challenge) return false;
  if (challenge.enabled === false) return false;
  if (challenge.status !== "active") return false;

  const period: SharedChallengePeriod =
    challenge.period === "every2" || challenge.period === "custom"
      ? challenge.period
      : "daily";

  if (period === "daily") return true;

  if (period === "every2") {
    const anchor = ensureISODate(challenge.periodAnchor) ?? dateISO;
    const diff = diffDaysISO(dateISO, anchor);
    return Math.abs(diff) % 2 === 0;
  }

  const days = dedupeDays(challenge.customDays);
  const dow = dowMon0(dateISO);
  return days.includes(dow);
}

export async function createSharedChallenge(input: SharedChallengeCreateInput) {
  const uid = myUid();

  const title = String(input.title ?? "").trim();
  if (!title) throw new Error("Zadej název výzvy.");

  const friendUidsRaw = Array.isArray(input.friendUids) ? input.friendUids : [];
  const memberUids = dedupeMemberUids(friendUidsRaw, uid);

  if (memberUids.length < 2) {
    throw new Error("Vyber aspoň jednoho kamaráda.");
  }

  if (memberUids.length > MAX_SHARED_MEMBERS) {
    throw new Error(`Společná výzva může mít maximálně ${MAX_SHARED_MEMBERS} členů.`);
  }

  const targetPerDay = clamp(Number(input.targetPerDay ?? 1) || 1, 1, 20);

  const period: SharedChallengePeriod =
    input.period === "every2" || input.period === "custom" ? input.period : "daily";

  const customDays =
    period === "custom"
      ? dedupeDays(input.customDays).length
        ? dedupeDays(input.customDays)
        : [dowMon0(getTodayISO())]
      : [];

  const periodAnchor =
    period === "every2" ? ensureISODate(input.periodAnchor) ?? getTodayISO() : null;

  const ref = doc(collection(db, "sharedChallenges"));

  const payload: Omit<SharedChallenge, "id"> = {
    title,
    createdBy: uid,
    memberUids,
    targetPerDay,
    period,
    customDays,
    periodAnchor,
    enabled: true,
    status: "pending",
    acceptedBy: [uid],
    leftBy: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(ref, payload);

  return ref.id;
}

export async function acceptSharedChallenge(challengeId: string) {
  const uid = myUid();
  const challenge = await getSharedChallenge(challengeId);

  if (!challenge) throw new Error("Společná výzva nebyla nalezena.");
  if (!challenge.memberUids.includes(uid)) throw new Error("Do této výzvy nepatříš.");

  const acceptedBy = Array.from(new Set([...(challenge.acceptedBy ?? []), uid]));
  const everyoneAccepted = challenge.memberUids.every((memberUid) =>
    acceptedBy.includes(memberUid)
  );

  const leftBy = (challenge.leftBy ?? []).filter((memberUid) => memberUid !== uid);

  await updateDoc(doc(db, "sharedChallenges", String(challengeId)), {
    acceptedBy,
    leftBy,
    status: everyoneAccepted ? "active" : "pending",
    updatedAt: serverTimestamp(),
  });
}

export async function declineSharedChallenge(challengeId: string) {
  const uid = myUid();
  const challenge = await getSharedChallenge(challengeId);

  if (!challenge) throw new Error("Společná výzva nebyla nalezena.");
  if (!challenge.memberUids.includes(uid)) throw new Error("Do této výzvy nepatříš.");

  const nextMemberUids = challenge.memberUids.filter((memberUid) => memberUid !== uid);
  const nextAcceptedBy = (challenge.acceptedBy ?? []).filter((memberUid) => memberUid !== uid);
 const nextLeftBy = Array.from(new Set([...(challenge.leftBy ?? []), uid]));

  const ref = doc(db, "sharedChallenges", String(challengeId));

  if (nextMemberUids.length < 2) {
    await updateDoc(ref, {
      memberUids: nextMemberUids,
      acceptedBy: nextAcceptedBy,
      leftBy: nextLeftBy,
      enabled: false,
      status: "declined",
      updatedAt: serverTimestamp(),
    });
    return;
  }

  await updateDoc(ref, {
    memberUids: nextMemberUids,
    acceptedBy: nextAcceptedBy,
    leftBy: nextLeftBy,
    updatedAt: serverTimestamp(),
  });
}

export async function leaveSharedChallenge(challengeId: string) {
  const uid = myUid();
  const challenge = await getSharedChallenge(challengeId);

  if (!challenge) throw new Error("Společná výzva nebyla nalezena.");
  if (!challenge.memberUids.includes(uid)) throw new Error("Do této výzvy nepatříš.");

  const nextMemberUids = challenge.memberUids.filter((memberUid) => memberUid !== uid);
  const nextAcceptedBy = (challenge.acceptedBy ?? []).filter((memberUid) => memberUid !== uid);
  const nextLeftBy = (challenge.leftBy ?? []).filter((memberUid) => memberUid !== uid);

  const ref = doc(db, "sharedChallenges", String(challengeId));

  if (nextMemberUids.length < 2) {
    await updateDoc(ref, {
      memberUids: nextMemberUids,
      acceptedBy: nextAcceptedBy,
      leftBy: nextLeftBy,
      enabled: false,
      status: "declined",
      updatedAt: serverTimestamp(),
    });
    return;
  }

  await updateDoc(ref, {
    memberUids: nextMemberUids,
    acceptedBy: nextAcceptedBy,
    leftBy: nextLeftBy,
    updatedAt: serverTimestamp(),
  });
}

export function subscribeSharedChallenges(
  onItems: (items: SharedChallenge[]) => void,
  onError?: (e: any) => void
): Unsubscribe {
  const uid = myUid();

  const q = query(
    collection(db, "sharedChallenges"),
    where("memberUids", "array-contains", uid)
  );

  return onSnapshot(
    q,
    (snap) => {
      const items: SharedChallenge[] = snap.docs
        .map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            title: String(data.title ?? ""),
            createdBy: String(data.createdBy ?? ""),
            memberUids: Array.isArray(data.memberUids)
              ? data.memberUids.map((x: any) => String(x))
              : [],
            targetPerDay: clamp(Number(data.targetPerDay ?? 1) || 1, 1, 20),
            period:
              data.period === "every2" || data.period === "custom"
                ? data.period
                : "daily",
            customDays: dedupeDays(data.customDays),
            periodAnchor: ensureISODate(data.periodAnchor),
            enabled: data.enabled !== false,
            status:
              data.status === "pending" || data.status === "declined"
                ? data.status
                : "active",
            acceptedBy: Array.isArray(data.acceptedBy)
              ? data.acceptedBy.map((x: any) => String(x))
              : [],
            leftBy: Array.isArray(data.leftBy)
              ? data.leftBy.map((x: any) => String(x))
              : [],
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          };
        })
        .filter((item) => !(item.leftBy ?? []).includes(uid));

      items.sort((a, b) => {
        const ta = a.createdAt?.seconds ?? 0;
        const tb = b.createdAt?.seconds ?? 0;
        return tb - ta;
      });

      onItems(items);
    },
    (err) => onError?.(err)
  );
}

export function subscribeSharedChallengeDay(
  challengeId: string,
  dateISO: string,
  onData: (data: SharedChallengeDayProgress | null) => void,
  onError?: (e: any) => void
): Unsubscribe {
  const ref = doc(db, "sharedChallenges", String(challengeId), "progress", String(dateISO));

  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }

      const data = snap.data() as any;
      const usersRaw = (data?.users ?? {}) as Record<string, any>;
      const users: Record<string, SharedChallengeUserDayProgress> = {};

      for (const [uid, value] of Object.entries(usersRaw)) {
        users[String(uid)] = {
          completedCount: Math.max(0, Math.floor(Number((value as any)?.completedCount ?? 0) || 0)),
          completed: !!(value as any)?.completed,
          updatedAt: (value as any)?.updatedAt,
        };
      }

      onData({
        date: String(data?.date ?? dateISO),
        users,
        updatedAt: data?.updatedAt,
      });
    },
    (err) => onError?.(err)
  );
}

export async function getSharedChallenge(challengeId: string): Promise<SharedChallenge | null> {
  const ref = doc(db, "sharedChallenges", String(challengeId));
  const snap = await getDoc(ref);

  if (!snap.exists()) return null;

  const data = snap.data() as any;
  return {
    id: snap.id,
    title: String(data.title ?? ""),
    createdBy: String(data.createdBy ?? ""),
    memberUids: Array.isArray(data.memberUids)
      ? data.memberUids.map((x: any) => String(x))
      : [],
    targetPerDay: clamp(Number(data.targetPerDay ?? 1) || 1, 1, 20),
    period:
      data.period === "every2" || data.period === "custom"
        ? data.period
        : "daily",
    customDays: dedupeDays(data.customDays),
    periodAnchor: ensureISODate(data.periodAnchor),
    enabled: data.enabled !== false,
    status:
      data.status === "pending" || data.status === "declined"
        ? data.status
        : "active",
    acceptedBy: Array.isArray(data.acceptedBy)
      ? data.acceptedBy.map((x: any) => String(x))
      : [],
    leftBy: Array.isArray(data.leftBy)
      ? data.leftBy.map((x: any) => String(x))
      : [],
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export async function completeSharedChallengeToday(
  challengeId: string,
  dateISO = getTodayISO()
) {
  const uid = myUid();

  const challengeRef = doc(db, "sharedChallenges", String(challengeId));
  const dayRef = doc(
    db,
    "sharedChallenges",
    String(challengeId),
    "progress",
    String(dateISO)
  );

  const nextCount = await runTransaction(db, async (tx) => {
    const challengeSnap = await tx.get(challengeRef);
    if (!challengeSnap.exists()) {
      throw new Error("Společná výzva nebyla nalezena.");
    }

    const challengeData = challengeSnap.data() as any;
    const challenge: SharedChallenge = {
      id: challengeSnap.id,
      title: String(challengeData.title ?? ""),
      createdBy: String(challengeData.createdBy ?? ""),
      memberUids: Array.isArray(challengeData.memberUids)
        ? challengeData.memberUids.map((x: any) => String(x))
        : [],
      targetPerDay: clamp(Number(challengeData.targetPerDay ?? 1) || 1, 1, 20),
      period:
        challengeData.period === "every2" || challengeData.period === "custom"
          ? challengeData.period
          : "daily",
      customDays: dedupeDays(challengeData.customDays),
      periodAnchor: ensureISODate(challengeData.periodAnchor),
      enabled: challengeData.enabled !== false,
      status:
        challengeData.status === "pending" || challengeData.status === "declined"
          ? challengeData.status
          : "active",
      acceptedBy: Array.isArray(challengeData.acceptedBy)
        ? challengeData.acceptedBy.map((x: any) => String(x))
        : [],
      createdAt: challengeData.createdAt,
      updatedAt: challengeData.updatedAt,
    };

    if (!challenge.memberUids.includes(uid)) {
      throw new Error("Do této výzvy nepatříš.");
    }

    if (challenge.status !== "active") {
      throw new Error("Tato společná výzva ještě nebyla přijata všemi členy.");
    }

    if (!isSharedChallengeActiveOnDate(challenge, dateISO)) {
      throw new Error("Dnes je podle periody volno.");
    }

    const daySnap = await tx.get(dayRef);
    const prevUsers = daySnap.exists() ? ((daySnap.data() as any)?.users ?? {}) : {};
    const mine = prevUsers?.[uid] ?? {};
    const prevCount = Math.max(
      0,
      Math.floor(Number(mine?.completedCount ?? 0) || 0)
    );

    const newCount = Math.min(challenge.targetPerDay, prevCount + 1);

    tx.set(
      dayRef,
      {
        date: String(dateISO),
        users: {
          [uid]: {
            completedCount: newCount,
            completed: newCount >= challenge.targetPerDay,
            updatedAt: serverTimestamp(),
          },
        },
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return newCount;
  });

  return nextCount;
}

export async function setSharedChallengeEnabled(challengeId: string, enabled: boolean) {
  const uid = myUid();
  const challenge = await getSharedChallenge(challengeId);

  if (!challenge) throw new Error("Společná výzva nebyla nalezena.");
  if (!challenge.memberUids.includes(uid)) throw new Error("Do této výzvy nepatříš.");

  await updateDoc(doc(db, "sharedChallenges", String(challengeId)), {
    enabled: !!enabled,
    updatedAt: serverTimestamp(),
  });
}

export function subscribeSharedChallengeProgress(
  challengeId: string,
  onItems: (items: SharedChallengeDayProgress[]) => void,
  onError?: (e: any) => void
): Unsubscribe {
  const col = collection(db, "sharedChallenges", String(challengeId), "progress");

  return onSnapshot(
    col,
    (snap) => {
      const items: SharedChallengeDayProgress[] = snap.docs.map((d) => {
        const data = d.data() as any;
        const usersRaw = (data?.users ?? {}) as Record<string, any>;
        const users: Record<string, SharedChallengeUserDayProgress> = {};

        for (const [uid, value] of Object.entries(usersRaw)) {
          users[String(uid)] = {
            completedCount: Math.max(
              0,
              Math.floor(Number((value as any)?.completedCount ?? 0) || 0)
            ),
            completed: !!(value as any)?.completed,
            updatedAt: (value as any)?.updatedAt,
          };
        }

        return {
          date: String(data?.date ?? d.id),
          users,
          updatedAt: data?.updatedAt,
        };
      });

      items.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      onItems(items);
    },
    (err) => onError?.(err)
  );
}