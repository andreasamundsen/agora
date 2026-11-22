import { describe, expect, it } from "vitest";
import type { Debate } from "./model";
import { reconcileDebate } from "./model";
import {
  addEdge,
  addResponse,
  changeEdgeType,
  removeEdge,
  removeNode,
  updateMotion,
  updateNode
} from "./edit";

function fixture(): Debate {
  return reconcileDebate({
    id: "edit-fixture",
    motion: "Should the city fund night buses?",
    thesisId: "thesis",
    thesisText: "The city should fund night buses.",
    nodes: [
      {
        id: "thesis",
        kind: "statement",
        title: "Should the city fund night buses?",
        text: "The city should fund night buses.",
        stance: "neutral"
      },
      {
        id: "pro",
        kind: "argument",
        title: "Night workers need a way home",
        text: "Night workers finish after the last regular bus.",
        stance: "pro",
        premises: ["Night shifts end after midnight."],
        conclusion: "There is an unmet transport need."
      },
      {
        id: "con",
        kind: "argument",
        title: "The route would carry too few riders",
        text: "A night route would run mostly empty.",
        stance: "con",
        premises: ["Demand is concentrated in the day."],
        conclusion: "The subsidy would be wasted."
      },
      {
        id: "reply",
        kind: "argument",
        title: "The night economy already pays for it",
        text: "Night workers and venues already generate tax revenue.",
        stance: "pro"
      }
    ],
    edges: [
      { id: "e-pro", from: "pro", to: "thesis", type: "support" },
      { id: "e-con", from: "con", to: "thesis", type: "attack" },
      { id: "e-reply", from: "reply", to: "pro", type: "attack" }
    ]
  });
}

describe("map editing", () => {
  it("updates content fields without changing the graph", () => {
    const before = fixture();
    const next = updateNode(before, "pro", {
      title: "Night workers need a reliable way home",
      text: "The last regular bus leaves before many shifts end.",
      premises: ["Many shifts end after midnight."],
      conclusion: "The city should run a night service.",
      tags: ["equity", "night-work"]
    });

    expect(next).not.toBe(before);
    expect(before.nodes.find((node) => node.id === "pro")?.title).toBe("Night workers need a way home");
    const node = next.nodes.find((candidate) => candidate.id === "pro");
    expect(node?.title).toBe("Night workers need a reliable way home");
    expect(node?.premises).toEqual(["Many shifts end after midnight."]);
    expect(node?.conclusion).toBe("The city should run a night service.");
    expect(next.edges).toEqual(before.edges);
  });

  it("updates the motion and its thesis in one operation", () => {
    const next = updateMotion(fixture(), {
      title: "Should the city run night buses?",
      text: "The city should run a night bus network.",
      premises: ["Night workers need transport."],
      conclusion: "Night buses should be funded."
    });

    expect(next.motion).toBe("Should the city run night buses?");
    expect(next.thesisText).toBe("The city should run a night bus network.");
    const thesis = next.nodes.find((node) => node.id === next.thesisId);
    expect(thesis?.title).toBe("Should the city run night buses?");
    expect(thesis?.text).toBe("The city should run a night bus network.");
    expect(thesis?.kind).toBe("statement");
    expect(thesis?.stance).toBe("neutral");
  });

  it("adds a response and derives its side from the relation", () => {
    const before = fixture();
    const result = addResponse(before, "thesis", "attack", "The cost falls on daytime riders");
    expect(result.debate.nodes).toHaveLength(before.nodes.length + 1);
    expect(result.debate.edges).toHaveLength(before.edges.length + 1);
    const added = result.debate.nodes.find((node) => node.id === result.nodeId);
    expect(added?.kind).toBe("argument");
    expect(added?.stance).toBe("con");
    expect(added?.speaker).toBe("challenger");
    expect(result.debate.edges.find((edge) => edge.id === result.edgeId)).toMatchObject({
      from: result.nodeId,
      to: "thesis",
      type: "attack"
    });
    const roundTripped = reconcileDebate(result.debate);
    expect(roundTripped.nodes.some((node) => node.id === result.nodeId)).toBe(true);
    expect(roundTripped.edges.some((edge) => edge.from === result.nodeId && edge.to === "thesis")).toBe(true);
  });

  it("adds a support from a con argument as a con response", () => {
    const result = addResponse(fixture(), "con", "support", "The cost is a public investment");
    const added = result.debate.nodes.find((node) => node.id === result.nodeId);
    expect(added?.stance).toBe("con");
    expect(added?.speaker).toBe("challenger");
  });

  it("rejects self-links and duplicate relations", () => {
    const debate = fixture();
    expect(addEdge(debate, "pro", "pro", "support").ok).toBe(false);
    expect(addEdge(debate, "pro", "thesis", "support").ok).toBe(false);
    expect(debate.edges).toHaveLength(3);
  });

  it("adds a relation and updates the derived stance", () => {
    const before = fixture();
    const result = addEdge(before, "pro", "con", "attack");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.debate.edges).toHaveLength(before.edges.length + 1);
    expect(result.debate.edges.find((edge) => edge.id === result.edgeId)).toMatchObject({
      from: "pro",
      to: "con",
      type: "attack"
    });
  });

  it("changes a relation type and derives the side again", () => {
    const next = changeEdgeType(fixture(), "e-reply", "support");
    const reply = next.nodes.find((node) => node.id === "reply");
    expect(reply?.stance).toBe("pro");
    expect(next.edges.find((edge) => edge.id === "e-reply")?.type).toBe("support");
  });

  it("refuses to remove a relation that would orphan an argument", () => {
    const result = removeEdge(fixture(), "e-reply");
    expect(result.ok).toBe(false);
    expect(result.debate.edges.some((edge) => edge.id === "e-reply")).toBe(true);
  });

  it("removes a redundant relation without orphaning a node", () => {
    const withBridge = addEdge(fixture(), "reply", "thesis", "support");
    expect(withBridge.ok).toBe(true);
    if (!withBridge.ok) return;
    const result = removeEdge(withBridge.debate, "e-reply");
    expect(result.ok).toBe(true);
    expect(result.debate.edges.some((edge) => edge.id === "e-reply")).toBe(false);
    expect(result.debate.nodes.find((node) => node.id === "reply")).toBeDefined();
  });

  it("refuses to add past the map's node cap", () => {
    const debate = fixture();
    while (debate.nodes.length < 42) {
      const result = addResponse(debate, "thesis", "support", `Extra argument ${debate.nodes.length}`);
      debate.nodes = result.debate.nodes;
      debate.edges = result.debate.edges;
    }
    expect(() => addResponse(debate, "thesis", "support", "One too many")).toThrow(/42-argument limit/);
  });

  it("rejects a relation that would create a loop", () => {
    const before = fixture();
    const result = addEdge(before, "thesis", "pro", "support");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/loop/i);
    expect(result.debate.edges).toHaveLength(before.edges.length);
  });

  it("does not strand a child when its parent is removed", () => {
    const before = fixture();
    const result = removeNode(before, "pro");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/holds up other responses/i);
    expect(result.debate.nodes).toHaveLength(before.nodes.length);
  });

  it("removes a node with all of its incident relations", () => {
    const result = removeNode(fixture(), "reply");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.debate.nodes.some((node) => node.id === "reply")).toBe(false);
    expect(result.debate.edges.some((edge) => edge.from === "reply" || edge.to === "reply")).toBe(false);
  });

  it("never removes the thesis", () => {
    const result = removeNode(fixture(), "thesis");
    expect(result.ok).toBe(false);
    expect(result.debate.nodes.some((node) => node.id === "thesis")).toBe(true);
  });
});
