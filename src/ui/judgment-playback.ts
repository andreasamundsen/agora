import type { JudgmentRun } from "../core/judgment";

/**
 * A branch opening is redundant when the next ruling already targets that
 * argument. The ruling's target highlight introduces the card, so a separate
 * support-stem beat only delays the sequence.
 */
export function openingIsRedundant(
  run: JudgmentRun,
  step: number,
  nodeId: string
): boolean {
  return run.verdicts[step]?.to === nodeId;
}
