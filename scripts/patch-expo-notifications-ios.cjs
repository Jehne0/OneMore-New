const fs = require("node:fs");
const path = require("node:path");

const TRIGGER_RECORDS_PATH = path.join(
  "node_modules",
  "expo-notifications",
  "ios",
  "ExpoNotifications",
  "Notifications",
  "TriggerRecords.swift",
);

const protectedFunctions = {
  CalendarTriggerRecord: `  public func toUNNotificationTrigger() throws -> UNNotificationTrigger? {
    var trigger: UNNotificationTrigger?
    try EXUtilities.catchException {
      let dateComponents: DateComponents = dateComponentsFrom(self)
      let repeats = self.repeats ?? false
      trigger = UNCalendarNotificationTrigger(dateMatching: dateComponents, repeats: repeats)
    }
    return trigger
  }`,
  TimeIntervalTriggerRecord: `  public func toUNNotificationTrigger() throws -> UNNotificationTrigger? {
    var trigger: UNNotificationTrigger?
    try EXUtilities.catchException {
      trigger = UNTimeIntervalNotificationTrigger(timeInterval: self.seconds, repeats: self.repeats)
    }
    return trigger
  }`,
  DateTriggerRecord: `  public func toUNNotificationTrigger() throws -> UNNotificationTrigger? {
    let timestamp: Int = Int(self.timestamp / 1000)
    let date: Date = Date(timeIntervalSince1970: TimeInterval(timestamp))
    var trigger: UNNotificationTrigger?
    try EXUtilities.catchException {
      trigger = UNTimeIntervalNotificationTrigger(timeInterval: date.timeIntervalSinceNow, repeats: false)
    }
    return trigger
  }`,
  DailyTriggerRecord: `  public func toUNNotificationTrigger() throws -> UNNotificationTrigger? {
    let dateComponents: DateComponents = DateComponents(hour: self.hour, minute: self.minute)
    var trigger: UNNotificationTrigger?
    try EXUtilities.catchException {
      trigger = UNCalendarNotificationTrigger(dateMatching: dateComponents, repeats: true)
    }
    return trigger
  }`,
  WeeklyTriggerRecord: `  public func toUNNotificationTrigger() throws -> UNNotificationTrigger? {
    let dateComponents: DateComponents = DateComponents(hour: self.hour, minute: self.minute, weekday: self.weekday)
    var trigger: UNNotificationTrigger?
    try EXUtilities.catchException {
      trigger = UNCalendarNotificationTrigger(dateMatching: dateComponents, repeats: true)
    }
    return trigger
  }`,
  MonthlyTriggerRecord: `  public func toUNNotificationTrigger() throws -> UNNotificationTrigger? {
    let dateComponents: DateComponents = DateComponents(day: self.day, hour: self.hour, minute: self.minute)
    var trigger: UNNotificationTrigger?
    try EXUtilities.catchException {
      trigger = UNCalendarNotificationTrigger(dateMatching: dateComponents, repeats: true)
    }
    return trigger
  }`,
  YearlyTriggerRecord: `  public func toUNNotificationTrigger() throws -> UNNotificationTrigger? {
    let dateComponents: DateComponents = DateComponents(
      month: self.month + 1, // iOS months are 1-based, JS months are 0-based
      day: self.day,
      hour: self.hour,
      minute: self.minute
    )
    var trigger: UNNotificationTrigger?
    try EXUtilities.catchException {
      trigger = UNCalendarNotificationTrigger(dateMatching: dateComponents, repeats: true)
    }
    return trigger
  }`,
};

function matchingBraceIndex(source, openingBraceIndex) {
  let depth = 0;
  for (let index = openingBraceIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return index;
  }
  throw new Error("Unbalanced Swift braces in expo-notifications TriggerRecords.swift");
}

function replaceTriggerFunction(source, recordName, replacement) {
  const recordMarker = `public struct ${recordName}: TriggerRecord`;
  const recordStart = source.indexOf(recordMarker);
  if (recordStart < 0) throw new Error(`Missing ${recordName} in expo-notifications TriggerRecords.swift`);

  const functionMarker = "public func toUNNotificationTrigger() throws -> UNNotificationTrigger?";
  const functionStart = source.indexOf(functionMarker, recordStart);
  const nextRecord = source.indexOf("\npublic struct ", recordStart + recordMarker.length);
  if (functionStart < 0 || (nextRecord >= 0 && functionStart > nextRecord)) {
    throw new Error(`Missing trigger conversion function for ${recordName}`);
  }

  const openingBrace = source.indexOf("{", functionStart + functionMarker.length);
  const closingBrace = matchingBraceIndex(source, openingBrace);
  const indentationStart = source.lastIndexOf("\n", functionStart) + 1;
  return `${source.slice(0, indentationStart)}${replacement}${source.slice(closingBrace + 1)}`;
}

function patchTriggerRecordsSource(source) {
  let patched = String(source);
  for (const [recordName, replacement] of Object.entries(protectedFunctions)) {
    patched = replaceTriggerFunction(patched, recordName, replacement);
  }

  const protectedCount = (patched.match(/try EXUtilities\.catchException \{/g) ?? []).length;
  if (protectedCount < Object.keys(protectedFunctions).length) {
    throw new Error("expo-notifications iOS trigger exception protection is incomplete");
  }
  return patched;
}

function patchInstalledExpoNotifications(projectRoot = path.resolve(process.cwd())) {
  const target = path.join(projectRoot, TRIGGER_RECORDS_PATH);
  if (!fs.existsSync(target)) {
    throw new Error(`Cannot patch expo-notifications; missing ${target}`);
  }
  const source = fs.readFileSync(target, "utf8");
  const patched = patchTriggerRecordsSource(source);
  if (patched !== source) fs.writeFileSync(target, patched);
  return target;
}

if (require.main === module) {
  const target = patchInstalledExpoNotifications();
  process.stdout.write(`Protected iOS notification triggers in ${target}\n`);
}

module.exports = {
  patchInstalledExpoNotifications,
  patchTriggerRecordsSource,
};
