export type FlexibleWeeklyReminderRow = {
  /** ISO-style weekday: 1=Monday ... 7=Sunday. */
  weekday: number;
  hour: number;
  minute: number;
};

function validInteger(value: unknown, min: number, max: number): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

export function normalizeFlexibleWeeklyReminderRows(value: unknown): FlexibleWeeklyReminderRow[] {
  if (!Array.isArray(value)) return [];

  const weekdays = new Set<number>();
  const rows: FlexibleWeeklyReminderRow[] = [];
  for (const candidate of value) {
    const weekday = validInteger(candidate?.weekday, 1, 7);
    const hour = validInteger(candidate?.hour, 0, 23);
    const minute = validInteger(candidate?.minute, 0, 59);
    if (weekday === null || hour === null || minute === null || weekdays.has(weekday)) continue;
    weekdays.add(weekday);
    rows.push({ weekday, hour, minute });
  }
  return rows;
}

export function hasDuplicateFlexibleReminderWeekday(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const seen = new Set<number>();
  for (const candidate of value) {
    const weekday = validInteger(candidate?.weekday, 1, 7);
    if (weekday === null) continue;
    if (seen.has(weekday)) return true;
    seen.add(weekday);
  }
  return false;
}

export function migrateFlexibleWeeklyReminderRows(
  canonicalRows: unknown,
  legacyReminderDays: unknown,
  legacyReminderTimes: unknown,
): FlexibleWeeklyReminderRow[] {
  // An explicit canonical array, including [], always wins. This prevents a
  // deliberately cleared configuration from being recreated from legacy data.
  if (Array.isArray(canonicalRows)) return normalizeFlexibleWeeklyReminderRows(canonicalRows);
  if (!Array.isArray(legacyReminderDays) || !Array.isArray(legacyReminderTimes)) return [];

  const legacyTime = legacyReminderTimes
    .map((value) => String(value ?? ""))
    .map((value) => value.match(/^([01]\d|2[0-3]):([0-5]\d)$/))
    .find((match) => !!match);
  if (!legacyTime) return [];

  const rows = legacyReminderDays.map((value) => ({
    weekday: Number(value) + 1,
    hour: Number(legacyTime[1]),
    minute: Number(legacyTime[2]),
  }));
  return normalizeFlexibleWeeklyReminderRows(rows);
}

export function flexibleReminderRowTime(row: FlexibleWeeklyReminderRow): string {
  return `${String(row.hour).padStart(2, "0")}:${String(row.minute).padStart(2, "0")}`;
}
