import { describe, expect, it } from "vitest";
import {
  ASSESSMENT_POLICY,
  ASSESSMENT_FORMAT,
  ASSESSMENT_RULES,
  ASSESSMENT_TRAILER,
  AUTHORING_FORMAT,
  AUTHORING_POLICY,
  AUTHORING_RULES,
  CHAMBER_POLICY,
  CHAMBER_RULES,
  INSTRUCTION_POLICIES,
  JUDGE_FORMAT,
  JUDGE_POLICY,
  JUDGE_RULES
} from "./instructions";

describe("model instruction policy", () => {
  it("exposes the four built-in roles in the inspector order", () => {
    expect(INSTRUCTION_POLICIES.map((policy) => policy.id)).toEqual([
      "judge",
      "weighing",
      "authoring",
      "chamber"
    ]);
    expect(INSTRUCTION_POLICIES.find((policy) => policy.id === "weighing")?.note).toBe(ASSESSMENT_TRAILER);
  });

  it("keeps the output contract out of the displayed policy", () => {
    for (const policy of INSTRUCTION_POLICIES) {
      expect(policy.policy.length).toBeGreaterThan(0);
      expect(policy.policy).not.toContain("Return JSON only");
    }
  });

  it("assembles prompts from the same policy text the inspector displays", () => {
    expect(AUTHORING_RULES).toBe(`${AUTHORING_POLICY}\n\n${AUTHORING_FORMAT}`);
    expect(CHAMBER_RULES).toBe(CHAMBER_POLICY);
    expect(JUDGE_RULES).toBe(`${JUDGE_POLICY}\n\n${JUDGE_FORMAT}`);
    expect(ASSESSMENT_RULES).toBe(`${ASSESSMENT_POLICY}\n\n${ASSESSMENT_FORMAT}\n${ASSESSMENT_TRAILER}`);
  });
});
