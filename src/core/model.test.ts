import { describe, expect, it } from "vitest";
import { message, reconcileDebate, type DebateEdge, type DebateNode } from "./model";

function base(overrides: {
  nodes?: Partial<DebateNode>[];
  edges?: Partial<DebateEdge>[];
  thesisText?: string;
  chat?: ReturnType<typeof message>[];
} = {}) {
  return {
    thesisId: "thesis",
    motion: "The motion",
    thesisText: overrides.thesisText ?? "The motion",
    nodes: overrides.nodes ?? [
      { id: "thesis", kind: "statement", title: "The motion", text: "The motion", stance: "neutral" }
    ],
    edges: overrides.edges ?? [],
    chat: overrides.chat
  };
}

describe("reconcile warnings", () => {
  it("warns when the node cap drops arguments", () => {
    const warnings: string[] = [];
    const nodes: Partial<DebateNode>[] = [
      { id: "thesis", kind: "statement", title: "The motion", text: "The motion", stance: "neutral" },
      ...Array.from({ length: 42 }, (_, index) => ({
        id: `arg-${index}`,
        kind: "argument" as const,
        title: `Argument ${index}`,
        text: "A distinct argument.",
        stance: "pro" as const
      }))
    ];
    const debate = reconcileDebate(base({ nodes }), (warning) => warnings.push(warning));
    expect(debate.nodes).toHaveLength(42);
    expect(warnings[0]).toContain("capped at 42 nodes");
  });

  it("warns when argument text is capped", () => {
    const warnings: string[] = [];
    const nodes: Partial<DebateNode>[] = [
      { id: "thesis", kind: "statement", title: "The motion", text: "The motion", stance: "neutral" },
      { id: "long", kind: "argument", title: "Long argument", text: "x".repeat(521), stance: "pro" }
    ];
    const debate = reconcileDebate(base({ nodes }), (warning) => warnings.push(warning));
    expect(debate.nodes.find((node) => node.id === "long")?.text.length).toBe(520);
    expect(warnings.join(" ")).toContain("capped at 520 characters");
  });

  it("warns when chat history is capped", () => {
    const warnings: string[] = [];
    const chat = Array.from({ length: 81 }, (_, index) => message("user", `message ${index}`));
    const debate = reconcileDebate(base({ chat }), (warning) => warnings.push(warning));
    expect(debate.chat).toHaveLength(80);
    expect(warnings.join(" ")).toContain("capped at 80 messages");
  });

  it("does not warn for an ordinary map", () => {
    const warnings: string[] = [];
    reconcileDebate(base(), (warning) => warnings.push(warning));
    expect(warnings).toEqual([]);
  });
});
