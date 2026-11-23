import { describe, expect, it } from "vitest";
import { seedDebates } from "./demo";
import { debateFingerprint, frozenDebateCopy } from "./judgment";

function baseDebate() {
  return structuredClone(seedDebates()[0]!);
}

describe("saved judgment helpers", () => {
  it("fingerprints the argument graph independently of chat and timestamps", () => {
    const debate = baseDebate();
    const before = debateFingerprint(debate);

    debate.chat.push({ id: "new-message", role: "user", text: "A later question", at: Date.now() });
    debate.updatedAt += 10_000;

    expect(debateFingerprint(debate)).toBe(before);
  });

  it("changes the fingerprint when an argument's text changes", () => {
    const debate = baseDebate();
    const before = debateFingerprint(debate);
    debate.nodes[1]!.text = `${debate.nodes[1]!.text} One more premise.`;

    expect(debateFingerprint(debate)).not.toBe(before);
  });

  it("does not depend on the order of nodes or relations", () => {
    const debate = baseDebate();
    const before = debateFingerprint(debate);
    debate.nodes.reverse();
    debate.edges.reverse();

    expect(debateFingerprint(debate)).toBe(before);
  });

  it("freezes a graph copy without carrying the live chat", () => {
    const debate = baseDebate();
    const frozen = frozenDebateCopy(debate);

    expect(frozen.chat).toEqual([]);
    expect(frozen.motion).toBe(debate.motion);
    expect(frozen.nodes).toEqual(debate.nodes);
    expect(frozen.edges).toEqual(debate.edges);
    expect(frozen).not.toBe(debate);
  });
});
