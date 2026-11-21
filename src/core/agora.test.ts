import { describe, expect, it } from "vitest";
import { claimFromPrompt, slugId } from "./model";
import type { Debate, DebateEdge, DebateNode } from "./model";
import { seedDebates } from "./demo";
import { stageDebate } from "./stage";
import { toArgdown } from "./argdown";

describe("claimFromPrompt", () => {
  it("keeps the position and drops the debate invitation", () => {
    expect(
      claimFromPrompt("I think social media platforms should be regulated like tobacco: warning labels. Debate me.")
    ).toBe("Social media platforms should be regulated like tobacco: warning labels");
  });

  it("handles a bare question", () => {
    expect(claimFromPrompt("Should cities make transit free? Debate me.")).toBe(
      "Should cities make transit free?"
    );
  });
});

describe("slugId", () => {
  it("does not leave a trailing hyphen after truncation", () => {
    const id = slugId("cities should make public transit free at the point of use");
    expect(id.endsWith("-")).toBe(false);
    expect(slugId(id)).toBe(id);
  });
});

describe("staging", () => {
  const debate = seedDebates()[1]!;

  it("is reproducible for a given seed", () => {
    const a = stageDebate(debate, 1234);
    const b = stageDebate(debate, 1234);
    expect(a.order).toEqual(b.order);
    expect(a.turns.map((turn) => turn.id)).toEqual(b.turns.map((turn) => turn.id));
  });

  it("stages every node exactly once", () => {
    const staged = stageDebate(debate, 99);
    expect(staged.stagedNodes).toBe(debate.nodes.length);
    expect(new Set(staged.order).size).toBe(debate.nodes.length);
    expect(staged.turns[0]?.kind).toBe("opening");
    expect(staged.turns.at(-1)?.kind).toBe("closing");
  });

  it("gives turns enough reading time", () => {
    const staged = stageDebate(debate, 7);
    for (const turn of staged.turns) expect(turn.duration).toBeGreaterThanOrEqual(3200);
  });

  it("drains one root's reply branch before starting the next root", () => {
    const node = (id: string, stance: DebateNode["stance"]): DebateNode => ({
      id,
      kind: "argument",
      title: id,
      text: `${id} claim`,
      stance,
      speaker: stance === "con" ? "challenger" : "advocate",
      tags: [],
      group: "",
      premises: [`${id} premise`],
      conclusion: `${id} conclusion`
    });
    const edge = (id: string, from: string, to: string, type: DebateEdge["type"]): DebateEdge => ({
      id,
      from,
      to,
      type
    });
    const branchDebate: Debate = {
      id: "stage-branch-test",
      motion: "A branch test motion",
      thesisId: "thesis",
      thesisText: "A branch test motion",
      nodes: [
        { ...node("thesis", "neutral"), kind: "statement", speaker: "you", title: "The motion" },
        node("root-a", "pro"),
        node("a1", "con"),
        node("a2", "pro"),
        node("root-b", "con"),
        node("b1", "pro")
      ],
      edges: [
        edge("e-root-a", "root-a", "thesis", "support"),
        edge("e-a1", "a1", "root-a", "attack"),
        edge("e-a2", "a2", "a1", "support"),
        edge("e-root-b", "root-b", "thesis", "attack"),
        edge("e-b1", "b1", "root-b", "attack")
      ],
      origin: "seed",
      chat: [],
      createdAt: 0,
      updatedAt: 0
    };

    const staged = stageDebate(branchDebate, 1234);
    const proFirst = ["thesis", "root-a", "a1", "a2", "root-b", "b1"];
    const conFirst = ["thesis", "root-b", "b1", "root-a", "a1", "a2"];
    expect([proFirst, conFirst]).toContainEqual(staged.order);
  });
});

describe("Argdown serialization", () => {
  it("exports every node and relation of the demo map", () => {
    const debate = seedDebates()[1]!;
    const source = toArgdown(debate);
    expect(source).toContain("# The motion");
    expect((source.match(/^ {2}[+_-] </gm) ?? []).length).toBe(debate.edges.length);
    expect(source).toContain("----");
    expect(source).not.toContain("// The reasoning behind this argument:");
  });
});
