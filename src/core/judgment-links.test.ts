import { describe, expect, it } from "vitest";
import { reconcileDebate } from "./model";
import {
  buildJudgmentRun,
  linksAtStep,
  solveJudgment,
  type ClashJudgment,
  type ClusterAssignment,
  type LinkAssessment,
  type SupportAssessment
} from "./judgment";

function debateWith(edges: { from: string; to: string; type: "support" | "attack" | "undercut" }[]) {
  const used = new Set(["thesis", ...edges.flatMap((edge) => [edge.from, edge.to])]);
  const nodes = [
    { id: "thesis", kind: "statement" as const, title: "The test passes", text: "The test passes." },
    { id: "support1", kind: "argument" as const, title: "First reason", text: "First reason.", stance: "pro" as const },
    { id: "support2", kind: "argument" as const, title: "Second reason", text: "Second reason.", stance: "pro" as const },
    { id: "support3", kind: "argument" as const, title: "Third reason", text: "Third reason.", stance: "pro" as const },
    { id: "objection", kind: "argument" as const, title: "An objection", text: "An objection.", stance: "con" as const }
  ];
  return reconcileDebate({
    id: "link-test-debate",
    motion: "Should the test pass?",
    thesisId: "thesis",
    nodes: nodes.filter((node) => used.has(node.id)),
    edges: edges.map((edge) => ({ ...edge, id: `e_${edge.from}_${edge.to}` }))
  });
}

function support(
  edgeId: string,
  from: string,
  quality: SupportAssessment["quality"] = "strong",
  confidence: SupportAssessment["confidence"] = "high"
): SupportAssessment {
  return {
    edgeId,
    from,
    to: "thesis",
    type: "support",
    quality,
    confidence,
    reasoning: "A test support assessment."
  };
}

function conflict(
  edgeId: string,
  from: string,
  verdict: ClashJudgment["verdict"] = "weakens",
  impact: ClashJudgment["impact"] = "material",
  confidence: ClashJudgment["confidence"] = "high"
): ClashJudgment {
  return {
    edgeId,
    from,
    to: "thesis",
    type: "attack",
    verdict,
    impact,
    criterion: "sufficiency",
    confidence,
    targetComponent: "conclusion",
    reasoning: "A test link assessment."
  };
}

function cluster(nodeId: string, value: string): ClusterAssignment {
  return { nodeId, cluster: value };
}

describe("local link judgments", () => {
  it("rates a direct support and its node cluster without a global assessment pass", () => {
    const debate = debateWith([{ from: "support1", to: "thesis", type: "support" }]);
    const snapshot = solveJudgment(
      debate,
      [support("e_support1_thesis", "support1")],
      [cluster("support1", "shared-premise")],
      "pro"
    );

    expect(snapshot.balance.assessed).toBe(true);
    expect(snapshot.balance.pro).toBe(3);
    expect(snapshot.balance.lines[0]).toMatchObject({
      edgeId: "e_support1_thesis",
      cluster: "shared-premise",
      quality: "strong",
      weight: 3
    });
    expect(snapshot.proofs).toEqual(["e_support1_thesis"]);
    expect(snapshot.outcome).toBe("stands");
  });

  it("inherits one node cluster across separate direct lines and applies independence", () => {
    const debate = debateWith([
      { from: "support1", to: "thesis", type: "support" },
      { from: "support2", to: "thesis", type: "support" }
    ]);
    const snapshot = solveJudgment(
      debate,
      [support("e_support1_thesis", "support1"), support("e_support2_thesis", "support2")],
      [cluster("support1", "same-premise"), cluster("support2", "same-premise")],
      "pro"
    );

    expect(snapshot.balance.pro).toBe(4.5);
    expect(snapshot.balance.lines.map((line) => line.independence)).toEqual([1, 0.5]);
  });

  it("caps a cluster of similar lines at one and a half times its strongest line", () => {
    const debate = debateWith([
      { from: "support1", to: "thesis", type: "support" },
      { from: "support2", to: "thesis", type: "support" },
      { from: "support3", to: "thesis", type: "support" }
    ]);
    const snapshot = solveJudgment(
      debate,
      [
        support("e_support1_thesis", "support1"),
        support("e_support2_thesis", "support2"),
        support("e_support3_thesis", "support3")
      ],
      [
        cluster("support1", "same-premise"),
        cluster("support2", "same-premise"),
        cluster("support3", "same-premise")
      ],
      "pro"
    );

    expect(snapshot.balance.pro).toBe(4.5);
    expect(snapshot.balance.lines.map((line) => line.independence)).toEqual([1, 0.5, 0.25]);
  });

  it("uses the source node id when a node has no cluster assignment", () => {
    const debate = debateWith([{ from: "support1", to: "thesis", type: "support" }]);
    const snapshot = solveJudgment(debate, [support("e_support1_thesis", "support1")], [], "pro");
    expect(snapshot.balance.lines[0]?.cluster).toBe("support1");
  });

  it("keeps pro and con clusters in separate namespaces", () => {
    const debate = debateWith([
      { from: "support1", to: "thesis", type: "support" },
      { from: "objection", to: "thesis", type: "attack" }
    ]);
    const snapshot = solveJudgment(
      debate,
      [support("e_support1_thesis", "support1"), conflict("e_objection_thesis", "objection")],
      [cluster("support1", "same-name"), cluster("objection", "same-name")],
      "preponderance"
    );

    expect(snapshot.balance.pro).toBe(3);
    expect(snapshot.balance.con).toBe(2);
    expect(snapshot.balance.lines.map((line) => line.independence)).toEqual([1, 1]);
  });

  it("uses support links from the start and reveals conflict links by playback step", () => {
    const debate = debateWith([
      { from: "support1", to: "thesis", type: "support" },
      { from: "objection", to: "thesis", type: "attack" }
    ]);
    const supportLink = support("e_support1_thesis", "support1");
    const conflictLink = conflict("e_objection_thesis", "objection");
    const run = buildJudgmentRun({
      id: "run-links-at-step",
      debate,
      engine: "llm",
      judge: { provider: "test", model: "test" },
      standard: "pro",
      strictness: "balanced",
      links: [supportLink, conflictLink],
      clusters: [cluster("support1", "test"), cluster("objection", "test")]
    });

    expect(run.verdicts).toHaveLength(1);
    expect(linksAtStep(run, 0)).toEqual([supportLink]);
    expect(linksAtStep(run, 1)).toHaveLength(2);
  });

  it("falls back symmetrically when a direct support has no link assessment", () => {
    const debate = debateWith([
      { from: "support1", to: "thesis", type: "support" },
      { from: "objection", to: "thesis", type: "attack" }
    ]);
    const snapshot = solveJudgment(
      debate,
      [conflict("e_objection_thesis", "objection", "weakens", "material")],
      [cluster("support1", "test")],
      "pro"
    );

    expect(snapshot.balance.assessed).toBe(false);
    expect(snapshot.balance.lines.find((line) => line.side === "pro")).toMatchObject({
      quality: "moderate",
      confidenceLabel: "medium",
      weight: 1.5
    });
    expect(snapshot.proofs).toEqual([]);
  });

  it("keeps all support links and node clusters in the run record", () => {
    const debate = debateWith([
      { from: "support1", to: "thesis", type: "support" },
      { from: "objection", to: "thesis", type: "attack" }
    ]);
    const links: LinkAssessment[] = [
      support("e_support1_thesis", "support1"),
      conflict("e_objection_thesis", "objection")
    ];
    const clusters = [cluster("support1", "shared-premise"), cluster("objection", "cost")];
    const run = buildJudgmentRun({
      id: "run-record",
      debate,
      engine: "llm",
      judge: { provider: "test", model: "test" },
      standard: "preponderance",
      strictness: "balanced",
      links,
      clusters
    });

    expect(run.links).toEqual(links);
    expect(run.clusters).toEqual(clusters);
    expect(run.verdicts).toHaveLength(1);
  });
});
