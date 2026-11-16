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

  it("grows argument cards to fit a third line of text", () => {
    const debate = makeDebate();
    const node = debate.nodes.find((candidate) => candidate.id === "pro1");
    if (!node) throw new Error("missing pro1");
    const shortHeight = card(computeLayout(debate, "case"), "pro1").height;
    node.text = "A longer argument that needs three lines in the card to stay readable, with enough detail to make the point clearly and give the reader the full sense of the claim.";
    const longHeight = card(computeLayout(debate, "case"), "pro1").height;

    expect(longHeight).toBeGreaterThan(shortHeight);
    expect(longHeight).toBeLessThanOrEqual(150);
  });

  it("sizes the motion card to its own title and text", () => {
    const short = makeDebate();
    const shortHeight = card(computeLayout(short, "case"), "thesis").height;
    const long = makeDebate();
    const thesis = long.nodes.find((candidate) => candidate.id === "thesis");
    if (!thesis) throw new Error("missing thesis");
    thesis.title = "A motion whose title needs several lines to state the question clearly";
    thesis.text = "A longer thesis statement that needs more room in the card so the reader can see the full claim rather than a truncated version of it.";
    const longHeight = card(computeLayout(long, "case"), "thesis").height;

    expect(longHeight).toBeGreaterThan(shortHeight);
    expect(longHeight).toBeLessThanOrEqual(210);
  });

  it("keeps the thread map close to the case map's height", () => {
    const debate = makeDebate();
    const caseHeight = computeLayout(debate, "case").bounds.height;
    const threadHeight = computeLayout(debate, "thread").bounds.height;
    expect(threadHeight).toBeLessThanOrEqual(caseHeight * 1.15);
  });

  it("marks secondary cross-links and keeps thread cards from overlapping", () => {
    const layout = computeLayout(makeDebate(), "thread");
    const cross = layout.edges.find(({ edge }) => edge.id === "e-cross");
    expect(cross?.secondary).toBe(true);
    expect(cross?.cross).toBe(true);

    for (let index = 0; index < layout.cards.length; index += 1) {
      const a = layout.cards[index]!;
      for (let other = index + 1; other < layout.cards.length; other += 1) {
        const b = layout.cards[other]!;
        const overlap =
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y;
        expect(overlap, `${a.node.id} overlaps ${b.node.id}`).toBe(false);
      }
    }
  });

  it("places every node exactly once", () => {
    const debate = makeDebate();
    const layout = computeLayout(debate, "thread");
    const ids = layout.cards.map((candidate) => candidate.node.id);
    expect(ids).toHaveLength(debate.nodes.length);
    expect(new Set(ids).size).toBe(debate.nodes.length);
  });
});
