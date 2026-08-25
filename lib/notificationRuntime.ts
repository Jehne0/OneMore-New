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
  causeMessage?: string;
  platform?: string;
  triggerType?: string;
  soundType?: string;
};

export type NotificationFailureContext = Pick<
  NotificationFailureDetails,
  "platform" | "triggerType" | "soundType"
>;

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
  triggerType?: string;
  soundType?: string;
  error?: {
    name: string;
    code?: string;
    message: string;
    causeMessage?: string;
    stack?: string;
  };
};

const ALLOWED_CONTENT_KEYS = new Set([
  "title",
  "subtitle",
  "body",
  "sound",
  "data",
  "priority",
  "badge",
  "categoryIdentifier",
]);

function invalidContent(message: string): never {
  const error = new TypeError(`NOTIFICATIONS_INVALID_CONTENT: ${message}`);
  (error as TypeError & { code?: string }).code = "NOTIFICATIONS_INVALID_CONTENT";
  throw error;
}

function validateJsonPersistenceValue(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalidContent(`${path} must be a finite number`);
    return;
  }
  if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    invalidContent(`${path} contains unsupported ${typeof value}`);
  }
  if (typeof value !== "object") invalidContent(`${path} contains unsupported value`);
  if (value instanceof Date) invalidContent(`${path} must not contain Date`);
  if (ancestors.has(value)) invalidContent(`${path} must not contain a circular reference`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateJsonPersistenceValue(item, `${path}[${index}]`, ancestors));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      invalidContent(`${path} must contain only plain objects`);
    }
    for (const [key, item] of Object.entries(value)) {
      validateJsonPersistenceValue(item, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}

/** Audits the exact content object before it crosses the Expo native bridge. */
export function validateExpoNotificationContent(value: unknown, platform: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalidContent("content must be a plain object");
  }
  const content = value as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(content);
  if (prototype !== Object.prototype && prototype !== null) invalidContent("content must be a plain object");
  const unexpected = Object.keys(content).filter((key) => !ALLOWED_CONTENT_KEYS.has(key));
  if (unexpected.length) invalidContent(`unexpected field(s): ${unexpected.join(", ")}`);
  if (Object.values(content).some((item) => item === undefined)) invalidContent("undefined field");
  for (const key of ["title", "subtitle", "body", "categoryIdentifier"] as const) {
    if (content[key] !== undefined && typeof content[key] !== "string") invalidContent(`${key} must be a string`);
  }
  if (content.badge !== undefined && content.badge !== null && (
    typeof content.badge !== "number" || !Number.isFinite(content.badge)
  )) {
    invalidContent("badge must be a finite number or null");
  }
  if (content.priority !== undefined && typeof content.priority !== "string") invalidContent("priority must be a string");
  if (platform === "android" && typeof content.sound === "string") {
    invalidContent("Android string sound is unsafe for persistent scheduling");
  }
  if (content.sound !== undefined && typeof content.sound !== "boolean" && typeof content.sound !== "string") {
    invalidContent("sound must be boolean, string, or omitted");
  }
  if (content.data !== undefined) validateJsonPersistenceValue(content.data, "content.data", new Set());
}

const ALLOWED_TRIGGER_KEYS: Record<string, Set<string>> = {
  date: new Set(["type", "date", "channelId"]),
  daily: new Set(["type", "hour", "minute", "channelId"]),
  weekly: new Set(["type", "weekday", "hour", "minute", "channelId"]),
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

/** Validates the exact trigger object that is subsequently passed to the installed Expo SDK 57. */
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
  if (type !== "date" && type !== "daily" && type !== "weekly") {
    invalidTrigger("unsupported or missing type");
  }
  const allowed = ALLOWED_TRIGGER_KEYS[type];
  const unexpected = Object.keys(trigger).filter((key) => !allowed.has(key));
  if (unexpected.length) invalidTrigger(`unexpected field(s): ${unexpected.join(", ")}`);
  if (Object.values(trigger).some((item) => item === undefined)) invalidTrigger("undefined field");
  const channelId = validateChannel(platform, trigger.channelId);

  if (type === "daily" || type === "weekly") {
    const hour = finiteInteger(trigger.hour, 0, 23, "hour");
    const minute = finiteInteger(trigger.minute, 0, 59, "minute");
    if (type === "weekly") {
      const weekday = finiteInteger(trigger.weekday, 1, 7, "weekday");
      return (platform === "android"
        ? { type: "weekly" as const, weekday, hour, minute, channelId: channelId! }
        : { type: "weekly" as const, weekday, hour, minute }) as unknown as SchedulableNotificationTriggerInput;
    }
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
  const causeMessage = notificationCauseMessage(error);
  return {
    name: value.name || "Error",
    ...(codeValue == null ? {} : { code: String(codeValue) }),
    message: value.message || String(error),
    ...(causeMessage ? { causeMessage } : {}),
    ...(value.stack ? { stack: value.stack } : {}),
  };
}

function sanitizeDiagnosticText(value: unknown): string {
  return String(value ?? "Unknown notification error")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[redacted-id]")
    .replace(/\b[A-Za-z0-9_-]{12,}:[A-Za-z0-9_-]{4,}:[A-Za-z0-9_.-]{4,}\b/g, "[redacted-operation]")
    .replace(/\b(uid|userId|challengeId|email|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]");
}

function notificationCauseMessage(error: unknown): string | undefined {
  const messages: string[] = [];
  const seen = new Set<object>();
  let cause = (error as { cause?: unknown } | null)?.cause;
  while (cause != null) {
    if (typeof cause === "object") {
      if (seen.has(cause)) break;
      seen.add(cause);
    }
    const message = cause instanceof Error
      ? cause.message || cause.name
      : typeof cause === "object" && "message" in cause
        ? String((cause as { message?: unknown }).message ?? cause)
        : String(cause);
    messages.push(sanitizeDiagnosticText(message));
    cause = (cause as { cause?: unknown } | null)?.cause;
  }
  return messages.length ? messages.join(" <- ") : undefined;
}

export function attachNotificationFailure(
  error: unknown,
  phase: NotificationSavePhase | NotificationFailurePhase,
  context: NotificationFailureContext = {},
): Error {
  const value = error instanceof Error ? error : new Error(String(error));
  const existing = (value as Error & { [FAILURE_DETAILS_KEY]?: NotificationFailureDetails })[FAILURE_DETAILS_KEY];
  if (existing) return value;
  const rawCode = (error as { code?: unknown } | null)?.code;
  const causeMessage = notificationCauseMessage(error);
  const details: NotificationFailureDetails = {
    phase: phase in FAILURE_PHASES
      ? FAILURE_PHASES[phase as NotificationSavePhase]
      : phase as NotificationFailurePhase,
    name: sanitizeDiagnosticText(value.name || "Error"),
    ...(rawCode == null ? {} : { code: sanitizeDiagnosticText(rawCode) }),
    message: sanitizeDiagnosticText(value.message),
    ...(causeMessage ? { causeMessage } : {}),
    ...(context.platform ? { platform: sanitizeDiagnosticText(context.platform) } : {}),
    ...(context.triggerType ? { triggerType: sanitizeDiagnosticText(context.triggerType) } : {}),
    ...(context.soundType ? { soundType: sanitizeDiagnosticText(context.soundType) } : {}),
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
  const causeMessage = notificationCauseMessage(error);
  return (value as Error & { [FAILURE_DETAILS_KEY]?: NotificationFailureDetails })[FAILURE_DETAILS_KEY] ?? {
    phase: "UNKNOWN",
    name: sanitizeDiagnosticText(value.name || "Error"),
    ...((error as { code?: unknown } | null)?.code == null
      ? {}
      : { code: sanitizeDiagnosticText((error as { code?: unknown }).code) }),
    message: sanitizeDiagnosticText(value.message),
    ...(causeMessage ? { causeMessage } : {}),
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
    ...(details.causeMessage ? [`Cause: ${details.causeMessage}`] : []),
    ...(details.platform ? [`Platform: ${details.platform}`] : []),
    ...(details.triggerType ? [`Trigger: ${details.triggerType}`] : []),
    ...(details.soundType ? [`Sound type: ${details.soundType}`] : []),
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
