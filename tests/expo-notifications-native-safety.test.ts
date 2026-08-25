import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { patchTriggerRecordsSource } = require("../scripts/patch-expo-notifications-ios.cjs") as {
  patchTriggerRecordsSource: (source: string) => string;
};

const triggerNames = [
  "CalendarTriggerRecord",
  "TimeIntervalTriggerRecord",
  "DateTriggerRecord",
  "DailyTriggerRecord",
  "WeeklyTriggerRecord",
  "MonthlyTriggerRecord",
  "YearlyTriggerRecord",
] as const;

test("EAS install persistently protects every iOS notification trigger constructor", () => {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
  assert.equal(packageJson.dependencies["expo-notifications"], "57.0.13");
  assert.equal(packageJson.scripts.postinstall, "node scripts/patch-expo-notifications-ios.cjs");

  const installed = readFileSync(join(
    process.cwd(),
    "node_modules/expo-notifications/ios/ExpoNotifications/Notifications/TriggerRecords.swift",
  ), "utf8");
  for (const name of triggerNames) {
    const start = installed.indexOf(`public struct ${name}: TriggerRecord`);
    assert.ok(start >= 0, name);
    const end = installed.indexOf("\npublic struct ", start + 1);
    const section = installed.slice(start, end < 0 ? undefined : end);
    assert.match(section, /try EXUtilities\.catchException \{/, name);
  }
});

test("native trigger patch is deterministic and idempotent on a clean dependency source", () => {
  const fixture = triggerNames.map((name) => `
public struct ${name}: TriggerRecord {
  public init() {}
  public func toUNNotificationTrigger() throws -> UNNotificationTrigger? {
    return nil
  }
}
`).join("\n");
  const once = patchTriggerRecordsSource(fixture);
  const twice = patchTriggerRecordsSource(once);
  assert.equal(twice, once);
  assert.equal((once.match(/try EXUtilities\.catchException \{/g) ?? []).length, triggerNames.length);
});
