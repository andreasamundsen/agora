import { describe, expect, it } from "vitest";
import type { Debate, DebateEdge, DebateNode } from "./model";
import { computeLayout } from "./layout";

function makeNode(id: string, stance: DebateNode["stance"], title = id): DebateNode {
  return {
    id,
    kind: "argument",
    title,
    text: `${title} body`,
    stance,
    speaker: stance === "pro" ? "advocate" : stance === "con" ? "challenger" : "moderator",
    tags: [],
    group: "",
    premises: [],
    conclusion: `${title} conclusion`
  };
}

function makeEdge(id: string, from: string, to: string, type: DebateEdge["type"] = "attack"): DebateEdge {
  return { id, from, to, type };
}

function makeDebate(): Debate {
  const thesis = makeNode("thesis", "neutral", "The motion");
  thesis.kind = "statement";
  const pro1 = makeNode("pro1", "pro", "Pro one");
  const pro1b = makeNode("pro1b", "pro", "Pro two");
  const proReply = makeNode("pro-reply", "con", "Reply to pro one");
  const proReplyTwo = makeNode("pro-reply-two", "pro", "Reply to the reply");
  const con1 = makeNode("con1", "con", "Con one");
  const conReply = makeNode("con-reply", "pro", "Reply to con one");
  return {
    id: "layout-test",
    motion: "Should this map be threaded?",
    thesisId: "thesis",
    thesisText: "The motion",
    nodes: [thesis, pro1, pro1b, con1, proReply, proReplyTwo, conReply],
    edges: [
      makeEdge("e-pro1", "pro1", "thesis", "support"),
      makeEdge("e-pro1b", "pro1b", "thesis", "support"),
      makeEdge("e-pro-reply", "pro-reply", "pro1", "attack"),
      makeEdge("e-pro-reply-two", "pro-reply-two", "pro-reply", "attack"),
      makeEdge("e-con1", "con1", "thesis", "attack"),
      makeEdge("e-con-reply", "con-reply", "con1", "attack"),
      makeEdge("e-cross", "pro1", "con1", "attack")
    ],
    origin: "seed",
    chat: [],
    createdAt: 0,
    updatedAt: 0
  };
}

function card(layout: ReturnType<typeof computeLayout>, id: string) {
  const found = layout.cards.find((candidate) => candidate.node.id === id);
  if (!found) throw new Error(`missing card ${id}`);
  return found;
}

describe("computeLayout", () => {
  it("keeps the original case layout as the default", () => {
    const layout = computeLayout(makeDebate());
    expect(layout.mode).toBe("case");
    expect(layout.rails).toBeUndefined();
    expect(card(layout, "pro1").x).toBeLessThan(card(layout, "thesis").x);
    expect(card(layout, "con1").x).toBeGreaterThan(card(layout, "thesis").x);
  });

  it("attaches replies to the target's branch and extends them outward", () => {
    const layout = computeLayout(makeDebate(), "thread");
    expect(layout.mode).toBe("thread");

    const thesis = card(layout, "thesis");
    const pro1 = card(layout, "pro1");
    const con1 = card(layout, "con1");
    const proReply = card(layout, "pro-reply");
    const proReplyTwo = card(layout, "pro-reply-two");
    const conReply = card(layout, "con-reply");

    expect(pro1.x).toBeLessThan(thesis.x);
    expect(con1.x).toBeGreaterThan(thesis.x);
    expect(proReply.x).toBeLessThan(pro1.x);
    expect(proReplyTwo.x).toBeLessThan(proReply.x);
    expect(conReply.x).toBeGreaterThan(con1.x);

    expect(proReply.branch).toBe("pro");
    expect(proReplyTwo.branch).toBe("pro");
    expect(conReply.branch).toBe("con");
    expect(proReply.node.stance).toBe("con");
    expect(conReply.node.stance).toBe("pro");
    expect(proReply.parentId).toBe("pro1");
    expect(proReplyTwo.parentId).toBe("pro-reply");
  });

  it("stacks sibling replies around their parent without overlapping", () => {
    const debate = makeDebate();
    debate.nodes.push(makeNode("pro-reply-b", "con", "Another reply to pro one"));
    debate.edges.push(makeEdge("e-pro-reply-b", "pro-reply-b", "pro1", "attack"));
    const layout = computeLayout(debate, "thread");
    const first = card(layout, "pro-reply");
    const second = card(layout, "pro-reply-b");

    expect(first.x).toBe(second.x);
    expect(first.y).not.toBe(second.y);
    const upper = first.y < second.y ? first : second;
    const lower = first.y < second.y ? second : first;
    expect(upper.y + upper.height).toBeLessThanOrEqual(lower.y);
  });

  it("emits quiet rails and marks secondary cross-links", () => {
    const layout = computeLayout(makeDebate(), "thread");
    expect(layout.rails?.map((rail) => rail.label)).toEqual(["Pro case", "Con case"]);
    const cross = layout.edges.find(({ edge }) => edge.id === "e-cross");
    expect(cross?.secondary).toBe(true);
    expect(cross?.cross).toBe(true);
  });

  it("places every node exactly once", () => {
    const debate = makeDebate();
    const layout = computeLayout(debate, "thread");
    const ids = layout.cards.map((candidate) => candidate.node.id);
    expect(ids).toHaveLength(debate.nodes.length);
    expect(new Set(ids).size).toBe(debate.nodes.length);
  });
});
