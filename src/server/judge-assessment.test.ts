import { beforeEach, describe, expect, it, vi } from "vitest";
import { reconcileDebate } from "../core/model";

const { callModelMock } = vi.hoisted(() => ({
  callModelMock: vi.fn()
}));

vi.mock("./llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./llm")>();
  return { ...actual, callModel: callModelMock };
});

import { judgeDebate, JudgeCancelledError } from "./judge";
import type { JudgeProgressEvent } from "../shared/judge-progress";

beforeEach(() => {
  vi.stubEnv("AGORA_PACKAGED", "0");
  vi.stubEnv("AGORA_LLM_BASE_URL", "http://127.0.0.1:1234/v1");
  vi.stubEnv("AGORA_LLM_MODEL", "test-local");
  callModelMock.mockReset();
});

type PromptMessage = { role: string; content: string };

function nightBusDebate(includeReply = false) {
  const replyNodes = includeReply
    ? [
        {
          id: "reply",
          kind: "argument" as const,
          title: "A reply to the attack",
          text: "The cost objection ignores the wider night-time economy.",
          stance: "pro" as const,
          premises: ["Late workers also spend in the city."],
          conclusion: "The route can be justified by wider benefits."
        }
      ]
    : [];
  const replyEdges = includeReply
    ? [{ id: "edge-reply-attack", from: "reply", to: "attack", type: "attack" as const }]
    : [];
  return reconcileDebate({
    id: includeReply ? "assessment-reply" : "assessment-basic",
    motion: "Should cities fund night buses?",
    thesisId: "thesis",
    nodes: [
      { id: "thesis", kind: "statement", title: "Night buses", text: "Cities should fund night buses." },
      {
        id: "support",
        kind: "argument",
        title: "Night workers need it",
        text: "Night workers finish after the last regular bus.",
        stance: "pro",
        premises: ["Those workers finish after midnight."],
        conclusion: "There is an unmet transport need."
      },
      {
        id: "attack",
        kind: "argument",
        title: "Demand is too thin",
        text: "Late routes would carry too few passengers to justify the cost.",
        stance: "con",
        premises: ["The cost of a route is fixed."],
        conclusion: "The network would waste money."
      },
      ...replyNodes
    ],
    edges: [
      { id: "edge-support", from: "support", to: "thesis", type: "support" },
      { id: "edge-attack", from: "attack", to: "thesis", type: "attack" },
      ...replyEdges
    ]
  });
}

function manySupports(count: number) {
  return reconcileDebate({
    id: "many-supports",
    motion: "Should the city fund many small repairs?",
    thesisId: "thesis",
    nodes: [
      { id: "thesis", kind: "statement", title: "Fund repairs", text: "The city should fund small repairs." },
      ...Array.from({ length: count }, (_, index) => ({
        id: `support-${index}`,
        kind: "argument" as const,
        title: `Support ${index + 1}`,
        text: `Reason ${index + 1} supports the motion.`,
        stance: "pro" as const,
        premises: [`Premise ${index + 1}.`],
        conclusion: `Conclusion ${index + 1}.`
      }))
    ],
    edges: Array.from({ length: count }, (_, index) => ({
      id: `edge-support-${index}`,
      from: `support-${index}`,
      to: "thesis",
      type: "support" as const
    }))
  });
}

function successfulModel() {
  return async (_settings: unknown, messages: PromptMessage[]) => {
    const system = messages[0]?.content ?? "";
    const user = messages[1]?.content ?? "";
    if (system.includes("clustering clerk")) {
      const ids = [...user.matchAll(/^ARGUMENT (\S+)$/gm)].map((match) => match[1]);
      return JSON.stringify({
        clusters: ids.map((nodeId) => ({
          nodeId,
          cluster: nodeId === "support" ? "night-workers" : "cost",
          reasoning: "A test cluster."
        }))
      });
    }
    if (user.includes("Relation: SUPPORT")) {
      return JSON.stringify({
        quality: "strong",
        confidence: "high",
        reasoning: "The support establishes an unmet need."
      });
    }
    return JSON.stringify({
      verdict: "weakens",
      criterion: "sufficiency",
      impact: "material",
      confidence: "high",
      target_component: "conclusion",
      reasoning: "The objection has force but does not defeat the thesis."
    });
  };
}

describe("local link assessment orchestration", () => {
  it("judges every edge locally and clusters once before the rulings", async () => {
    callModelMock.mockImplementation(successfulModel());
    const run = await judgeDebate(nightBusDebate(), {
      standard: "preponderance",
      strictness: "balanced"
    });

    expect(run.engine).toBe("llm");
    expect(run.links).toHaveLength(2);
    expect(run.links.map((link) => link.type).sort()).toEqual(["attack", "support"]);
    expect(run.links.find((link) => link.type === "attack")).toMatchObject({
      verdict: "weakens",
      impact: "material"
    });
    expect(run.verdicts).toHaveLength(1);
    expect(run.clusters).toHaveLength(2);
    expect(run.balance.assessed).toBe(true);
    expect(callModelMock).toHaveBeenCalledTimes(3);

    const systems = callModelMock.mock.calls.map((call) => (call[1] as PromptMessage[])[0]?.content ?? "");
    expect(systems[0]).toContain("clustering clerk");
    expect(systems.slice(1).every((system) => system.includes("assess exactly one argument link"))).toBe(true);
  });

  it("assesses reply links too, not just direct case lines", async () => {
    callModelMock.mockImplementation(successfulModel());
    const run = await judgeDebate(nightBusDebate(true), {
      standard: "preponderance",
      strictness: "balanced"
    });

    expect(run.links).toHaveLength(3);
    expect(run.verdicts).toHaveLength(2);
    expect(callModelMock).toHaveBeenCalledTimes(4);
  });

  it("uses unique node clusters and continues when clustering fails", async () => {
    const model = successfulModel();
    callModelMock.mockImplementation(async (settings, messages: PromptMessage[]) => {
      if ((messages[0]?.content ?? "").includes("clustering clerk")) {
        throw new Error("cluster provider unavailable");
      }
      return model(settings, messages);
    });

    const run = await judgeDebate(nightBusDebate(), {
      standard: "preponderance",
      strictness: "balanced"
    });

    expect(run.clusters).toEqual([]);
    expect(run.links).toHaveLength(2);
    expect(run.warnings.join(" ")).toContain("clustering pass could not group");
  });

  it("aborts after one retry when a link cannot be assessed", async () => {
    callModelMock.mockImplementation(async (_settings, messages: PromptMessage[]) => {
      if ((messages[0]?.content ?? "").includes("clustering clerk")) {
        return JSON.stringify({
          clusters: [
            { nodeId: "support", cluster: "night-workers" },
            { nodeId: "attack", cluster: "cost" }
          ]
        });
      }
      throw new Error("link provider unavailable");
    });

    await expect(
      judgeDebate(nightBusDebate(), {
        standard: "preponderance",
        strictness: "balanced"
      })
    ).rejects.toThrow(/could not assess/);
    // One clustering call, then two attempts for each of the two links.
    expect(callModelMock).toHaveBeenCalledTimes(5);
  });

  it("reports phases and real link completions without leaking verdicts", async () => {
    callModelMock.mockImplementation(successfulModel());
    const events: JudgeProgressEvent[] = [];

    await judgeDebate(nightBusDebate(), {
      standard: "preponderance",
      strictness: "balanced",
      onProgress: (event) => events.push(event)
    });

    expect(events[0]).toMatchObject({ type: "phase", phase: "clustering", totalLinks: 2 });
    expect(events[1]).toMatchObject({ type: "phase", phase: "assessing", totalLinks: 2 });
    expect(events.at(-1)).toMatchObject({ type: "phase", phase: "resolving", totalLinks: 2 });

    const starts = events.filter((event) => event.type === "link-start");
    const completed = events.filter((event) => event.type === "link-done");
    expect(starts).toHaveLength(2);
    expect(completed).toHaveLength(2);
    expect(completed.map((event) => event.completed).sort()).toEqual([1, 2]);
    expect(completed.every((event) => event.durationMs >= 0)).toBe(true);
    expect(JSON.stringify(events)).not.toContain("The support establishes an unmet need.");
  });

  it("does not start a cancelled judgment", async () => {
    callModelMock.mockImplementation(successfulModel());
    const controller = new AbortController();
    controller.abort();

    await expect(
      judgeDebate(nightBusDebate(), {
        standard: "preponderance",
        strictness: "balanced",
        signal: controller.signal
      })
    ).rejects.toBeInstanceOf(JudgeCancelledError);
    expect(callModelMock).not.toHaveBeenCalled();
  });

  it("stops scheduling new link work when cancelled mid-run", async () => {
    callModelMock.mockImplementation(successfulModel());
    const controller = new AbortController();
    const events: JudgeProgressEvent[] = [];

    await expect(
      judgeDebate(manySupports(6), {
        standard: "preponderance",
        strictness: "balanced",
        signal: controller.signal,
        onProgress: (event) => {
          events.push(event);
          if (event.type === "link-done" && event.completed === 1) controller.abort();
        }
      })
    ).rejects.toBeInstanceOf(JudgeCancelledError);

    // One cluster call plus the first batch of four links; the fifth and sixth
    // links are never scheduled after the abort.
    expect(callModelMock).toHaveBeenCalledTimes(5);
    expect(events.filter((event) => event.type === "link-start")).toHaveLength(4);
    expect(events.filter((event) => event.type === "link-done")).toHaveLength(1);
  });
});
