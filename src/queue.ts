import type { Job } from "./types";

export function recoverJobs(serialized: string | null): Job[] {
  try {
    const stored = JSON.parse(serialized || "[]") as Job[];
    if (!Array.isArray(stored)) return [];
    return stored
      .filter(
        (job) =>
          job?.id &&
          job.info?.id &&
          !["complete", "cancelled"].includes(job.status),
      )
      .map((job) => ({
        ...job,
        status: "waiting" as const,
        progress: 0,
        speed: undefined,
        eta: undefined,
        error: undefined,
      }));
  } catch {
    return [];
  }
}

export function parseRanges(value: string, maximum: number) {
  const selected = new Set<number>();
  for (const chunk of value.split(",")) {
    const match = chunk.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) continue;
    const rawStart = Number(match[1]);
    const rawEnd = Number(match[2] || match[1]);
    if (rawStart < 1 || rawEnd < 1 || rawStart > maximum) continue;
    const start = Math.min(maximum, rawStart);
    const end = Math.min(maximum, rawEnd);
    for (
      let index = Math.min(start, end);
      index <= Math.max(start, end) && index <= maximum;
      index++
    ) {
      selected.add(index - 1);
    }
  }
  return selected;
}

export function freshVideoIds(
  candidateIds: string[],
  queuedIds: string[],
  historyIds: string[],
) {
  const known = new Set([...queuedIds, ...historyIds]);
  return candidateIds.filter((id) => !known.has(id));
}
