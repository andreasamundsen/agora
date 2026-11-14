import { describe, expect, it } from "vitest";
import { reconcileDebate } from "./model";
import {
  buildJudgmentRun,
  clashEdges,
  judgmentMarkdown,
  judgmentSummary,
  orderVerdicts,
  solveJudgment,
  type ClashJudgment
} from "./judgment";

function debateWith(edges: { from: string; to: string; type: "support" | "attack" | "undercut" }[]) {
  const used = new Set(["thesis", ...edges.flatMap((edge) => [edge.from, edge.to])]);
  const allNodes = [
    { id: "thesis", kind: "statement" as const, title: "The test passes", text: "The test passes." },
    { id: "support", kind: "argument" as const, title: "A reason for the test", text: "A reason.", stance: "pro" as const },
    { id: "objection", kind: "argument" as const, title: "An objection", text: "An objection.", stance: "con" as const },
    { id: "rebuttal", kind: "argument" as const, title: "A reply", text: "A reply.", stance: "pro" as const }
  ];
  return reconcileDebate({
    id: "test-debate",
    motion: "Should the test pass?",
    thesisId: "thesis",
    nodes: allNodes.filter((node) => used.has(node.id)),
    edges: edges.map((edge) => ({ ...edge, id: `e_${edge.from}_${edge.to}` }))
  });
}

function verdict(edgeId: string, from: string, to: string, value: ClashJudgment["verdict"] = "defeats"): ClashJudgment {
  return {
    edgeId,
    from,
    to,
    type: "attack",
    verdict: value,
    criterion: "sufficiency",
    confidence: "high",
    targetComponent: "conclusion",
    reasoning: "A test ruling."
  };
}

describe("judgment solver", () => {
  it("defeats the thesis when a standing objection strikes it", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "thesis", type: "attack" }
    ]);
    const snapshot = solveJudgment(debate, [verdict("e_objection_thesis", "objection", "thesis")]);
    expect(snapshot.thesisStatus).toBe("defeated");
    expect(snapshot.outcome).toBe("falls");
    expect(snapshot.statuses.objection).toBe("standing");
  });

  it("reinstates the thesis when the objection is itself defeated", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "thesis", type: "attack" },
      { from: "rebuttal", to: "objection", type: "attack" }
    ]);
    const snapshot = solveJudgment(debate, [
      verdict("e_objection_thesis", "objection", "thesis"),
      verdict("e_rebuttal_objection", "rebuttal", "objection")
    ]);
    expect(snapshot.statuses.objection).toBe("defeated");
    expect(snapshot.thesisStatus).toBe("standing");
    expect(snapshot.outcome).toBe("stands");
    expect(snapshot.liveSupports).toHaveLength(1);
  });

  it("leaves a mutual attack contested rather than inventing a winner", () => {
    const debate = debateWith([
      { from: "objection", to: "thesis", type: "attack" },
      { from: "rebuttal", to: "objection", type: "attack" },
      { from: "objection", to: "rebuttal", type: "attack" }
    ]);
    const snapshot = solveJudgment(debate, [
      verdict("e_objection_thesis", "objection", "thesis"),
      verdict("e_rebuttal_objection", "rebuttal", "objection"),
      verdict("e_objection_rebuttal", "objection", "rebuttal")
    ]);
    expect(snapshot.statuses.objection).toBe("contested");
    expect(snapshot.statuses.rebuttal).toBe("contested");
    expect(snapshot.thesisStatus).toBe("contested");
    expect(snapshot.outcome).toBe("undecided");
  });

  it("applies the standard of proof to an unresolved direct contest", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "thesis", type: "attack" },
      { from: "rebuttal", to: "objection", type: "attack" },
      { from: "objection", to: "rebuttal", type: "attack" }
    ]);
    const verdicts = [
      verdict("e_objection_thesis", "objection", "thesis"),
      verdict("e_rebuttal_objection", "rebuttal", "objection"),
      verdict("e_objection_rebuttal", "objection", "rebuttal")
    ];
    expect(solveJudgment(debate, verdicts, "preponderance").outcome).toBe("undecided");
    expect(solveJudgment(debate, verdicts, "pro").outcome).toBe("unestablished");
    expect(solveJudgment(debate, verdicts, "con").outcome).toBe("stands");
  });

  it("distinguishes an unestablished motion from a defeated one", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "support", type: "attack" }
    ]);
    const snapshot = solveJudgment(debate, [verdict("e_objection_support", "objection", "support")]);
    expect(snapshot.statuses.support).toBe("defeated");
    expect(snapshot.thesisStatus).toBe("standing");
    expect(snapshot.liveSupports).toHaveLength(0);
    expect(snapshot.outcome).toBe("unestablished");
  });

  it("treats weakened and undecided direct attacks as live pressure", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "thesis", type: "attack" }
    ]);
    for (const value of ["weakens", "undecided"] as const) {
      const verdicts = [verdict("e_objection_thesis", "objection", "thesis", value)];
      const pro = solveJudgment(debate, verdicts, "pro");
      expect(pro.outcome).toBe("unestablished");
      expect(pro.liveAttacks).toEqual(["e_objection_thesis"]);
      expect(solveJudgment(debate, verdicts, "preponderance").outcome).toBe("undecided");
      expect(solveJudgment(debate, verdicts, "con").outcome).toBe("stands");
    }
  });

  it("does not let a defeated objection remain live pressure", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "thesis", type: "attack" },
      { from: "rebuttal", to: "objection", type: "attack" }
    ]);
    const snapshot = solveJudgment(
      debate,
      [
        verdict("e_objection_thesis", "objection", "thesis", "weakens"),
        verdict("e_rebuttal_objection", "rebuttal", "objection")
      ],
      "pro"
    );
    expect(snapshot.statuses.objection).toBe("defeated");
    expect(snapshot.liveAttacks).toHaveLength(0);
    expect(snapshot.cleanSupports).toEqual(["e_support_thesis"]);
    expect(snapshot.outcome).toBe("stands");
  });

  it("treats a damaged support as live pressure on the burden carrier", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "support", type: "attack" }
    ]);
    const verdicts = [verdict("e_objection_support", "objection", "support", "weakens")];
    expect(solveJudgment(debate, verdicts, "pro").outcome).toBe("unestablished");
    expect(solveJudgment(debate, verdicts, "preponderance").outcome).toBe("undecided");
    expect(solveJudgment(debate, verdicts, "con").outcome).toBe("stands");
  });

  it("lets an irrelevant direct attack leave the motion standing", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "thesis", type: "attack" }
    ]);
    const snapshot = solveJudgment(
      debate,
      [verdict("e_objection_thesis", "objection", "thesis", "irrelevant")],
      "pro"
    );
    expect(snapshot.liveAttacks).toHaveLength(0);
    expect(snapshot.outcome).toBe("stands");
  });

  it("writes the live objection into the unestablished summary", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "thesis", type: "attack" }
    ]);
    const summary = judgmentSummary(
      debate,
      [verdict("e_objection_thesis", "objection", "thesis", "weakens")],
      "pro"
    );
    expect(summary.outcome).toBe("unestablished");
    expect(summary.summary).toContain("live objection");
    expect(summary.decisive[0]?.kind).toBe("attack");
  });

  it("shows a pressured support when no direct objection is live", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "support", type: "attack" }
    ]);
    const summary = judgmentSummary(
      debate,
      [verdict("e_objection_support", "objection", "support", "weakens")],
      "pro"
    );
    expect(summary.outcome).toBe("unestablished");
    expect(summary.summary).toContain("supporting case remains contested");
    expect(summary.decisive[0]?.kind).toBe("support");
  });

  it("orders direct clashes before replies and labels the waves", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "thesis", type: "attack" },
      { from: "rebuttal", to: "objection", type: "attack" },
      { from: "support", to: "rebuttal", type: "attack" }
    ]);
    const ordered = orderVerdicts(debate, [
      verdict("e_support_rebuttal", "support", "rebuttal"),
      verdict("e_rebuttal_objection", "rebuttal", "objection"),
      verdict("e_objection_thesis", "objection", "thesis")
    ]);
    expect(ordered.verdicts.map((item) => item.edgeId)).toEqual([
      "e_objection_thesis",
      "e_rebuttal_objection",
      "e_support_rebuttal"
    ]);
    expect(ordered.waves.map((wave) => wave.label)).toEqual([
      "The motion",
      "The first case",
      "The replies"
    ]);
  });

  it("writes a run with a decisive path and a readable summary", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "thesis", type: "attack" }
    ]);
    const run = buildJudgmentRun({
      id: "run-1",
      debate,
      engine: "llm",
      judge: { provider: "test", model: "judge" },
      standard: "pro",
      strictness: "balanced",
      verdicts: [verdict("e_objection_thesis", "objection", "thesis")]
    });
    expect(run.outcome).toBe("falls");
    expect(run.summary).toContain("falls");
    expect(run.decisive[0]?.from).toBe("objection");
    expect(run.waves[0]?.label).toBe("The motion");
  });

  it("reports an unestablished outcome when support is removed", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "support", type: "attack" }
    ]);
    const summary = judgmentSummary(debate, [verdict("e_objection_support", "objection", "support")]);
    expect(summary.outcome).toBe("unestablished");
    expect(summary.summary).toContain("unestablished");
  });

  it("only treats attacks and undercuts as clashes", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "thesis", type: "attack" },
      { from: "rebuttal", to: "objection", type: "undercut" }
    ]);
    expect(clashEdges(debate).map((edge) => edge.id)).toEqual([
      "e_objection_thesis",
      "e_rebuttal_objection"
    ]);
  });

  it("writes a portable markdown report with rulings and warnings", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "thesis", type: "attack" }
    ]);
    const run = buildJudgmentRun({
      id: "run-report",
      debate,
      engine: "llm",
      judge: { provider: "test", model: "judge" },
      standard: "pro",
      strictness: "balanced",
      verdicts: [verdict("e_objection_thesis", "objection", "thesis")],
      warnings: ["One clash was left open."]
    });
    const markdown = judgmentMarkdown(debate, run);
    expect(markdown).toContain("# Judgment: Should the test pass?");
    expect(markdown).toContain("**Outcome:** The motion falls");
    expect(markdown).toContain("An objection");
    expect(markdown).toContain("## Warnings");
    expect(markdown).toContain("One clash was left open.");
  });
});
