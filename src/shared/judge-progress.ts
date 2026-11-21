import type { JudgmentRun } from "../core/judgment";

/** Link assessments run four at a time; progress and ETA use the same limit. */
export const JUDGE_LINK_CONCURRENCY = 4;

export interface JudgeLinkProgress {
  edgeId: string;
  /** Zero-based position in the map's edge list. */
  index: number;
  total: number;
  type: "support" | "attack" | "undercut";
}

export type JudgeProgressPhase = "clustering" | "assessing" | "resolving" | "local";

export type JudgeProgressEvent =
  | { type: "phase"; phase: JudgeProgressPhase; totalLinks: number }
  | { type: "link-start"; link: JudgeLinkProgress; startedAt: number }
  | {
      type: "link-done";
      link: JudgeLinkProgress;
      completed: number;
      durationMs: number;
      completedAt: number;
    }
  | { type: "done"; run: JudgmentRun }
  | { type: "error"; error: string };

/**
 * Estimate the remaining link-assessment time from observed link latencies.
 * The first sample is deliberately rough; every completed link refines it.
 */
export function estimateJudgeRemainingMs(
  completedDurationsMs: readonly number[],
  remainingLinks: number
): number | null {
  if (remainingLinks <= 0) return 0;
  if (!completedDurationsMs.length) return null;
  const average =
    completedDurationsMs.reduce((total, duration) => total + Math.max(0, duration), 0) /
    completedDurationsMs.length;
  const remainingInSlots = (remainingLinks / JUDGE_LINK_CONCURRENCY) * average;
  // Even the last queued link needs one full link latency.
  return Math.max(average, remainingInSlots);
}
