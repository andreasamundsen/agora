import { describe, expect, it } from "vitest";
import { reconcileDebate } from "./model";
import { buildClashContext, MAX_DIRECT_CONTEXT_RELATIONS } from "./clash-context";

function chainDebate() {
  return reconcileDebate({
    id: "chain-debate",
    motion: "Should the chain hold?",
    thesisId: "thesis",
    nodes: [
      {
        id: "thesis",
        kind: "statement",
        title: "The chain holds",
        text: "The chain holds."
      },
      {
        id: "p1",
        kind: "argument",
        title: "P1 supports the thesis",
        text: "P1 text.",
        stance: "pro",
        premises: ["P1 premise."],
        conclusion: "P1 conclusion."
      },
      {
        id: "c1",
        kind: "argument",
        title: "C1 attacks P1",
        text: "C1 text.",
        stance: "con",
        premises: ["C1 premise."],
        conclusion: "C1 conclusion."
      },
      {
        id: "r1",
        kind: "argument",
        title: "R1 attacks C1",
        text: "R1 text.",
        stance: "pro",
        premises: ["R1 premise."],
        conclusion: "R1 conclusion."
      },
      {
        id: "r2",
        kind: "argument",
        title: "R2 attacks R1",
        text: "R2 text.",
        stance: "pro",
        premises: ["R2 premise."],
        conclusion: "R2 conclusion."
      }
    ],
    edges: [
      { id: "e_p1_thesis", from: "p1", to: "thesis", type: "support" },
      { id: "e_c1_p1", from: "c1", to: "p1", type: "attack" },
      { id: "e_r1_c1", from: "r1", to: "c1", type: "attack" },
      { id: "e_r2_r1", from: "r2", to: "r1", type: "attack" }
    ]
  });
}

function edge(debate: ReturnType<typeof chainDebate>, from: string, to: string) {
  return debate.edges.find((candidate) => candidate.from === from && candidate.to === to)!;
}

describe("clash context", () => {
  it("shows what a target attacks and gives a direct case line its path to the thesis", () => {
    const debate = chainDebate();
    const context = buildClashContext(debate, edge(debate, "c1", "p1"));

    expect(context?.target.id).toBe("p1");
    expect(context?.role).toBe("direct case line");
    expect(context?.directRelations).toHaveLength(1);
    expect(context?.directRelations[0]?.destination.id).toBe("thesis");
    expect(context?.path.map((step) => step.to.id)).toEqual(["thesis"]);
  });

  it("includes the target's immediate destination for a first-level response", () => {
    const debate = chainDebate();
    const context = buildClashContext(debate, edge(debate, "r1", "c1"));

    expect(context?.target.id).toBe("c1");
    expect(context?.role).toBe("first response");
    expect(context?.directRelations.map((relation) => relation.destination.id)).toEqual(["p1"]);
    expect(context?.path.map((step) => step.to.id)).toEqual(["p1", "thesis"]);
  });

  it("walks deeper response chains all the way to the thesis", () => {
    const debate = chainDebate();
    const context = buildClashContext(debate, edge(debate, "r2", "r1"));

    expect(context?.target.id).toBe("r1");
    expect(context?.role).toBe("deeper response");
    expect(context?.directRelations.map((relation) => relation.destination.id)).toEqual(["c1"]);
    expect(context?.path.map((step) => step.to.id)).toEqual(["c1", "p1", "thesis"]);
  });

  it("caps direct relations but always keeps the shortest-path relation", () => {
    const debate = reconcileDebate({
      id: "wide-target",
      motion: "Should the wide target hold?",
      thesisId: "thesis",
      nodes: [
        { id: "thesis", kind: "statement", title: "The thesis", text: "The thesis." },
        { id: "hub", kind: "argument", title: "The hub", text: "The hub.", stance: "pro" },
        { id: "a", kind: "argument", title: "A", text: "A.", stance: "con" },
        { id: "b", kind: "argument", title: "B", text: "B.", stance: "con" },
        { id: "c", kind: "argument", title: "C", text: "C.", stance: "con" },
        { id: "d", kind: "argument", title: "D", text: "D.", stance: "con" },
        { id: "attacker", kind: "argument", title: "Attacker", text: "Attacker.", stance: "con" }
      ],
      edges: [
        { id: "e_hub_a", from: "hub", to: "a", type: "attack" },
        { id: "e_hub_b", from: "hub", to: "b", type: "attack" },
        { id: "e_hub_c", from: "hub", to: "c", type: "attack" },
        { id: "e_hub_d", from: "hub", to: "d", type: "attack" },
        { id: "e_hub_thesis", from: "hub", to: "thesis", type: "support" },
        { id: "e_attacker_hub", from: "attacker", to: "hub", type: "attack" }
      ]
    });

    const context = buildClashContext(debate, edge(debate, "attacker", "hub"));
    expect(context?.role).toBe("direct case line");
    expect(context?.directRelations).toHaveLength(MAX_DIRECT_CONTEXT_RELATIONS);
    expect(context?.omittedDirectRelations).toBe(1);
    expect(context?.directRelations.some((relation) => relation.edge.id === "e_hub_thesis")).toBe(true);
    expect(context?.path.map((step) => step.to.id)).toEqual(["thesis"]);
  });
});
