import { describe, expect, it } from "vitest";
import { reconcileDebate } from "../core/model";
import { clusterPrompt, linkPrompt } from "./judge";

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
        id: "unrelated",
        kind: "argument",
        title: "An unrelated argument",
        text: "UNRELATED CONTEXT.",
        stance: "pro",
        premises: ["Unrelated premise."]
      },
      {
        id: "framing",
        kind: "statement",
        title: "A framing note",
        text: "FRAMING NOTE, NOT AN ARGUMENT."
      }
    ],
    edges: [
      { id: "e_p1_thesis", from: "p1", to: "thesis", type: "support", note: "RELATION NOTE THAT MUST NOT LEAK." },
      { id: "e_c1_p1", from: "c1", to: "p1", type: "attack" },
      { id: "e_r1_c1", from: "r1", to: "c1", type: "attack" },
      { id: "e_unrelated_thesis", from: "unrelated", to: "thesis", type: "support" }
    ]
  });
}

describe("link prompt", () => {
  it("places the target with debate context while keeping other arguments out", () => {
    const debate = promptDebate();
    const edge = debate.edges.find((candidate) => candidate.id === "e_p1_thesis")!;
    const prompt = linkPrompt(debate, edge);

    expect(prompt).toContain("THE DEBATE");
    expect(prompt).toContain("Motion: Should the chain hold?");
    expect(prompt).toContain("Thesis: The chain holds.");
    expect(prompt).toContain("TARGET'S PLACE IN THE MAP");
    expect(prompt).toContain("Role: the thesis itself");
    expect(prompt).toContain("Path to the thesis: the target is the thesis");
    expect(prompt).toContain("Relation: SUPPORT");
    expect(prompt).toContain("SOURCE");
    expect(prompt).toContain("TARGET");
    expect(prompt).toContain("P1 text.");
    expect(prompt).toContain("The chain holds.");
    expect(prompt).not.toContain("C1 text.");
    expect(prompt).not.toContain("R1 text.");
    expect(prompt).not.toContain("UNRELATED CONTEXT.");
    expect(prompt).not.toContain("FRAMING NOTE, NOT AN ARGUMENT.");
    expect(prompt).not.toContain("OTHER RELATIONS AROUND THIS PAIR");
    expect(prompt).not.toContain("RELATION NOTE THAT MUST NOT LEAK.");
    expect(prompt).not.toContain("STANDARD OF PROOF");
  });

  it("gives a direct case line its short path to the thesis", () => {
    const debate = promptDebate();
    const edge = debate.edges.find((candidate) => candidate.id === "e_c1_p1")!;
    const prompt = linkPrompt(debate, edge);

    expect(prompt).toContain("Relation: ATTACK");
    expect(prompt).toContain("Role: direct case line (1 step from the thesis)");
    expect(prompt).toContain("“P1 supports the thesis” —SUPPORT→ “The chain holds”");
    expect(prompt).toContain("C1 text.");
    expect(prompt).toContain("P1 text.");
    expect(prompt).not.toContain("R1 text.");
    expect(prompt).not.toContain("UNRELATED CONTEXT.");
  });

  it("gives a deeper response a compact path through the branch", () => {
    const debate = promptDebate();
    const edge = debate.edges.find((candidate) => candidate.id === "e_r1_c1")!;
    const prompt = linkPrompt(debate, edge);

    expect(prompt).toContain("Relation: ATTACK");
    expect(prompt).toContain("Role: first response (2 steps from the thesis)");
    expect(prompt).toContain(
      "“C1 attacks P1” —ATTACK→ “P1 supports the thesis” —SUPPORT→ “The chain holds”"
    );
    expect(prompt).toContain("R1 text.");
    expect(prompt).not.toContain("P1 premise.");
    expect(prompt).not.toContain("P1 conclusion.");
    expect(prompt).not.toContain("UNRELATED CONTEXT.");
  });
});

describe("clustering prompt", () => {
  it("contains every argument text but no edges, rulings, or ratings", () => {
    const debate = promptDebate();
    const prompt = clusterPrompt(debate)!;

    expect(prompt).toContain("P1 text.");
    expect(prompt).toContain("C1 text.");
    expect(prompt).toContain("R1 text.");
    expect(prompt).toContain("UNRELATED CONTEXT.");
    expect(prompt).not.toContain("FRAMING NOTE, NOT AN ARGUMENT.");
    expect(prompt).not.toContain("e_p1_thesis");
    expect(prompt).not.toContain("Relation:");
    expect(prompt).not.toContain("defeats");
    expect(prompt).not.toContain("strong");
    expect(prompt).not.toContain("SOURCE");
    expect(prompt).not.toContain("TARGET");
  });

  it("returns null when there are no arguments to cluster", () => {
    const debate = reconcileDebate({
      id: "solo-thesis",
      motion: "A solo thesis",
      thesisId: "thesis",
      nodes: [{ id: "thesis", kind: "statement", title: "The thesis", text: "The thesis." }],
      edges: []
    });
    expect(clusterPrompt(debate)).toBeNull();
  });
});
