import { describe, expect, it } from "vitest";
import { reconcileDebate } from "./model";
import {
  buildJudgmentRun,
  clashEdges,
  judgmentMarkdown,
  judgmentSummary,
  motionOutcomeForDisplay,
  orderVerdicts,
  solveJudgment,
  type ArgumentQuality,
  type AttackImpact,
  type CaseLineAssessment,
  type ClashJudgment,
  type JudgmentConfidence
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

function weightedDebate(proCount: number, conCount: number) {
  const proNodes = Array.from({ length: proCount }, (_, index) => ({
    id: `pro${index}`,
    kind: "argument" as const,
    title: `Pro argument ${index + 1}`,
    text: `A supporting reason ${index + 1}.`,
    stance: "pro" as const
  }));
  const conNodes = Array.from({ length: conCount }, (_, index) => ({
    id: `con${index}`,
    kind: "argument" as const,
    title: `Con argument ${index + 1}`,
    text: `An opposing reason ${index + 1}.`,
    stance: "con" as const
  }));
  return reconcileDebate({
    id: "weighted-debate",
    motion: "Should the weighted test pass?",
    thesisId: "thesis",
    nodes: [
      { id: "thesis", kind: "statement" as const, title: "The weighted test passes", text: "The weighted test passes." },
      ...proNodes,
      ...conNodes
    ],
    edges: [
      ...proNodes.map((node) => ({
        id: `e_${node.id}_thesis`,
        from: node.id,
        to: "thesis",
        type: "support" as const
      })),
      ...conNodes.map((node) => ({
        id: `e_${node.id}_thesis`,
        from: node.id,
        to: "thesis",
        type: "attack" as const
      }))
    ]
  });
}

function assess(
  edgeId: string,
  side: "pro" | "con",
  rating: ArgumentQuality | AttackImpact,
  cluster: string,
  confidence: JudgmentConfidence = "high"
): CaseLineAssessment {
  return {
    edgeId,
    side,
    ...(side === "pro"
      ? { quality: rating as ArgumentQuality }
      : { impact: rating as AttackImpact }),
    confidence,
    cluster,
    reasoning: "A test assessment."
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
    const snapshot = solveJudgment(
      debate,
      [
        verdict("e_objection_thesis", "objection", "thesis"),
        verdict("e_rebuttal_objection", "rebuttal", "objection"),
        verdict("e_objection_rebuttal", "objection", "rebuttal")
      ],
      "preponderance"
    );
    expect(snapshot.statuses.objection).toBe("contested");
    expect(snapshot.statuses.rebuttal).toBe("contested");
    expect(snapshot.thesisStatus).toBe("contested");
    expect(snapshot.outcome).toBe("unestablished");
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

  it("treats a damaged support as pressure on the pro burden", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "support", type: "attack" }
    ]);
    const verdicts = [verdict("e_objection_support", "objection", "support", "weakens")];
    const pro = solveJudgment(debate, verdicts, "pro");
    expect(pro.outcome).toBe("unestablished");
    expect(pro.balance.pro).toBe(1.2);
    expect(solveJudgment(debate, verdicts, "preponderance").outcome).toBe("stands");
    expect(solveJudgment(debate, verdicts, "con").outcome).toBe("stands");
  });

  it("lets a lopsided pro case carry a pro burden", () => {
    const debate = weightedDebate(10, 1);
    const verdicts = [verdict("e_con0_thesis", "con0", "thesis", "weakens")];
    const assessments = [
      ...Array.from({ length: 10 }, (_, index) =>
        assess(`e_pro${index}_thesis`, "pro", "strong", `pro-line-${index}`)
      ),
      assess("e_con0_thesis", "con", "marginal", "con-line")
    ];
    const snapshot = solveJudgment(debate, verdicts, "pro", assessments);
    expect(snapshot.balance.pro).toBe(30);
    expect(snapshot.balance.con).toBe(1);
    expect(snapshot.balance.margin).toBe(29);
    expect(snapshot.outcome).toBe("stands");
  });

  it("discounts overlapping arguments instead of counting nodes", () => {
    const debate = weightedDebate(10, 1);
    const verdicts = [verdict("e_con0_thesis", "con0", "thesis", "weakens")];
    const assessments = [
      ...Array.from({ length: 10 }, (_, index) =>
        assess(`e_pro${index}_thesis`, "pro", "strong", "shared-mechanism")
      ),
      assess("e_con0_thesis", "con", "decisive", "counter-mechanism")
    ];
    const pro = solveJudgment(debate, verdicts, "pro", assessments);
    expect(pro.balance.pro).toBe(4.5);
    expect(pro.balance.margin).toBe(1.5);
    expect(pro.outcome).toBe("unestablished");
    expect(solveJudgment(debate, verdicts, "con", assessments).outcome).toBe("stands");
    expect(solveJudgment(debate, verdicts, "preponderance", assessments).outcome).toBe("stands");
  });

  it("lets the burden decide a genuinely close case", () => {
    const debate = weightedDebate(1, 1);
    const verdicts = [verdict("e_con0_thesis", "con0", "thesis", "weakens")];
    const assessments = [
      assess("e_pro0_thesis", "pro", "strong", "pro-line"),
      assess("e_con0_thesis", "con", "decisive", "con-line")
    ];
    expect(solveJudgment(debate, verdicts, "pro", assessments).outcome).toBe("unestablished");
    expect(solveJudgment(debate, verdicts, "con", assessments).outcome).toBe("stands");
    expect(solveJudgment(debate, verdicts, "preponderance", assessments).outcome).toBe("undecided");
  });

  it("lets weighted con dominance reject the motion without a direct defeat", () => {
    const debate = weightedDebate(1, 3);
    const verdicts = [
      verdict("e_con0_thesis", "con0", "thesis", "weakens"),
      verdict("e_con1_thesis", "con1", "thesis", "weakens"),
      verdict("e_con2_thesis", "con2", "thesis", "weakens")
    ];
    const assessments = [
      assess("e_pro0_thesis", "pro", "moderate", "pro-line"),
      ...Array.from({ length: 3 }, (_, index) =>
        assess(`e_con${index}_thesis`, "con", "decisive", `con-line-${index}`)
      )
    ];
    expect(solveJudgment(debate, verdicts, "pro", assessments).outcome).toBe("falls");
    expect(solveJudgment(debate, verdicts, "con", assessments).outcome).toBe("falls");
    expect(solveJudgment(debate, verdicts, "preponderance", assessments).outcome).toBe("falls");
  });

  it("keeps a direct defeat of the thesis as a hard fall", () => {
    const debate = weightedDebate(10, 1);
    const assessments = Array.from({ length: 10 }, (_, index) =>
      assess(`e_pro${index}_thesis`, "pro", "strong", `pro-line-${index}`)
    );
    const snapshot = solveJudgment(
      debate,
      [verdict("e_con0_thesis", "con0", "thesis")],
      "con",
      assessments
    );
    expect(snapshot.thesisStatus).toBe("defeated");
    expect(snapshot.outcome).toBe("falls");
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
      verdicts: [verdict("e_objection_thesis", "objection", "thesis")],
      assessments: [
        assess("e_support_thesis", "pro", "strong", "support-line"),
        assess("e_objection_thesis", "con", "decisive", "objection-line")
      ]
    });
    expect(run.outcome).toBe("falls");
    expect(run.summary).toContain("falls");
    expect(run.decisive[0]?.from).toBe("objection");
    expect(run.waves[0]?.label).toBe("The motion");
    expect(run.assessments).toHaveLength(2);
    expect(run.balance).toMatchObject({ pro: 3, con: 3, assessed: true });
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
      assessments: [
        assess("e_support_thesis", "pro", "strong", "support-line"),
        assess("e_objection_thesis", "con", "decisive", "objection-line")
      ],
      warnings: ["One clash was left open."]
    });
    const markdown = judgmentMarkdown(debate, run);
    expect(markdown).toContain("# Judgment: Should the test pass?");
    expect(markdown).toContain("**Outcome:** The motion falls");
    expect(markdown).toContain("An objection");
    expect(markdown).toContain("## Balance");
    expect(markdown).toContain("## Warnings");
    expect(markdown).toContain("One clash was left open.");
  });

  it("gives the motion card a standard-aware provisional disposition", () => {
    expect(
      motionOutcomeForDisplay({ standard: "pro", step: 0, complete: false, outcome: "stands" })
    ).toEqual({ outcome: "undecided", provisional: true });
    expect(
      motionOutcomeForDisplay({ standard: "preponderance", step: 0, complete: false, outcome: "stands" })
    ).toEqual({ outcome: "undecided", provisional: true });
    expect(
      motionOutcomeForDisplay({ standard: "con", step: 0, complete: false, outcome: "undecided" })
    ).toEqual({ outcome: "stands", provisional: true });
  });

  it("uses the live outcome after the first ruling and the final outcome when complete", () => {
    expect(
      motionOutcomeForDisplay({ standard: "pro", step: 1, complete: false, outcome: "falls" })
    ).toEqual({ outcome: "falls", provisional: true });
    expect(
      motionOutcomeForDisplay({ standard: "pro", step: 2, complete: true, outcome: "undecided" })
    ).toEqual({ outcome: "undecided", provisional: false });
  });
});
