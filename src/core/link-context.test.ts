import { describe, expect, it } from "vitest";
import { reconcileDebate } from "./model";
import { buildLinkContext } from "./link-context";

function contextDebate() {
  return reconcileDebate({
    id: "link-context",
    motion: "Should the chain hold?",
    thesisId: "thesis",
    nodes: [
      { id: "thesis", kind: "statement", title: "The chain holds", text: "The chain holds." },
      {
        id: "p1",
        kind: "argument",
        title: "P1 supports the thesis",
        text: "P1 text.",
        stance: "pro",
        premises: ["P1 premise."],
        conclusion: "The chain holds."
      },
      {
        id: "c1",
        kind: "argument",
        title: "C1 attacks P1",
        text: "C1 text.",
        stance: "con",
        premises: ["C1 premise."],
        conclusion: "P1 is wrong."
      },
      {
        id: "r1",
        kind: "argument",
        title: "R1 attacks C1",
        text: "R1 text.",
        stance: "pro",
        premises: ["R1 premise."],
        conclusion: "C1 is wrong."
      },
      {
        id: "loose",
        kind: "statement",
        title: "A framing note",
        text: "A framing note."
      },
      {
        id: "loose-argument",
        kind: "argument",
        title: "An unrelated argument",
        text: "An unrelated argument.",
        stance: "neutral",
        premises: ["Unrelated premise."]
      }
    ],
    edges: [
      { id: "e_p1_thesis", from: "p1", to: "thesis", type: "support" },
      { id: "e_c1_p1", from: "c1", to: "p1", type: "attack" },
      { id: "e_r1_c1", from: "r1", to: "c1", type: "attack" },
      { id: "e_unrelated_loose", from: "loose-argument", to: "loose", type: "attack" },
      { id: "e_thesis_loose", from: "thesis", to: "loose", type: "support" }
    ]
  });
}

function edgeFor(debate: ReturnType<typeof contextDebate>, id: string) {
  const edge = debate.edges.find((candidate) => candidate.id === id);
  if (!edge) throw new Error(`Missing edge ${id}`);
  return edge;
}

describe("link context", () => {
  it("marks a target that is the thesis itself and has no path", () => {
    const debate = contextDebate();
    const context = buildLinkContext(debate, edgeFor(debate, "e_p1_thesis"));

    expect(context?.role).toBe("thesis itself");
    expect(context?.path).toEqual([]);
  });

  it("finds the one-step path from a direct case line to the thesis", () => {
    const debate = contextDebate();
    const context = buildLinkContext(debate, edgeFor(debate, "e_c1_p1"));

    expect(context?.role).toBe("direct case line");
    expect(context?.path.map((step) => step.to.id)).toEqual(["thesis"]);
    expect(context?.path[0]?.edge.type).toBe("support");
  });

  it("finds the two-step path from a first response to the thesis", () => {
    const debate = contextDebate();
    const context = buildLinkContext(debate, edgeFor(debate, "e_r1_c1"));

    expect(context?.role).toBe("first response");
    expect(context?.path.map((step) => step.from.id)).toEqual(["c1", "p1"]);
    expect(context?.path.map((step) => step.to.id)).toEqual(["p1", "thesis"]);
    expect(context?.path.map((step) => step.edge.type)).toEqual(["attack", "support"]);
  });

  it("distinguishes a target with no directed path to the thesis", () => {
    const debate = contextDebate();
    const context = buildLinkContext(debate, edgeFor(debate, "e_unrelated_loose"));

    expect(context?.role).toBe("no directed path");
    expect(context?.path).toEqual([]);
  });
});
