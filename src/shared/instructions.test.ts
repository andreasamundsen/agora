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

  it("localizes only the link reasoning while keeping the JSON contract canonical", () => {
    expect(LINK_POLICY).toContain('Only one field is free-text prose: "reasoning".');
    expect(LINK_POLICY).toContain("language of the TARGET argument");
    expect(LINK_POLICY).toContain("language of the SOURCE argument");
    expect(LINK_POLICY).toContain("canonical English tokens");
    for (const field of ["quality", "verdict", "impact", "criterion", "confidence", "target_component"]) {
      expect(LINK_POLICY).toContain(field);
    }
    expect(CLUSTER_POLICY).not.toContain("language of the TARGET argument");
  });
});
