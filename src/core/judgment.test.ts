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
    const snapshot = solveJudgment(
      debate,
      [verdict("e_objection_thesis", "objection", "thesis")],
      "preponderance",
      [assess("e_objection_thesis", "con", "decisive", "objection-line")]
    );
    expect(snapshot.thesisStatus).toBe("defeated");
    expect(snapshot.outcome).toBe("falls");
    expect(snapshot.statuses.objection).toBe("standing");
  });

  it("leaves a direct defeat to the balance when the weighing pass is unavailable", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "thesis", type: "attack" }
    ]);
    const snapshot = solveJudgment(debate, [verdict("e_objection_thesis", "objection", "thesis")]);
    expect(snapshot.hardDefeats).toEqual([]);
    expect(snapshot.withheldHardDefeats).toEqual(["e_objection_thesis"]);
    expect(snapshot.thesisStatus).toBe("contested");
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

  it("can mark a contested argument as weakened", () => {
    const debate = debateWith([
      { from: "objection", to: "thesis", type: "attack" },
      { from: "rebuttal", to: "objection", type: "attack" },
      { from: "objection", to: "rebuttal", type: "attack" },
      { from: "support", to: "objection", type: "attack" }
    ]);
    const snapshot = solveJudgment(
      debate,
      [
        verdict("e_objection_thesis", "objection", "thesis"),
        verdict("e_rebuttal_objection", "rebuttal", "objection"),
        verdict("e_objection_rebuttal", "objection", "rebuttal"),
        verdict("e_support_objection", "support", "objection", "weakens")
      ],
      "preponderance"
    );
    expect(snapshot.statuses.objection).toBe("contested");
    expect(snapshot.weakened).toEqual(["objection"]);
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

  it("marks a surviving weakens target as weakened without changing its status", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "support", type: "attack" }
    ]);
    const snapshot = solveJudgment(
      debate,
      [verdict("e_objection_support", "objection", "support", "weakens")],
      "pro"
    );
    expect(snapshot.statuses.support).toBe("standing");
    expect(snapshot.weakened).toEqual(["support"]);
    expect(snapshot.outcome).toBe("unestablished");
  });

  it("does not mark the thesis, a defeated target, or a defeated attacker as weakened", () => {
    const thesisTarget = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "thesis", type: "attack" }
    ]);
    expect(
      solveJudgment(
        thesisTarget,
        [verdict("e_objection_thesis", "objection", "thesis", "weakens")],
        "pro"
      ).weakened
    ).toEqual([]);

    const defeatedTarget = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "support", type: "attack" },
      { from: "rebuttal", to: "support", type: "attack" }
    ]);
    expect(
      solveJudgment(
        defeatedTarget,
        [
          verdict("e_rebuttal_support", "rebuttal", "support", "defeats"),
          verdict("e_objection_support", "objection", "support", "weakens")
        ],
        "pro"
      ).weakened
    ).toEqual([]);

    const defeatedAttacker = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "support", type: "attack" },
      { from: "rebuttal", to: "objection", type: "attack" }
    ]);
    expect(
      solveJudgment(
        defeatedAttacker,
        [
          verdict("e_rebuttal_objection", "rebuttal", "objection", "defeats"),
          verdict("e_objection_support", "objection", "support", "weakens")
        ],
        "pro"
      ).weakened
    ).toEqual([]);
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

  it("gives a contested pro support half weight instead of dropping it", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "support", type: "attack" },
      { from: "support", to: "objection", type: "attack" }
    ]);
    const snapshot = solveJudgment(
      debate,
      [
        verdict("e_objection_support", "objection", "support"),
        verdict("e_support_objection", "support", "objection")
      ],
      "preponderance",
      [assess("e_support_thesis", "pro", "strong", "pro-line")]
    );
    expect(snapshot.statuses.support).toBe("contested");
    expect(snapshot.balance.pro).toBe(1.5);
    const line = snapshot.balance.lines.find((candidate) => candidate.edgeId === "e_support_thesis");
    expect(line?.survival).toBe(0.5);
    expect(line?.pressure).toBe(1);
    expect(snapshot.balance.con).toBe(0);
    expect(snapshot.unsupportedThesis).toBe(false);
  });

  it("keeps a contested con attack at half weight", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "thesis", type: "attack" },
      { from: "rebuttal", to: "objection", type: "attack" },
      { from: "objection", to: "rebuttal", type: "attack" }
    ]);
    const snapshot = solveJudgment(
      debate,
      [
        verdict("e_objection_thesis", "objection", "thesis", "weakens"),
        verdict("e_rebuttal_objection", "rebuttal", "objection"),
        verdict("e_objection_rebuttal", "objection", "rebuttal")
      ],
      "preponderance",
      [assess("e_objection_thesis", "con", "decisive", "con-line")]
    );
    expect(snapshot.statuses.objection).toBe("contested");
    const line = snapshot.balance.lines.find((candidate) => candidate.edgeId === "e_objection_thesis");
    expect(line?.survival).toBe(0.5);
    expect(line?.weight).toBe(1.5);
    expect(snapshot.balance.con).toBe(1.5);
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
        assess(`e_pro${index}_thesis`, "pro", "moderate", "shared-mechanism")
      ),
      assess("e_con0_thesis", "con", "decisive", "counter-mechanism")
    ];
    const pro = solveJudgment(debate, verdicts, "pro", assessments);
    expect(pro.balance.pro).toBe(3);
    expect(pro.balance.margin).toBe(0);
    expect(pro.outcome).toBe("unestablished");
    expect(solveJudgment(debate, verdicts, "con", assessments).outcome).toBe("stands");
    expect(solveJudgment(debate, verdicts, "preponderance", assessments).outcome).toBe("undecided");
  });

  it("lets the burden decide a genuinely close case", () => {
    const debate = weightedDebate(1, 1);
    const verdicts = [verdict("e_con0_thesis", "con0", "thesis", "weakens")];
    const assessments = [
      assess("e_pro0_thesis", "pro", "moderate", "pro-line"),
      assess("e_con0_thesis", "con", "material", "con-line")
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

  it("keeps a corroborated direct defeat of the thesis as a hard fall", () => {
    const debate = weightedDebate(10, 1);
    const assessments = [
      ...Array.from({ length: 10 }, (_, index) =>
        assess(`e_pro${index}_thesis`, "pro", "moderate", `pro-line-${index}`)
      ),
      assess("e_con0_thesis", "con", "decisive", "con-line")
    ];
    const snapshot = solveJudgment(
      debate,
      [verdict("e_con0_thesis", "con0", "thesis")],
      "con",
      assessments
    );
    expect(snapshot.thesisStatus).toBe("defeated");
    expect(snapshot.outcome).toBe("falls");
    expect(snapshot.hardDefeats).toEqual(["e_con0_thesis"]);
    expect(snapshot.withheldHardDefeats).toEqual([]);
  });

  it("withholds a hard fall when the weighing pass does not corroborate it", () => {
    const debate = weightedDebate(3, 1);
    const verdicts = [verdict("e_con0_thesis", "con0", "thesis")];
    const proAssessments = Array.from({ length: 3 }, (_, index) =>
      assess(`e_pro${index}_thesis`, "pro", "moderate", `pro-line-${index}`)
    );
    for (const [impact, confidence] of [
      ["material", "high"],
      ["decisive", "low"]
    ] as const) {
      const snapshot = solveJudgment(debate, verdicts, "pro", [
        ...proAssessments,
        assess("e_con0_thesis", "con", impact, "con-line", confidence)
      ]);
      expect(snapshot.thesisStatus).toBe("contested");
      expect(snapshot.outcome).toBe("stands");
      expect(snapshot.hardDefeats).toEqual([]);
      expect(snapshot.withheldHardDefeats).toEqual(["e_con0_thesis"]);
    }
  });

  it("does not let a weakened objection deliver a hard fall", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "thesis", type: "attack" },
      { from: "rebuttal", to: "objection", type: "attack" }
    ]);
    const snapshot = solveJudgment(
      debate,
      [
        verdict("e_objection_thesis", "objection", "thesis"),
        verdict("e_rebuttal_objection", "rebuttal", "objection", "weakens")
      ],
      "preponderance",
      [
        assess("e_support_thesis", "pro", "moderate", "support-line"),
        assess("e_objection_thesis", "con", "decisive", "objection-line")
      ]
    );
    expect(snapshot.statuses.objection).toBe("standing");
    expect(snapshot.weakened).toEqual(["objection"]);
    expect(snapshot.thesisStatus).toBe("contested");
    expect(snapshot.hardDefeats).toEqual([]);
    expect(snapshot.withheldHardDefeats).toEqual(["e_objection_thesis"]);
  });

  it("treats a certified proof and a corroborated defeat as a contested record", () => {
    const debate = weightedDebate(1, 1);
    const snapshot = solveJudgment(
      debate,
      [verdict("e_con0_thesis", "con0", "thesis")],
      "pro",
      [
        assess("e_pro0_thesis", "pro", "strong", "pro-line", "high"),
        assess("e_con0_thesis", "con", "decisive", "con-line")
      ]
    );
    expect(snapshot.proofs).toEqual(["e_pro0_thesis"]);
    expect(snapshot.hardDefeats).toEqual(["e_con0_thesis"]);
    expect(snapshot.proofConflict).toBe(true);
    expect(snapshot.thesisStatus).toBe("contested");
    expect(snapshot.outcome).toBe("undecided");
    expect(snapshot.balance.lines.find((line) => line.edgeId === "e_pro0_thesis")?.proves).toBe(true);
  });

  it("explains a certified proof and corroborated defeat as a contested tie", () => {
    const debate = weightedDebate(1, 1);
    const verdicts = [verdict("e_con0_thesis", "con0", "thesis")];
    const assessments = [
      assess("e_pro0_thesis", "pro", "strong", "pro-line", "high"),
      assess("e_con0_thesis", "con", "decisive", "con-line")
    ];
    const summary = judgmentSummary(debate, verdicts, "pro", assessments);
    expect(summary.outcome).toBe("undecided");
    expect(summary.summary).toContain("neither can displace the other");
    expect(summary.decisive.map((step) => step.edgeId)).toEqual(["e_pro0_thesis", "e_con0_thesis"]);
  });

  it("lets a certified proof carry the motion without a direct defeat", () => {
    const debate = weightedDebate(1, 1);
    const snapshot = solveJudgment(
      debate,
      [verdict("e_con0_thesis", "con0", "thesis", "weakens")],
      "pro",
      [
        assess("e_pro0_thesis", "pro", "strong", "pro-line", "high"),
        assess("e_con0_thesis", "con", "material", "con-line")
      ]
    );
    expect(snapshot.proofs).toEqual(["e_pro0_thesis"]);
    expect(snapshot.proofConflict).toBe(false);
    expect(snapshot.thesisStatus).toBe("standing");
    expect(snapshot.outcome).toBe("stands");
  });

  it("lets a certified proof stand when the direct defeat is not corroborated", () => {
    const debate = weightedDebate(1, 1);
    const snapshot = solveJudgment(
      debate,
      [verdict("e_con0_thesis", "con0", "thesis")],
      "pro",
      [
        assess("e_pro0_thesis", "pro", "strong", "pro-line", "high"),
        assess("e_con0_thesis", "con", "material", "con-line")
      ]
    );
    expect(snapshot.proofs).toEqual(["e_pro0_thesis"]);
    expect(snapshot.hardDefeats).toEqual([]);
    expect(snapshot.withheldHardDefeats).toEqual(["e_con0_thesis"]);
    expect(snapshot.proofConflict).toBe(false);
    expect(snapshot.thesisStatus).toBe("standing");
    expect(snapshot.outcome).toBe("stands");
  });

  it("does not certify a proof when a live attack keeps the support under pressure", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "support", type: "attack" }
    ]);
    const snapshot = solveJudgment(
      debate,
      [verdict("e_objection_support", "objection", "support", "weakens")],
      "pro",
      [
        assess("e_support_thesis", "pro", "strong", "pro-line", "high"),
        assess("e_objection_support", "con", "material", "attack-line")
      ]
    );
    expect(snapshot.proofs).toEqual([]);
    expect(snapshot.proofConflict).toBe(false);
  });

  it("applies the same strictness bar to a proof and a hard defeat", () => {
    const debate = weightedDebate(1, 1);
    const assessments = [
      assess("e_pro0_thesis", "pro", "strong", "pro-line", "medium"),
      assess("e_con0_thesis", "con", "decisive", "con-line", "medium")
    ];
    const strict = solveJudgment(
      debate,
      [verdict("e_con0_thesis", "con0", "thesis")],
      "pro",
      assessments,
      "strict"
    );
    expect(strict.proofs).toEqual([]);
    expect(strict.hardDefeats).toEqual([]);
    expect(strict.thesisStatus).toBe("contested");

    const balanced = solveJudgment(
      debate,
      [verdict("e_con0_thesis", "con0", "thesis")],
      "pro",
      assessments,
      "balanced"
    );
    expect(balanced.proofs).toEqual(["e_pro0_thesis"]);
    expect(balanced.hardDefeats).toEqual(["e_con0_thesis"]);
    expect(balanced.proofConflict).toBe(true);
    expect(balanced.thesisStatus).toBe("contested");
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
    expect(snapshot.irrelevant).toEqual(["objection"]);
    expect(snapshot.outcome).toBe("stands");
  });

  it("keeps a shared reply normal when one outgoing clash still lands", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "thesis", type: "attack" },
      { from: "objection", to: "support", type: "attack" }
    ]);
    const snapshot = solveJudgment(
      debate,
      [
        verdict("e_objection_thesis", "objection", "thesis", "irrelevant"),
        verdict("e_objection_support", "objection", "support", "weakens")
      ],
      "pro"
    );
    expect(snapshot.irrelevant).toEqual([]);
  });

  it("does not mark a card with a live support role", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "support", to: "objection", type: "attack" },
      { from: "objection", to: "thesis", type: "attack" }
    ]);
    const snapshot = solveJudgment(
      debate,
      [
        verdict("e_support_objection", "support", "objection", "irrelevant"),
        verdict("e_objection_thesis", "objection", "thesis", "irrelevant")
      ],
      "pro"
    );
    expect(snapshot.irrelevant).toContain("objection");
    expect(snapshot.irrelevant).not.toContain("support");
  });

  it("keeps the irrelevant marker when the argument is also defeated", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "thesis", type: "attack" },
      { from: "rebuttal", to: "objection", type: "attack" }
    ]);
    const snapshot = solveJudgment(
      debate,
      [
        verdict("e_objection_thesis", "objection", "thesis", "irrelevant"),
        verdict("e_rebuttal_objection", "rebuttal", "objection", "defeats")
      ],
      "pro"
    );
    expect(snapshot.statuses.objection).toBe("defeated");
    expect(snapshot.irrelevant).toContain("objection");
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

  it("keeps a direct support opening when the branch's first ruling answers it", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" },
      { from: "objection", to: "support", type: "attack" }
    ]);
    const ordered = orderVerdicts(debate, [
      verdict("e_objection_support", "objection", "support")
    ]);
    const supportCase = ordered.waves.find((wave) => wave.rootId === "support");
    expect(supportCase).toMatchObject({
      rootKind: "support",
      rootEdgeId: "e_support_thesis",
      startStep: 0,
      verdictIds: ["e_objection_support"]
    });
    expect(supportCase?.openings).toEqual([
      { step: 0, nodeId: "support", edgeId: "e_support_thesis" }
    ]);
  });

  it("still gives a clean direct support its opening and an empty case shell", () => {
    const debate = debateWith([
      { from: "support", to: "thesis", type: "support" }
    ]);
    const ordered = orderVerdicts(debate, []);
    const supportCase = ordered.waves.find((wave) => wave.rootId === "support");
    expect(supportCase).toMatchObject({
      rootKind: "support",
      rootEdgeId: "e_support_thesis",
      startStep: 0,
      verdictIds: []
    });
    expect(supportCase?.openings).toEqual([
      { step: 0, nodeId: "support", edgeId: "e_support_thesis" }
    ]);
  });

  it("plays direct clashes and reply chains as seeded branches", () => {
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
    expect(ordered.waves.map((wave) => wave.label)).toEqual(["Branch 1", "Branch 2"]);
    const supportCase = ordered.waves.find((wave) => wave.rootId === "support");
    expect(supportCase?.rootKind).toBe("support");
    expect(supportCase?.verdictIds).toEqual([]);
    expect(ordered.waves.flatMap((wave) => wave.verdictIds)).toHaveLength(3);
  });

  it("follows one reply branch to its leaf before returning to the fork", () => {
    const debate = reconcileDebate({
      id: "breadth-debate",
      motion: "Should the branches pass?",
      thesisId: "thesis",
      nodes: [
        { id: "thesis", kind: "statement", title: "The branches pass", text: "The branches pass." },
        { id: "root", kind: "argument", title: "The root", text: "A root.", stance: "con" },
        { id: "left", kind: "argument", title: "A left reply", text: "A left reply.", stance: "pro" },
        { id: "right", kind: "argument", title: "A right reply", text: "A right reply.", stance: "con" },
        { id: "left1", kind: "argument", title: "A reply to left", text: "A reply.", stance: "con" },
        { id: "left2", kind: "argument", title: "Another reply to left", text: "A reply.", stance: "pro" },
        { id: "right1", kind: "argument", title: "A reply to right", text: "A reply.", stance: "pro" }
      ],
      edges: [
        { id: "e_root_thesis", from: "root", to: "thesis", type: "attack" },
        { id: "e_left_root", from: "left", to: "root", type: "attack" },
        { id: "e_right_root", from: "right", to: "root", type: "attack" },
        { id: "e_left1_left", from: "left1", to: "left", type: "attack" },
        { id: "e_left2_left", from: "left2", to: "left", type: "attack" },
        { id: "e_right1_right", from: "right1", to: "right", type: "attack" }
      ]
    });
    const ordered = orderVerdicts(debate, [
      verdict("e_root_thesis", "root", "thesis"),
      verdict("e_left_root", "left", "root"),
      verdict("e_right_root", "right", "root"),
      verdict("e_left1_left", "left1", "left"),
      verdict("e_left2_left", "left2", "left"),
      verdict("e_right1_right", "right1", "right")
    ]);
    expect(ordered.waves).toHaveLength(3);
    expect(ordered.waves.slice(0, 2).every((wave) => wave.rootId === "root")).toBe(true);
    expect(ordered.waves[0]?.verdictIds[0]).toBe("e_root_thesis");
    const ids = ordered.verdicts.map((item) => item.edgeId);
    const position = (id: string) => ids.indexOf(id);
    expect(position("e_root_thesis")).toBe(0);
    const firstDepth = ["e_left_root", "e_right_root"].sort(
      (a, b) => position(a) - position(b)
    );
    const firstParent = firstDepth[0]!;
    const secondParent = firstDepth[1]!;
    const firstChildren =
      firstParent === "e_left_root"
        ? ["e_left1_left", "e_left2_left"]
        : ["e_right1_right"];
    expect(firstChildren.length).toBeGreaterThan(0);
    const chosenChild = firstChildren.find((child) => position(child) < position(secondParent));
    expect(chosenChild).toBeDefined();
  });

  it("follows a reply to its own reply before the next reply at the fork", () => {
    const debate = reconcileDebate({
      id: "leaf-branch-debate",
      motion: "Should the leaf branch play?",
      thesisId: "thesis",
      nodes: [
        { id: "thesis", kind: "statement", title: "The leaf branch plays", text: "It plays." },
        { id: "root", kind: "argument", title: "The root", text: "A root.", stance: "con" },
        { id: "replya", kind: "argument", title: "Reply A", text: "A reply.", stance: "pro" },
        { id: "leaf", kind: "argument", title: "Leaf", text: "A reply to A.", stance: "con" },
        { id: "replyb", kind: "argument", title: "Reply B", text: "Another reply.", stance: "pro" }
      ],
      edges: [
        { id: "e_root_thesis", from: "root", to: "thesis", type: "attack" },
        { id: "e_a_root", from: "replya", to: "root", type: "attack" },
        { id: "e_leaf_a", from: "leaf", to: "replya", type: "attack" },
        { id: "e_b_root", from: "replyb", to: "root", type: "attack" }
      ]
    });
    const ordered = orderVerdicts(debate, [
      verdict("e_root_thesis", "root", "thesis"),
      verdict("e_a_root", "replya", "root"),
      verdict("e_leaf_a", "leaf", "replya"),
      verdict("e_b_root", "replyb", "root")
    ]);
    const ids = ordered.verdicts.map((item) => item.edgeId);
    const aFirst = ids.indexOf("e_a_root") < ids.indexOf("e_b_root");
    expect(ids).toEqual(
      aFirst
        ? ["e_root_thesis", "e_a_root", "e_leaf_a", "e_b_root"]
        : ["e_root_thesis", "e_b_root", "e_a_root", "e_leaf_a"]
    );
  });

  it("opens a nested support before a reply that answers it", () => {
    const debate = reconcileDebate({
      id: "nested-support-debate",
      motion: "Should the nested support open?",
      thesisId: "thesis",
      nodes: [
        { id: "thesis", kind: "statement", title: "The nested support opens", text: "It opens." },
        { id: "root", kind: "argument", title: "The root objection", text: "An objection.", stance: "con" },
        { id: "support", kind: "argument", title: "The nested support", text: "A reason.", stance: "pro" },
        { id: "reply", kind: "argument", title: "The reply to the support", text: "A reply.", stance: "con" }
      ],
      edges: [
        { id: "e_root_thesis", from: "root", to: "thesis", type: "attack" },
        { id: "e_support_root", from: "support", to: "root", type: "support" },
        { id: "e_reply_support", from: "reply", to: "support", type: "attack" }
      ]
    });
    const ordered = orderVerdicts(debate, [
      verdict("e_root_thesis", "root", "thesis"),
      verdict("e_reply_support", "reply", "support")
    ]);
    expect(ordered.verdicts.map((item) => item.edgeId)).toEqual([
      "e_root_thesis",
      "e_reply_support"
    ]);
    const supportOpening = ordered.waves
      .flatMap((wave) => wave.openings ?? [])
      .find((opening) => opening.nodeId === "support");
    expect(supportOpening?.edgeId).toBe("e_support_root");
    expect(supportOpening?.step).toBe(1);
  });

  it("drains one direct stem before starting the next", () => {
    const debate = reconcileDebate({
      id: "stem-pass-debate",
      motion: "Should every stem get a branch?",
      thesisId: "thesis",
      nodes: [
        { id: "thesis", kind: "statement", title: "Every stem gets a branch", text: "It does." },
        { id: "roota", kind: "argument", title: "A con stem", text: "A con reason.", stance: "con" },
        { id: "rootb", kind: "argument", title: "A pro stem", text: "A pro reason.", stance: "pro" },
        { id: "a1", kind: "argument", title: "First reply to A", text: "A reply.", stance: "pro" },
        { id: "a1c", kind: "argument", title: "A reply under A1", text: "A deeper reply.", stance: "con" },
        { id: "a2", kind: "argument", title: "Second reply to A", text: "Another reply.", stance: "pro" },
        { id: "b1", kind: "argument", title: "Reply to B", text: "A reply.", stance: "con" }
      ],
      edges: [
        { id: "e_roota_thesis", from: "roota", to: "thesis", type: "attack" },
        { id: "e_rootb_thesis", from: "rootb", to: "thesis", type: "support" },
        { id: "e_a1_roota", from: "a1", to: "roota", type: "attack" },
        { id: "e_a1c_a1", from: "a1c", to: "a1", type: "attack" },
        { id: "e_a2_roota", from: "a2", to: "roota", type: "attack" },
        { id: "e_b1_rootb", from: "b1", to: "rootb", type: "attack" }
      ]
    });
    const ordered = orderVerdicts(debate, [
      verdict("e_roota_thesis", "roota", "thesis"),
      verdict("e_rootb_thesis", "rootb", "thesis"),
      verdict("e_a1_roota", "a1", "roota"),
      verdict("e_a1c_a1", "a1c", "a1"),
      verdict("e_a2_roota", "a2", "roota"),
      verdict("e_b1_rootb", "b1", "rootb")
    ], "stem-pass");
    // Stem A must finish all of its replies before stem B begins. The seed
    // puts roota first in this fixture.
    expect(ordered.waves.slice(0, 2).map((wave) => wave.rootId)).toEqual(["roota", "roota"]);
    const ids = ordered.verdicts.map((item) => item.edgeId);
    const rootbStart = ids.indexOf("e_rootb_thesis");
    expect(rootbStart).toBeGreaterThan(0);
    expect(ids.indexOf("e_a1_roota")).toBeLessThan(rootbStart);
    expect(ids.indexOf("e_a1c_a1")).toBeLessThan(rootbStart);
    expect(ids.indexOf("e_a2_roota")).toBeLessThan(rootbStart);
  });

  it("alternates sides for case roots when both sides are available", () => {
    const debate = reconcileDebate({
      id: "side-case-debate",
      motion: "Should the sides alternate?",
      thesisId: "thesis",
      nodes: [
        { id: "thesis", kind: "statement", title: "The sides alternate", text: "The sides alternate." },
        { id: "pro1", kind: "argument", title: "A pro reason", text: "A reason.", stance: "pro" },
        { id: "con1", kind: "argument", title: "A con reason", text: "A reason.", stance: "con" },
        { id: "pro2", kind: "argument", title: "Another pro reason", text: "A reason.", stance: "pro" },
        { id: "con2", kind: "argument", title: "Another con reason", text: "A reason.", stance: "con" }
      ],
      edges: [
        { id: "e_pro1", from: "pro1", to: "thesis", type: "support" },
        { id: "e_con1", from: "con1", to: "thesis", type: "attack" },
        { id: "e_pro2", from: "pro2", to: "thesis", type: "support" },
        { id: "e_con2", from: "con2", to: "thesis", type: "attack" }
      ]
    });
    const ordered = orderVerdicts(debate, [
      verdict("e_con1", "con1", "thesis"),
      verdict("e_con2", "con2", "thesis")
    ]);
    expect(ordered.waves).toHaveLength(4);
    expect(ordered.waves[0]?.side).not.toBe(ordered.waves[1]?.side);
    expect(ordered.waves[1]?.side).not.toBe(ordered.waves[2]?.side);
    expect(ordered.waves.every((wave) => wave.verdictIds.length === 0 || wave.side)).toBe(true);
  });

  it("keeps each stem's reply chain together and seeds the branch order", () => {
    const debate = reconcileDebate({
      id: "branch-debate",
      motion: "Should the branches pass?",
      thesisId: "thesis",
      nodes: [
        { id: "thesis", kind: "statement", title: "The branches pass", text: "The branches pass." },
        { id: "support", kind: "argument", title: "A support", text: "A reason.", stance: "pro" },
        { id: "objection", kind: "argument", title: "An objection", text: "An objection.", stance: "con" },
        { id: "rebuttal", kind: "argument", title: "A reply", text: "A reply.", stance: "pro" },
        { id: "second", kind: "argument", title: "A second objection", text: "Another objection.", stance: "con" },
        { id: "reply2", kind: "argument", title: "A second reply", text: "Another reply.", stance: "pro" }
      ],
      edges: [
        { id: "e_support_thesis", from: "support", to: "thesis", type: "support" },
        { id: "e_objection_thesis", from: "objection", to: "thesis", type: "attack" },
        { id: "e_rebuttal_objection", from: "rebuttal", to: "objection", type: "attack" },
        { id: "e_second_thesis", from: "second", to: "thesis", type: "attack" },
        { id: "e_reply2_second", from: "reply2", to: "second", type: "attack" }
      ]
    });
    const verdicts = [
      verdict("e_reply2_second", "reply2", "second"),
      verdict("e_objection_thesis", "objection", "thesis"),
      verdict("e_second_thesis", "second", "thesis"),
      verdict("e_rebuttal_objection", "rebuttal", "objection")
    ];
    const ordered = orderVerdicts(debate, verdicts, "branch-seed");
    expect(ordered.verdicts).toHaveLength(4);
    expect(ordered.waves).toHaveLength(3);
    expect(ordered.waves.map((wave) => wave.label)).toEqual(["Branch 1", "Branch 2", "Branch 3"]);
    const byRoot = new Map(ordered.waves.map((wave) => [wave.rootId, [...wave.verdictIds].sort()]));
    expect(byRoot.get("support")).toEqual([]);
    expect(byRoot.get("objection")).toEqual(["e_objection_thesis", "e_rebuttal_objection"]);
    expect(byRoot.get("second")).toEqual(["e_reply2_second", "e_second_thesis"]);
    expect(orderVerdicts(debate, verdicts, "branch-seed")).toEqual(ordered);
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
        assess("e_support_thesis", "pro", "moderate", "support-line"),
        assess("e_objection_thesis", "con", "decisive", "objection-line")
      ]
    });
    expect(run.outcome).toBe("falls");
    expect(run.summary).toContain("falls");
    expect(run.decisive[0]?.from).toBe("objection");
    expect(run.waves[0]?.label).toBe("Branch 1");
    expect(run.assessments).toHaveLength(2);
    expect(run.balance).toMatchObject({ pro: 2, con: 3, assessed: true });
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
        assess("e_support_thesis", "pro", "moderate", "support-line"),
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
      motionOutcomeForDisplay({
        standard: "pro",
        complete: false,
        outcome: "stands",
        thesisStatus: "standing",
        proofConflict: false
      })
    ).toEqual({ outcome: "undecided", provisional: true });
    expect(
      motionOutcomeForDisplay({
        standard: "preponderance",
        complete: false,
        outcome: "stands",
        thesisStatus: "standing",
        proofConflict: false
      })
    ).toEqual({ outcome: "undecided", provisional: true });
    expect(
      motionOutcomeForDisplay({
        standard: "con",
        complete: false,
        outcome: "undecided",
        thesisStatus: "standing",
        proofConflict: false
      })
    ).toEqual({ outcome: "stands", provisional: true });
  });

  it("follows a defeat, contest, or proof conflict as the trial reaches it", () => {
    expect(
      motionOutcomeForDisplay({
        standard: "pro",
        complete: false,
        outcome: "stands",
        thesisStatus: "defeated",
        proofConflict: false
      })
    ).toEqual({ outcome: "falls", provisional: true });
    expect(
      motionOutcomeForDisplay({
        standard: "pro",
        complete: false,
        outcome: "stands",
        thesisStatus: "contested",
        proofConflict: false
      })
    ).toEqual({ outcome: "undecided", provisional: true });
    expect(
      motionOutcomeForDisplay({
        standard: "pro",
        complete: false,
        outcome: "stands",
        thesisStatus: "standing",
        proofConflict: true
      })
    ).toEqual({ outcome: "undecided", provisional: true });
  });

  it("returns to the opening disposition when a defeat is reversed, and uses the final outcome when complete", () => {
    expect(
      motionOutcomeForDisplay({
        standard: "pro",
        complete: false,
        outcome: "stands",
        thesisStatus: "standing",
        proofConflict: false
      })
    ).toEqual({ outcome: "undecided", provisional: true });
    expect(
      motionOutcomeForDisplay({
        standard: "con",
        complete: false,
        outcome: "falls",
        thesisStatus: "standing",
        proofConflict: false
      })
    ).toEqual({ outcome: "stands", provisional: true });
    expect(
      motionOutcomeForDisplay({
        standard: "pro",
        complete: true,
        outcome: "falls",
        thesisStatus: "defeated",
        proofConflict: false
      })
    ).toEqual({ outcome: "falls", provisional: false });
  });
});
