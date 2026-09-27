import type { ExperienceData } from '../types/profile.types';

const DAY_MS = 86_400_000;
const DAYS_PER_MONTH = 30.4375;

function toDay(isoDate: string): number {
  return Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / DAY_MS);
}

/**
 * Total months of work experience. Each row with a start date covers
 * [startDate, isCurrent ? today : endDate ?? startDate], inclusive.
 * Overlapping or touching ranges are merged so parallel jobs are not counted twice.
 */
export function computeExperienceMonths(
  rows: Pick<ExperienceData, 'startDate' | 'endDate' | 'isCurrent'>[],
  todayIso: string,
): number {
  const ranges = rows
    .filter((r) => r.startDate)
    .map((r) => {
      const start = toDay(r.startDate!);
      const end = toDay(r.isCurrent ? todayIso : (r.endDate ?? r.startDate!));
      return [start, end] as const;
    })
    .filter(([start, end]) => end >= start)
    .sort((a, b) => a[0] - b[0]);

  let totalDays = 0;
  let current: [number, number] | null = null;
  for (const [start, end] of ranges) {
    if (current && start <= current[1] + 1) {
      current[1] = Math.max(current[1], end);
    } else {
      if (current) totalDays += current[1] - current[0] + 1;
      current = [start, end];
    }
  }
  if (current) totalDays += current[1] - current[0] + 1;

  return Math.round(totalDays / DAYS_PER_MONTH);
}
