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
