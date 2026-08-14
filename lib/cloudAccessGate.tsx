import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";

import { auth } from "./firebase";

export type CloudAccessStatus = "verified" | "updateRequired" | "unverified";

type CloudAccessContextValue = {
  status: CloudAccessStatus;
  allowed: boolean;
  sessionEpoch: number;
};

let runtimeStatus: CloudAccessStatus = "unverified";
let runtimeStatusRevision = 0;
let runtimeSessionRevision = 0;

export type VerifiedCloudAccessLease = Readonly<{
  statusRevision: number;
  sessionRevision: number;
}>;

export function setCloudAccessStatus(status: CloudAccessStatus): void {
  if (runtimeStatus !== status) runtimeStatusRevision += 1;
  runtimeStatus = status;
}

export function getCloudAccessStatus(): CloudAccessStatus {
  return runtimeStatus;
}

export function isCloudAccessVerified(): boolean {
  return runtimeStatus === "verified";
}

export function assertCloudAccessVerified(): void {
  if (!isCloudAccessVerified()) throw new Error("CLOUD_ACCESS_UNVERIFIED");
}

export function captureVerifiedCloudAccessLease(): VerifiedCloudAccessLease {
  assertCloudAccessVerified();
  return {
    statusRevision: runtimeStatusRevision,
    sessionRevision: runtimeSessionRevision,
  };
}

export function assertVerifiedCloudAccessLease(
  lease: VerifiedCloudAccessLease,
): void {
  assertCloudAccessVerified();
  if (
    lease.statusRevision !== runtimeStatusRevision ||
    lease.sessionRevision !== runtimeSessionRevision
  ) {
    throw new Error("CLOUD_ACCESS_STALE_SESSION");
  }
}

const CloudAccessContext = createContext<CloudAccessContextValue>({
  status: "unverified",
  allowed: false,
  sessionEpoch: 0,
});

export function CloudAccessProvider({
  status,
  children,
}: {
  status: CloudAccessStatus;
  children: React.ReactNode;
}) {
  // Keep imperative cloud entry points and React effects on the same decision.
  setCloudAccessStatus(status);
  const [sessionEpoch, setSessionEpoch] = useState(0);

  useEffect(() => onAuthStateChanged(auth, () => {
    runtimeSessionRevision += 1;
    setSessionEpoch((value) => value + 1);
  }), []);

  const value = useMemo<CloudAccessContextValue>(() => ({
    status,
    allowed: status === "verified",
    sessionEpoch,
  }), [sessionEpoch, status]);

  return <CloudAccessContext.Provider value={value}>{children}</CloudAccessContext.Provider>;
}

export function useCloudAccess(): CloudAccessContextValue {
  return useContext(CloudAccessContext);
}
