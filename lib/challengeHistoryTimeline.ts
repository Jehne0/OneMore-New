export type ChallengeTimelineRow = {
  date: string;
  status: string;
  time?: string;
  done?: number;
  target?: number;
};

/** Stable newest-first ordering used by the challenge-history modal. */
export function newestChallengeTimelineFirst<T extends ChallengeTimelineRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    b.date.localeCompare(a.date) || String(b.time ?? "").localeCompare(String(a.time ?? ""))
  );
}
