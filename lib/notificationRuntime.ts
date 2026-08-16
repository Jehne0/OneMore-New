import type { NotificationTriggerInput, SchedulableNotificationTriggerInput } from "expo-notifications";

export type NotificationSavePhase =
  | "auth"
  | "state"
  | "recovery"
  | "prepare"
  | "triggerValidation"
  | "permission"
  | "channel"
  | "journal"
  | "schedule"
  | "persist"
  | "cleanup"
  | "complete";

export type NotificationPermissionState = "granted" | "denied" | "undetermined";

export type NotificationFailurePhase =
  | "AUTH"
  | "STATE"
  | "RECOVERY"
  | "PREPARE"
  | "PREFLIGHT"
  | "PERMISSION"
  | "CHANNEL"
  | "JOURNAL"
  | "SCHEDULE"
  | "PERSIST"
  | "CLEANUP"
  | "UNKNOWN";

export type NotificationFailureDetails = {
  phase: NotificationFailurePhase;
  name: string;
  code?: string;
  message: string;
};

const FAILURE_DETAILS_KEY = "notificationFailureDetails";

const FAILURE_PHASES: Record<NotificationSavePhase, NotificationFailurePhase> = {
  auth: "AUTH",
  state: "STATE",
  recovery: "RECOVERY",
  prepare: "PREPARE",
  triggerValidation: "PREFLIGHT",
  permission: "PERMISSION",
  channel: "CHANNEL",
  journal: "JOURNAL",
  schedule: "SCHEDULE",
  persist: "PERSIST",
  cleanup: "CLEANUP",
  complete: "UNKNOWN",
};

export type ReminderPermissionResult = {
  granted: boolean;
  status: NotificationPermissionState;
  canAskAgain: boolean;
  channelId?: string;
};

export type NotificationDiagnostic = {
  phase: NotificationSavePhase;
  period?: string;
  platform: string;
  challengeId: string;
  isNewChallenge?: boolean;
  permission?: NotificationPermissionState;
  channelId?: string;
  trigger?: Record<string, unknown>;
  error?: {
    name: string;
    code?: string;
    message: string;
    stack?: string;
  };
};

const ALLOWED_TRIGGER_KEYS: Record<string, Set<string>> = {
  date: new Set(["type", "date", "channelId"]),
  daily: new Set(["type", "hour", "minute", "channelId"]),
};

function invalidTrigger(message: string): never {
  const error = new TypeError(`NOTIFICATIONS_INVALID_TRIGGER: ${message}`);
  (error as TypeError & { code?: string }).code = "NOTIFICATIONS_INVALID_TRIGGER";
  throw error;
}

function finiteInteger(value: unknown, minimum: number, maximum: number, field: string): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    invalidTrigger(`${field} must be an integer from ${minimum} to ${maximum}`);
  }
  return Number(value);
}

function validateChannel(platform: string, value: unknown): string | undefined {
  if (platform === "ios" && value !== undefined) invalidTrigger("channelId is Android-only");
  if (platform !== "android") return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    invalidTrigger("Android trigger requires a non-empty channelId");
  }
  return value;
}

/** Validates the exact trigger object that is subsequently passed to Expo SDK 54. */
export function validateExpoNotificationTrigger(
  value: unknown,
  platform: string,
  now = new Date(),
): SchedulableNotificationTriggerInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalidTrigger("trigger must be an object");
  }
  const trigger = value as Record<string, unknown>;
  const type = trigger.type;
  if (type !== "date" && type !== "daily") invalidTrigger("unsupported or missing type");
  const allowed = ALLOWED_TRIGGER_KEYS[type];
  const unexpected = Object.keys(trigger).filter((key) => !allowed.has(key));
  if (unexpected.length) invalidTrigger(`unexpected field(s): ${unexpected.join(", ")}`);
  if (Object.values(trigger).some((item) => item === undefined)) invalidTrigger("undefined field");
  const channelId = validateChannel(platform, trigger.channelId);

  if (type === "daily") {
    const hour = finiteInteger(trigger.hour, 0, 23, "hour");
    const minute = finiteInteger(trigger.minute, 0, 59, "minute");
    return (platform === "android"
      ? { type: "daily" as const, hour, minute, channelId: channelId! }
      : { type: "daily" as const, hour, minute }) as unknown as SchedulableNotificationTriggerInput;
  }

  if (!(trigger.date instanceof Date) && typeof trigger.date !== "number") {
    invalidTrigger("date must be a Date or timestamp");
  }
  const timestamp = trigger.date instanceof Date ? trigger.date.getTime() : trigger.date;
  if (!Number.isFinite(timestamp)) invalidTrigger("date must be valid");
  if (Number(timestamp) <= now.getTime()) invalidTrigger("date must be in the future");
  const date = new Date(Number(timestamp));
  return (platform === "android"
    ? { type: "date" as const, date, channelId: channelId! }
    : { type: "date" as const, date }) as unknown as SchedulableNotificationTriggerInput;
}

export function sanitizeNotificationTrigger(trigger: NotificationTriggerInput): Record<string, unknown> {
  if (!trigger || typeof trigger !== "object") return { type: "immediate" };
  const value = trigger as unknown as Record<string, unknown>;
  const date = value.date instanceof Date ? value.date.toISOString() : value.date;
  return Object.fromEntries(Object.entries({ ...value, date }).filter(([, item]) => item !== undefined));
}

export function notificationError(error: unknown) {
  const value = error instanceof Error ? error : new Error(String(error));
  const codeValue = (error as { code?: unknown } | null)?.code;
  return {
    name: value.name || "Error",
    ...(codeValue == null ? {} : { code: String(codeValue) }),
    message: value.message || String(error),
    ...(value.stack ? { stack: value.stack } : {}),
  };
}

function sanitizeDiagnosticText(value: unknown): string {
  return String(value ?? "Unknown notification error")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[redacted-id]")
    .replace(/\b[A-Za-z0-9_-]{12,}:[A-Za-z0-9_-]{4,}:[A-Za-z0-9_.-]{4,}\b/g, "[redacted-operation]")
    .slice(0, 240);
}

export function attachNotificationFailure(
  error: unknown,
  phase: NotificationSavePhase | NotificationFailurePhase,
): Error {
  const value = error instanceof Error ? error : new Error(String(error));
  const existing = (value as Error & { [FAILURE_DETAILS_KEY]?: NotificationFailureDetails })[FAILURE_DETAILS_KEY];
  if (existing) return value;
  const rawCode = (error as { code?: unknown } | null)?.code;
  const details: NotificationFailureDetails = {
    phase: phase in FAILURE_PHASES
      ? FAILURE_PHASES[phase as NotificationSavePhase]
      : phase as NotificationFailurePhase,
    name: sanitizeDiagnosticText(value.name || "Error"),
    ...(rawCode == null ? {} : { code: sanitizeDiagnosticText(rawCode) }),
    message: sanitizeDiagnosticText(value.message),
  };
  try {
    Object.defineProperty(value, FAILURE_DETAILS_KEY, { value: details, enumerable: false });
    return value;
  } catch {
    const wrapped = new Error(value.message);
    (wrapped as Error & { [FAILURE_DETAILS_KEY]?: NotificationFailureDetails })[FAILURE_DETAILS_KEY] = details;
    return wrapped;
  }
}

export function getNotificationFailureDetails(error: unknown): NotificationFailureDetails {
  const value = error instanceof Error ? error : new Error(String(error));
  return (value as Error & { [FAILURE_DETAILS_KEY]?: NotificationFailureDetails })[FAILURE_DETAILS_KEY] ?? {
    phase: "UNKNOWN",
    name: sanitizeDiagnosticText(value.name || "Error"),
    ...((error as { code?: unknown } | null)?.code == null
      ? {}
      : { code: sanitizeDiagnosticText((error as { code?: unknown }).code) }),
    message: sanitizeDiagnosticText(value.message),
  };
}

export function formatNotificationFailureDetails(error: unknown): string {
  const details = getNotificationFailureDetails(error);
  return [
    "OneMore notification diagnostics",
    `Phase: ${details.phase}`,
    `Error: ${details.name}`,
    ...(details.code ? [`Code: ${details.code}`] : []),
    `Message: ${details.message}`,
  ].join("\n");
}

export function logNotificationDiagnostic(value: NotificationDiagnostic): void {
  if (!__DEV__) return;
  if (value.error) console.error("[PersonalReminders]", value);
  else console.log("[PersonalReminders]", value);
}

export async function waitForReminderAuthUser(
  authInstance: { authStateReady(): Promise<void>; currentUser: { uid?: string } | null },
  timeoutMs = 10_000,
): Promise<{ uid: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      authInstance.authStateReady(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("NOTIFICATION_AUTH_TIMEOUT")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  const uid = String(authInstance.currentUser?.uid ?? "");
  if (!uid) throw new Error("NOTIFICATION_UID_REQUIRED");
  return { uid };
}
