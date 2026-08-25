import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { normalizeFlexibleWeeklyReminderRows } from "../lib/flexibleReminderRows";
import {
  buildReminderTriggerInputs,
  plannedReminderDates,
  reminderScheduleForChallenge,
  type ReminderSchedule,
} from "../lib/reminders";
import { isChallengeActiveOnDate } from "../lib/storage";

process.env.TZ = "Europe/Prague";

const TRIGGER_TYPES = { DAILY: "daily", DATE: "date", WEEKLY: "weekly" } as const;
const CHANNEL_ID = "reminders_high_v1";

function loadInstalledExpoParseTrigger(): (trigger: unknown) => Record<string, unknown> {
  const validitySource = readFileSync("node_modules/expo-notifications/src/hasValidTriggerObject.ts", "utf8");
  const validityOutput = ts.transpileModule(validitySource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const validityExports: Record<string, unknown> = {};
  vm.runInNewContext(validityOutput, { exports: validityExports });

  const source = readFileSync("node_modules/expo-notifications/src/scheduleNotificationAsync.ts", "utf8");
  const start = source.indexOf("export function parseTrigger");
  assert.notEqual(start, -1);
  const output = ts.transpileModule(source.slice(start), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(output, {
    exports,
    console,
    Date,
    Platform: { select: (choices: Record<string, unknown>) => choices.android },
    SchedulableTriggerInputTypes: {
      CALENDAR: "calendar", DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly",
      YEARLY: "yearly", DATE: "date", TIME_INTERVAL: "timeInterval",
    },
    hasValidTriggerObject: validityExports.hasValidTriggerObject,
  });
  return exports.parseTrigger as (trigger: unknown) => Record<string, unknown>;
}

const parseExpoTrigger = loadInstalledExpoParseTrigger();

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isoWeekday(date: Date): number {
  return ((date.getDay() + 6) % 7) + 1;
}

function containsInvalidValue(value: unknown): boolean {
  if (value === undefined || typeof value === "number" && Number.isNaN(value)) return true;
  if (!value || typeof value !== "object" || value instanceof Date) return false;
  return Object.values(value).some(containsInvalidValue);
}

function assertExactTrigger(
  trigger: any,
  platform: "android" | "ios",
  expected:
    | { type: "daily"; hour: number; minute: number }
    | { type: "weekly"; weekday: number; hour: number; minute: number }
    | { type: "date"; date: Date },
  context: string,
): void {
  assert.equal(containsInvalidValue(trigger), false, `${context}: undefined or NaN`);
  assert.deepEqual(
    Object.keys(trigger).sort(),
    (expected.type === "daily"
      ? ["type", "hour", "minute", ...(platform === "android" ? ["channelId"] : [])]
      : expected.type === "weekly"
        ? ["type", "weekday", "hour", "minute", ...(platform === "android" ? ["channelId"] : [])]
      : ["type", "date", ...(platform === "android" ? ["channelId"] : [])]).sort(),
    `${context}: unsupported trigger field`,
  );
  assert.equal(trigger.channelId, platform === "android" ? CHANNEL_ID : undefined, `${context}: channelId`);
  const native = parseExpoTrigger(trigger);
  assert.equal(native.type, expected.type, `${context}: native type`);
  if (expected.type === "daily" || expected.type === "weekly") {
    assert.equal(trigger.hour, expected.hour, `${context}: hour`);
    assert.equal(trigger.minute, expected.minute, `${context}: minute`);
    assert.equal(native.hour, expected.hour, `${context}: native hour`);
    assert.equal(native.minute, expected.minute, `${context}: native minute`);
    if (expected.type === "weekly") {
      assert.equal(trigger.weekday, expected.weekday, `${context}: weekday`);
      assert.equal(native.weekday, expected.weekday, `${context}: native weekday`);
    }
  } else {
    assert.ok(trigger.date instanceof Date, `${context}: DATE must carry Date`);
    assert.equal(trigger.date.getTime(), expected.date.getTime(), `${context}: date`);
    assert.equal(native.timestamp, expected.date.getTime(), `${context}: native timestamp`);
  }
  assert.equal(native.channelId, platform === "android" ? CHANNEL_ID : undefined, `${context}: native channelId`);
}

function scheduleForMatrix(
  period: NonNullable<ReminderSchedule["period"]>,
  target: Date,
  isNewChallenge: boolean,
): ReminderSchedule {
  const targetISO = dateKey(target);
  if (period === "flexibleWeekly") {
    return {
      period,
      enabled: true,
      isNewChallenge,
      reminderRows: [{ weekday: isoWeekday(target), hour: target.getHours(), minute: target.getMinutes() }],
      isActiveOnDate: (dateISO) => dateISO === targetISO,
    };
  }
  return {
    period,
    enabled: true,
    isNewChallenge,
    activeWeekdays: period === "custom" ? [isoWeekday(target) - 1] : undefined,
    isActiveOnDate: period === "daily" ? () => true : (dateISO) => dateISO === targetISO,
  };
}

test("exhaustive period × platform × new/existing × 7 days × 24 hours × 60 minutes trigger matrix", () => {
  const periods = ["daily", "every2", "custom", "flexibleWeekly"] as const;
  const platforms = ["android", "ios"] as const;
  let combinations = 0;
  let parsedTriggers = 0;

  for (const period of periods) {
    for (const platform of platforms) {
      for (const isNewChallenge of [false, true]) {
        for (let weekday = 1; weekday <= 7; weekday += 1) {
          for (let hour = 0; hour < 24; hour += 1) {
            for (let minute = 0; minute < 60; minute += 1) {
              const context = `period=${period} platform=${platform} challenge=${isNewChallenge ? "new" : "existing"} day=${weekday} hour=${hour} minute=${minute}`;
              try {
                const target = new Date(2028, 0, 3 + weekday - 1, hour, minute, 0, 0);
                const now = new Date(2028, 0, 2 + weekday - 1, 23, 59, 59, 999);
                const schedule = scheduleForMatrix(period, target, isNewChallenge);
                const triggers = buildReminderTriggerInputs(
                  schedule,
                  period === "flexibleWeekly" ? [] : [`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`],
                  platform,
                  TRIGGER_TYPES as any,
                  now,
                  2,
                );
                assert.equal(triggers.length, 1, `${context}: trigger count`);
                assertExactTrigger(
                  triggers[0],
                  platform,
                  period === "daily"
                    ? { type: "daily", hour, minute }
                    : period === "every2"
                      ? { type: "date", date: target }
                      : { type: "weekly", weekday: target.getDay() + 1, hour, minute },
                  context,
                );
                combinations += 1;
                parsedTriggers += triggers.length;
              } catch (error) {
                throw new Error(`${context}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
              }
            }
          }
        }
      }
    }
  }

  assert.equal(combinations, 4 * 2 * 2 * 7 * 24 * 60);
  assert.equal(parsedTriggers, combinations);
});

test("30-day plans have exact counts, bounds, local times and no duplicate DATE triggers", () => {
  const now = new Date(2028, 0, 3, 0, 0, 0, 0);
  const horizonEnd = new Date(2028, 1, 2, 0, 0, 0, 0);
  const cases: { period: ReminderSchedule["period"]; schedule: ReminderSchedule; times: string[] }[] = [
    { period: "daily", schedule: { period: "daily", enabled: true, isActiveOnDate: () => true }, times: ["00:00", "00:01", "23:58", "23:59"] },
    { period: "every2", schedule: { period: "every2", enabled: true, isActiveOnDate: (iso) => Math.round((new Date(`${iso}T12:00:00`).getTime() - new Date(2028, 0, 3, 12).getTime()) / 86_400_000) % 2 === 0 }, times: ["08:00", "17:30"] },
    { period: "custom", schedule: { period: "custom", enabled: true, activeWeekdays: [0, 2, 4], isActiveOnDate: (iso) => [1, 3, 5].includes(new Date(`${iso}T12:00:00`).getDay()) }, times: ["08:00", "17:30"] },
    { period: "flexibleWeekly", schedule: { period: "flexibleWeekly", enabled: true, reminderRows: [{ weekday: 1, hour: 8, minute: 0 }, { weekday: 5, hour: 17, minute: 30 }], isActiveOnDate: () => true }, times: [] },
  ];

  for (const item of cases) {
    for (const platform of ["android", "ios"] as const) {
      const triggers = buildReminderTriggerInputs(item.schedule, item.times, platform, TRIGGER_TYPES as any, now, 30);
      if (item.period === "daily") {
        assert.equal(triggers.length, 4, `${item.period}/${platform}`);
        triggers.forEach((trigger, index) => assertExactTrigger(trigger, platform, {
          type: "daily",
          hour: [0, 0, 23, 23][index],
          minute: [0, 1, 58, 59][index],
        }, `${item.period}/${platform}/${index}`));
        continue;
      }
      if (item.period === "custom" || item.period === "flexibleWeekly") {
        const expected = item.period === "custom"
          ? [
              { weekday: 2, hour: 8, minute: 0 }, { weekday: 2, hour: 17, minute: 30 },
              { weekday: 4, hour: 8, minute: 0 }, { weekday: 4, hour: 17, minute: 30 },
              { weekday: 6, hour: 8, minute: 0 }, { weekday: 6, hour: 17, minute: 30 },
            ]
          : [{ weekday: 2, hour: 8, minute: 0 }, { weekday: 6, hour: 17, minute: 30 }];
        assert.equal(triggers.length, expected.length, `${item.period}/${platform}: recurring count`);
        triggers.forEach((trigger, index) => assertExactTrigger(trigger, platform, {
          type: "weekly",
          ...expected[index],
        }, `${item.period}/${platform}/${index}`));
        continue;
      }

      const epochs = triggers.map((trigger: any) => trigger.date.getTime());
      assert.equal(new Set(epochs).size, epochs.length, `${item.period}/${platform}: duplicates`);
      assert.ok(triggers.every((trigger: any) => trigger.date > now), `${item.period}/${platform}: past`);
      assert.ok(triggers.every((trigger: any) => trigger.date < horizonEnd), `${item.period}/${platform}: horizon`);

      let expectedCount = 0;
      for (let offset = 0; offset < 30; offset += 1) {
        if (item.period === "every2" && offset % 2 === 0) expectedCount += 2;
      }
      assert.equal(triggers.length, expectedCount, `${item.period}/${platform}: exact count`);
      triggers.forEach((trigger: any, index) => assertExactTrigger(
        trigger, platform, { type: "date", date: trigger.date }, `${item.period}/${platform}/${index}`,
      ));
    }
  }
});

test("iOS weekly planning is bounded while Android preserves every requested trigger", () => {
  const weekdays = [0, 1, 2, 3, 4, 5, 6];
  const times = Array.from({ length: 10 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);
  const schedule: ReminderSchedule = {
    period: "custom",
    enabled: true,
    activeWeekdays: weekdays,
    isActiveOnDate: () => true,
  };
  const ios = buildReminderTriggerInputs(schedule, times, "ios", TRIGGER_TYPES as any);
  const android = buildReminderTriggerInputs(schedule, times, "android", TRIGGER_TYPES as any);
  assert.equal(ios.length, 48);
  assert.equal(android.length, 70);
  ios.forEach((trigger, index) => assertExactTrigger(trigger, "ios", {
    type: "weekly",
    weekday: Math.floor(index / 10) + 2,
    hour: index % 10,
    minute: 0,
  }, `ios-cap/${index}`));
});

test("past, current-minute and future-today rules are exact at all requested clock boundaries", () => {
  const schedule: ReminderSchedule = { period: "custom", enabled: true, isActiveOnDate: () => true };
  const now = new Date(2028, 0, 3, 12, 30, 0, 0);
  const plan = plannedReminderDates(
    schedule,
    ["00:00", "00:01", "12:29", "12:30", "12:31", "23:58", "23:59"],
    now,
    1,
  );
  assert.deepEqual(plan.map((date) => `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`), [
    "12:31", "23:58", "23:59",
  ]);
  assert.ok(plan.every((date) => date.getTime() > now.getTime()));
});

test("month, year, leap-day, timezone offsets and Prague DST preserve deterministic local plans", () => {
  const originalTZ = process.env.TZ;
  try {
    const boundaryCases = [
      { now: new Date(2028, 0, 31, 23, 59), expected: "2028-02-01" },
      { now: new Date(2028, 11, 31, 23, 59), expected: "2029-01-01" },
      { now: new Date(2028, 1, 28, 23, 59), expected: "2028-02-29" },
    ];
    for (const item of boundaryCases) {
      const result = plannedReminderDates(
        { period: "custom", enabled: true, isActiveOnDate: () => true },
        ["00:01"], item.now, 2,
      );
      assert.equal(dateKey(result[0]), item.expected);
      assert.equal(result[0].getHours(), 0);
      assert.equal(result[0].getMinutes(), 1);
    }

    for (const timezone of ["Europe/Prague", "Etc/GMT+12", "Etc/GMT-14"]) {
      process.env.TZ = timezone;
      const result = plannedReminderDates(
        { period: "custom", enabled: true, isActiveOnDate: () => true },
        ["08:15"], new Date(2028, 5, 1, 7, 0), 1,
      );
      assert.equal(result.length, 1, timezone);
      assert.equal(result[0].getHours(), 8, timezone);
      assert.equal(result[0].getMinutes(), 15, timezone);
    }

    process.env.TZ = "Europe/Prague";
    for (const now of [new Date(2028, 2, 24, 12), new Date(2028, 9, 27, 12)]) {
      const result = plannedReminderDates(
        { period: "custom", enabled: true, isActiveOnDate: () => true },
        ["08:15"], now, 5,
      );
      assert.ok(result.length > 0);
      assert.ok(result.every((date) => date.getHours() === 8 && date.getMinutes() === 15));
      assert.ok(new Set(result.map((date) => date.getTimezoneOffset())).size >= 2, String(now));
    }

    process.env.TZ = "UTC";
    const utc = plannedReminderDates({ period: "custom", enabled: true, isActiveOnDate: () => true }, ["08:15"], new Date(2028, 5, 1, 7), 1)[0];
    const utcHour = utc.getHours();
    process.env.TZ = "Europe/Prague";
    const prague = plannedReminderDates({ period: "custom", enabled: true, isActiveOnDate: () => true }, ["08:15"], new Date(2028, 5, 1, 7), 1)[0];
    assert.equal(utcHour, 8);
    assert.equal(prague.getHours(), 8);
    assert.notEqual(utc.getTime(), prague.getTime());
  } finally {
    process.env.TZ = originalTZ;
  }
});

test("flexibleWeekly rows remain independently paired through add, remove and one-row time edits", () => {
  const challenge: any = {
    id: "flex", text: "Flexible", enabled: true, period: "flexibleWeekly",
    flexibleWeeklyStartDay: 2,
    flexibleWeeklyFirstPeriodStart: "2028-01-05",
    flexibleReminderRows: [{ weekday: 1, hour: 8, minute: 0 }, { weekday: 5, hour: 17, minute: 30 }],
  };
  assert.equal(isChallengeActiveOnDate(challenge, "2028-01-06"), true, "completion is not restricted to reminder weekdays");
  const original = reminderScheduleForChallenge(challenge);
  assert.equal(original.isActiveOnDate("2028-01-03"), true);
  assert.equal(original.isActiveOnDate("2028-01-05"), false, "period start is not a reminder day");
  const originalPlan = plannedReminderDates(original, [], new Date(2028, 0, 3, 0), 30);
  assert.ok(originalPlan.some((date) => date.getDay() === 1 && date.getHours() === 8));
  assert.ok(originalPlan.some((date) => date.getDay() === 5 && date.getHours() === 17 && date.getMinutes() === 30));
  assert.equal(new Set(originalPlan.map((date) => date.getTime())).size, originalPlan.length);

  const removed = reminderScheduleForChallenge(challenge, [{ weekday: 1, hour: 8, minute: 0 }]);
  assert.ok(plannedReminderDates(removed, [], new Date(2028, 0, 3, 0), 30).every((date) => date.getDay() === 1));

  const changed = reminderScheduleForChallenge(challenge, [
    { weekday: 1, hour: 9, minute: 45 },
    { weekday: 5, hour: 17, minute: 30 },
  ]);
  const changedPlan = plannedReminderDates(changed, [], new Date(2028, 0, 3, 0), 30);
  assert.ok(changedPlan.filter((date) => date.getDay() === 1).every((date) => date.getHours() === 9 && date.getMinutes() === 45));
  assert.ok(changedPlan.filter((date) => date.getDay() === 5).every((date) => date.getHours() === 17 && date.getMinutes() === 30));

  assert.deepEqual(normalizeFlexibleWeeklyReminderRows([
    { weekday: 1, hour: 8, minute: 0 },
    { weekday: 1, hour: 18, minute: 0 },
  ]), [{ weekday: 1, hour: 8, minute: 0 }]);
});
