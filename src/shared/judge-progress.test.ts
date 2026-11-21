import { describe, expect, it } from "vitest";
import {
  estimateJudgeRemainingMs,
  JUDGE_LINK_CONCURRENCY
} from "./judge-progress";

describe("judge progress ETA", () => {
  it("waits for a completed link before estimating", () => {
    expect(estimateJudgeRemainingMs([], 8)).toBeNull();
    expect(estimateJudgeRemainingMs([], 0)).toBe(0);
  });

  it("uses the first link as a rough estimate and refines from completions", () => {
    expect(estimateJudgeRemainingMs([10_000], 17)).toBe(42_500);
    expect(estimateJudgeRemainingMs([10_000, 12_000, 8_000, 10_000], 14)).toBe(35_000);
    expect(estimateJudgeRemainingMs([10_000, 10_000], 0)).toBe(0);
  });

  it("keeps the final queued link at one full link latency", () => {
    expect(estimateJudgeRemainingMs([10_000], 3)).toBe(
      Math.max(10_000, (3 / JUDGE_LINK_CONCURRENCY) * 10_000)
    );
  });
});
