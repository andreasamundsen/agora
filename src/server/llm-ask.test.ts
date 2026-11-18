import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { reconcileDebate } from "../core/model";
import { askDebate } from "./llm";

let dir = "";
let originalFetch: typeof globalThis.fetch;

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), "agora-ask-"));
  vi.stubEnv("AGORA_DATA_DIR", dir);
  vi.stubEnv("AGORA_PACKAGED", "0");
  vi.stubEnv("AGORA_LLM_BASE_URL", "https://provider.example/v1");
  vi.stubEnv("AGORA_LLM_MODEL", "test-model");
  vi.stubEnv("AGORA_LLM_API_KEY", "test-key");
  originalFetch = globalThis.fetch;
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
  await fsp.rm(dir, { recursive: true, force: true });
});

function map() {
  return reconcileDebate({
    id: "ask-map",
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
      }
    ],
    edges: [
      { id: "edge-support", from: "support", to: "thesis", type: "support" },
      { id: "edge-attack", from: "attack", to: "thesis", type: "attack" }
    ]
  });
}

describe("chamber questions", () => {
  it("answers from the map without changing the graph", async () => {
    const debate = map();
    const beforeNodes = JSON.stringify(debate.nodes);
    const beforeEdges = JSON.stringify(debate.edges);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content:
                    "The crux is “Night workers need it” against “Demand is too thin”: whether unmet need justifies a network whose cost per rider is high."
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    const result = await askDebate(debate, "What is the real crux here?");

    expect(result.engine).toBe("llm");
    expect(result.reply).toContain("Night workers need it");
    expect(JSON.stringify(debate.nodes)).toBe(beforeNodes);
    expect(JSON.stringify(debate.edges)).toBe(beforeEdges);
  });

  it("extracts a JSON answer wrapper instead of showing raw JSON", async () => {
    const debate = map();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify({
                    answer: "The crux is “Night workers need it” against “Demand is too thin”."
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    const result = await askDebate(debate, "What is the crux here?");

    expect(result.engine).toBe("llm");
    expect(result.reply).toBe("The crux is “Night workers need it” against “Demand is too thin”.");
  });

  it("uses a structural summary when no model is configured, without editing", async () => {
    vi.stubEnv("AGORA_LLM_BASE_URL", "");
    vi.stubEnv("AGORA_LLM_MODEL", "");
    vi.stubEnv("AGORA_LLM_API_KEY", "");
    const debate = map();
    const beforeNodes = JSON.stringify(debate.nodes);

    const result = await askDebate(debate, "Where is the weakest link?");

    expect(result.engine).toBe("local");
    expect(result.warning).toBeTruthy();
    expect(result.reply).toContain("2 arguments");
    expect(JSON.stringify(debate.nodes)).toBe(beforeNodes);
  });
});
