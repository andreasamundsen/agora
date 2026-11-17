import { describe, expect, it } from "vitest";
import { reconcileDebate } from "../core/model";
import { clashEdges, solveJudgment, type ClashJudgment } from "../core/judgment";
import { assessmentPrompt, clashPrompt } from "./judge";

function promptDebate() {
  return reconcileDebate({
    id: "prompt-debate",
    motion: "Should the chain hold?",
    thesisId: "thesis",
    nodes: [
      { id: "thesis", kind: "statement", title: "The chain holds", text: "The chain holds." },
      {
        id: "p1",
        kind: "argument",
        title: "P1 supports the thesis",
        text: "P1 TEXT SHOULD ONLY APPEAR AS A CONCLUSION HERE.",
        stance: "pro",
        premises: ["P1 premise."],
        conclusion: "P1 conclusion."
      },
      {
        id: "c1",
        kind: "argument",
        title: "C1 attacks P1",
        text: "C1 TEXT.",
        stance: "con",
        premises: ["C1 premise."],
        conclusion: "C1 conclusion."
      },
      {
        id: "r1",
        kind: "argument",
        title: "R1 attacks C1",
        text: "R1 TEXT.",
        stance: "pro",
        premises: ["R1 premise."],
        conclusion: "R1 conclusion."
      },
      {
        id: "r2",
        kind: "argument",
        title: "R2 attacks R1",
        text: "R2 TEXT.",
        stance: "pro",
        premises: ["R2 premise."],
        conclusion: "R2 conclusion."
      },
      {
        id: "unrelated",
        kind: "argument",
        title: "An unrelated argument",
        text: "UNRELATED CONTEXT SHOULD NOT APPEAR.",
        stance: "pro",
        premises: ["Unrelated premise."]
      }
    ],
    edges: [
      { id: "e_p1_thesis", from: "p1", to: "thesis", type: "support" },
      { id: "e_c1_p1", from: "c1", to: "p1", type: "attack" },
      { id: "e_r1_c1", from: "r1", to: "c1", type: "attack" },
      { id: "e_r2_r1", from: "r2", to: "r1", type: "attack" },
      { id: "e_unrelated_thesis", from: "unrelated", to: "thesis", type: "support" }
    ]
  });
}

describe("clash prompt context", () => {
  it("includes the target's role and full immediate destination, but not the whole map", () => {
    const debate = promptDebate();
    const clash = clashEdges(debate).find((edge) => edge.from === "r2")!;
    const prompt = clashPrompt(debate, clash, "pro");

    expect(prompt).toContain("TARGET'S ROLE IN THE MAP");
    expect(prompt).toContain("Role: deeper response (3 steps from the thesis).");
    expect(prompt).toContain("1. ATTACK: “C1 attacks P1”");
    expect(prompt).toContain("C1 TEXT.");
    expect(prompt).toContain("C1 premise.");
    expect(prompt).toContain("SHORTEST PATH TO THE THESIS");
    expect(prompt).toContain("DEEPER PATH NODES");
    expect(prompt).toContain("“P1 supports the thesis” — P1 conclusion.");
    expect(prompt).not.toContain("P1 TEXT SHOULD ONLY APPEAR AS A CONCLUSION HERE.");
    expect(prompt).not.toContain("UNRELATED CONTEXT SHOULD NOT APPEAR.");
  });
});

describe("assessment prompt", () => {
  function contestedSupportDebate() {
    return reconcileDebate({
      id: "contested-support",
      motion: "Should the test pass?",
      thesisId: "thesis",
      nodes: [
        { id: "thesis", kind: "statement", title: "The test passes", text: "The test passes." },
        {
          id: "support",
          kind: "argument",
          title: "A reason for the test",
          text: "A reason.",
          stance: "pro",
          premises: ["The reason holds."],
          conclusion: "The test passes."
        },
        {
          id: "objection",
          kind: "argument",
          title: "An objection",
          text: "An objection.",
          stance: "con",
          premises: ["The objection holds."],
          conclusion: "The test does not pass."
        }
      ],
      edges: [
        { id: "e_support_thesis", from: "support", to: "thesis", type: "support" },
        { id: "e_objection_support", from: "objection", to: "support", type: "attack" },
        { id: "e_support_objection", from: "support", to: "objection", type: "attack" }
      ]
    });
  }

  function ruling(edgeId: string, from: string, to: string): ClashJudgment {
    return {
      edgeId,
      from,
      to,
      type: "attack",
      verdict: "defeats",
      criterion: "sufficiency",
      confidence: "high",
      targetComponent: "conclusion",
      reasoning: "A test ruling."
    };
  }

  it("includes a contested pro support in the weighing pass", () => {
    const debate = contestedSupportDebate();
    const verdicts = [
      ruling("e_objection_support", "objection", "support"),
      ruling("e_support_objection", "support", "objection")
    ];
    const provisional = solveJudgment(debate, verdicts, "preponderance");
    const prompt = assessmentPrompt(debate, provisional, verdicts, "preponderance");

    expect(provisional.statuses.support).toBe("contested");
    expect(prompt).toContain("LINE e_support_thesis — PRO SUPPORT");
    expect(prompt).toContain("Source status: contested");
  });
});
