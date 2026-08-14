import type { CloudAccessStatus } from "./cloudAccessGate";
import type { VersionCheckDecision } from "./versionCheck";

export function versionDecisionAllowsCloudSync(decision: VersionCheckDecision): boolean {
  return decision.status === "verified";
}

export type VersionGateController = {
  verify(): Promise<VersionCheckDecision>;
  currentStatus(): CloudAccessStatus;
};

/** Coalesces concurrent checks and starts cloud exactly once after verification. */
export function createVersionGateController(options: {
  check(): Promise<VersionCheckDecision>;
  onDecision(decision: VersionCheckDecision): void;
  startCloudSync(): void;
  isCancelled?: () => boolean;
}): VersionGateController {
  let status: CloudAccessStatus = "unverified";
  let cloudStarted = false;
  let inFlight: Promise<VersionCheckDecision> | null = null;

  const verify = (): Promise<VersionCheckDecision> => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      let decision: VersionCheckDecision;
      try {
        decision = await options.check();
      } catch {
        decision = { status: "unverified" };
      }
      if (options.isCancelled?.()) return decision;
      status = decision.status;
      options.onDecision(decision);
      if (versionDecisionAllowsCloudSync(decision) && !cloudStarted) {
        cloudStarted = true;
        options.startCloudSync();
      }
      return decision;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  return { verify, currentStatus: () => status };
}
