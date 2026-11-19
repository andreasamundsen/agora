import { describe, expect, it } from "vitest";
import { claimFromPrompt, slugId } from "./model";
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
