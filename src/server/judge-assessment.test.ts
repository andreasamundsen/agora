import { beforeEach, describe, expect, it, vi } from "vitest";
import { reconcileDebate } from "../core/model";

const { callModelMock } = vi.hoisted(() => ({
  callModelMock: vi.fn()
}));

vi.mock("./llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./llm")>();
  return { ...actual, callModel: callModelMock };
});

import { judgeDebate } from "./judge";

beforeEach(() => {
  vi.stubEnv("AGORA_PACKAGED", "0");
  vi.stubEnv("AGORA_LLM_BASE_URL", "http://127.0.0.1:1234/v1");
  vi.stubEnv("AGORA_LLM_MODEL", "test-local");
  callModelMock.mockReset();
});

function assessmentDebate() {
  return reconcileDebate({
    id: "assessment-null-fields",
    motion: "Should cities fund night buses?",
    thesisId: "thesis",
    nodes: [
      { id: "thesis", kind: "statement", title: "Night buses", text: "Cities should fund night buses." },
      {
        id: "support",
        kind: "argument",
        title: "Night workers need it",
        text: "Night workers finish after the last regular bus.",
        stance: "pro",
        premises: ["Those workers finish after midnight."],
        conclusion: "There is an unmet transport need."
      },
      {
        id: "attack",
        kind: "argument",
        title: "Demand is too thin",
        text: "Late routes would carry too few passengers to justify the cost.",
        stance: "con",
        premises: ["The cost of a route is fixed."],
        conclusion: "The network would waste money."
      }
    ],
    edges: [
      { id: "edge-support", from: "support", to: "thesis", type: "support" },
      { id: "edge-attack", from: "attack", to: "thesis", type: "attack" }
    ]
  });
}

describe("judgment assessment normalization", () => {
  it("accepts null optional quality and impact fields from a local model", async () => {
    callModelMock.mockImplementation(async (_settings, messages: { role: string; content: string }[]) => {
      if (messages[0]?.content.includes("weighing clerk")) {
        return JSON.stringify({
          lines: [
            {
              edgeId: "edge-support",
              side: "pro",
              quality: "strong",
              impact: null,
              proves: false,
              confidence: "high",
              cluster: "night-workers",
              reasoning: "A relevant, grounded need."
            },
            {
              edgeId: "edge-attack",
              side: "con",
              quality: null,
              impact: "decisive",
              proves: false,
              confidence: "high",
              cluster: "cost-per-rider",
              reasoning: "The cost problem is load-bearing."
            }
          ]
        });
      }
      return JSON.stringify({
        verdict: "defeats",
        criterion: "sufficiency",
        confidence: "high",
        target_component: "conclusion",
        reasoning: "The attack defeats the thesis on cost."
      });
    });

    const run = await judgeDebate(assessmentDebate(), {
      standard: "preponderance",
      strictness: "balanced"
    });

    expect(run.engine).toBe("llm");
    expect(run.assessments).toHaveLength(2);
    expect(run.balance.assessed).toBe(true);
    expect(run.warnings.join(" ")).not.toContain("invalid shape");
  });
});
