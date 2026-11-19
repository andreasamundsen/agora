import { describe, expect, it } from "vitest";
import type { JudgmentRun } from "../core/judgment";
import { openingIsRedundant } from "./judgment-playback";

const run = {
  verdicts: [
    { to: "support" },
    { to: "thesis" }
  ]
} as unknown as JudgmentRun;

describe("openingIsRedundant", () => {
  it("skips a support cue when the next ruling already targets that support", () => {
    expect(openingIsRedundant(run, 0, "support")).toBe(true);
  });

  it("keeps a cue when the next ruling targets something else", () => {
    expect(openingIsRedundant(run, 0, "thesis")).toBe(false);
    expect(openingIsRedundant(run, 0, "other")).toBe(false);
  });

  it("keeps a trailing clean-support cue when there is no next ruling", () => {
    expect(openingIsRedundant(run, 2, "support")).toBe(false);
  });
});
