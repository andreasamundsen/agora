import { describe, expect, it } from "vitest";
import {
  AUTHORING_FORMAT,
  AUTHORING_POLICY,
  AUTHORING_RULES,
  CHAMBER_POLICY,
  CHAMBER_RULES,
  CLUSTER_FORMAT,
  CLUSTER_POLICY,
  CLUSTER_RULES,
  CLUSTER_TRAILER,
  INSTRUCTION_POLICIES,
  LINK_FORMAT,
  LINK_POLICY,
  LINK_RULES,
  LINK_TRAILER
} from "./instructions";

describe("model instruction policy", () => {
  it("exposes the four built-in roles in the inspector order", () => {
    expect(INSTRUCTION_POLICIES.map((policy) => policy.id)).toEqual([
      "link",
      "cluster",
      "authoring",
      "chamber"
    ]);
    expect(INSTRUCTION_POLICIES.find((policy) => policy.id === "link")?.note).toBe(LINK_TRAILER);
    expect(INSTRUCTION_POLICIES.find((policy) => policy.id === "cluster")?.note).toBe(CLUSTER_TRAILER);
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
    expect(LINK_RULES).toBe(`${LINK_POLICY}\n\n${LINK_FORMAT}\n${LINK_TRAILER}`);
    expect(CLUSTER_RULES).toBe(`${CLUSTER_POLICY}\n\n${CLUSTER_FORMAT}\n${CLUSTER_TRAILER}`);
  });
});
