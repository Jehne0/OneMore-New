const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addIsoDays(dateISO: string, days: number): string {
  const value = new Date(`${dateISO}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function flexibleWeeklyWindowForServer(challenge: Record<string, any>, dateISO: string) {
  if (challenge.period !== "flexibleWeekly") return null;
  const pending = challenge.flexibleWeeklyPending as Record<string, any> | undefined;
  const effective = String(pending?.effectiveFrom ?? "");
  const usingPending = !!pending && DATE_RE.test(effective) && dateISO >= effective;
  if (pending && !usingPending) {
    const oldFirst = String(challenge.flexibleWeeklyFirstPeriodStart ?? "");
    let previousPeriodEnd = String(pending.previousPeriodEnd ?? "");
    if (!DATE_RE.test(previousPeriodEnd) && DATE_RE.test(oldFirst) && effective > oldFirst) {
      const elapsedBeforeEffective = Math.floor(
        (Date.parse(`${effective}T00:00:00Z`) - Date.parse(`${oldFirst}T00:00:00Z`)) / 86_400_000,
      ) - 1;
      const candidateStart = addIsoDays(oldFirst, Math.floor(Math.max(0, elapsedBeforeEffective) / 7) * 7);
      const candidateEnd = addIsoDays(candidateStart, 6);
      previousPeriodEnd = candidateEnd < effective ? candidateEnd : addIsoDays(candidateEnd, -7);
    }
    if (DATE_RE.test(previousPeriodEnd) && dateISO > previousPeriodEnd) return null;
  }
  const first = usingPending ? effective : String(challenge.flexibleWeeklyFirstPeriodStart ?? "");
  if (!DATE_RE.test(first) || dateISO < first) return null;
  const targetValue = usingPending ? pending!.target : challenge.flexibleWeeklyTarget;
  const target = Math.max(1, Math.min(7, Math.floor(Number(targetValue ?? 1))));
  const elapsed = Math.floor((Date.parse(`${dateISO}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000);
  const start = addIsoDays(first, Math.floor(elapsed / 7) * 7);
  return { start, end: addIsoDays(start, 6), target };
}
