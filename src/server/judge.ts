import { z } from "zod";
import type { Debate, DebateEdge, DebateNode } from "../core/model";
import { cleanText, uid } from "../core/model";
import {
  buildJudgmentRun,
  solveJudgment,
  type ClashJudgment,
  type ClusterAssignment,
  type JudgeStrictness,
  type LinkAssessment,
  type StandardOfProof,
  type SupportAssessment
} from "../core/judgment";
import { getSettings, isReady, type StoredSettings } from "./settings";
import { callModel, parseJsonObject } from "./llm";
import { CLUSTER_RULES, LINK_RULES } from "../shared/instructions";
import {
  JUDGE_LINK_CONCURRENCY,
  type JudgeLinkProgress,
  type JudgeProgressEvent
} from "../shared/judge-progress";

export const MAX_LINKS = 80;

export interface JudgeOptions {
  model?: string;
  standard: StandardOfProof;
  strictness: JudgeStrictness;
  /** Progress is presentation-only; it never carries a verdict or rating. */
  onProgress?: (event: JudgeProgressEvent) => void;
  signal?: AbortSignal;
}

export class JudgeCancelledError extends Error {
  constructor() {
    super("The judgment was cancelled.");
    this.name = "JudgeCancelledError";
  }
}

function ensureActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new JudgeCancelledError();
}

const SupportLinkSchema = z.object({
  quality: z.enum(["strong", "moderate", "weak"]),
  confidence: z.enum(["high", "medium", "low"]),
  reasoning: z.string().catch("")
});

const ConflictLinkSchema = z.object({
  verdict: z.enum(["defeats", "weakens", "undecided", "irrelevant"]),
  criterion: z.enum(["relevance", "grounds", "sufficiency", "scope", "burden"]).catch("sufficiency"),
  impact: z.enum(["decisive", "material", "marginal"]),
  confidence: z.enum(["high", "medium", "low"]),
  target_component: z
    .enum(["conclusion", "inference", "premise", "scope", "unknown"])
    .catch("conclusion"),
  reasoning: z.string().catch("")
});

const ClusterSchema = z.object({
  clusters: z.array(
    z.object({
      nodeId: z.string(),
      cluster: z.string().catch(""),
      reasoning: z.string().catch("")
    })
  )
});

function normalizeCluster(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || fallback;
}

function normalizeLinkRaw(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const copy = { ...(value as Record<string, unknown>) };
  for (const key of [
    "quality",
    "verdict",
    "criterion",
    "impact",
    "confidence",
    "target_component"
  ] as const) {
    const field = copy[key];
    if (typeof field === "string") copy[key] = field.trim().toLowerCase();
  }
  return copy;
}

function normalizeClusterRaw(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.clusters)) return value;
  return {
    ...record,
    clusters: record.clusters.map((cluster) => {
      if (!cluster || typeof cluster !== "object") return cluster;
      const copy = { ...(cluster as Record<string, unknown>) };
      for (const key of ["nodeId", "cluster"] as const) {
        const field = copy[key];
        if (typeof field === "string") copy[key] = field.trim();
      }
      return copy;
    })
  };
}

function nodeBlock(node: DebateNode, role: string): string {
  const premises = node.premises.length
    ? node.premises.map((premise, index) => `  ${index + 1}. ${premise}`).join("\n")
    : "  (no explicit premises)";
  return `${role}
Title: ${node.title}
Text: ${cleanText(node.text) || node.title}
Premises:
${premises}
Conclusion: ${node.conclusion ? cleanText(node.conclusion) : "(not stated separately)"}`;
}

/** A local link prompt sees only the source, the target, and the relation type. */
export function linkPrompt(debate: Debate, edge: DebateEdge): string {
  const source = debate.nodes.find((node) => node.id === edge.from);
  const target = debate.nodes.find((node) => node.id === edge.to);
  if (!source || !target) throw new Error("The link points at a missing argument.");
  return `THE LINK
Relation: ${edge.type.toUpperCase()}

--- BEGIN UNTRUSTED ARGUMENT DATA ---

${nodeBlock(source, "SOURCE")}

${nodeBlock(target, "TARGET")}

--- END UNTRUSTED ARGUMENT DATA ---

Assess only this link. The rest of the map is not in evidence.`;
}

/** The clustering prompt sees every argument text, but no edges, rulings, or ratings. */
export function clusterPrompt(debate: Debate): string | null {
  const argumentsOnMap = debate.nodes.filter(
    (node) => node.kind === "argument" && node.id !== debate.thesisId
  );
  if (!argumentsOnMap.length) return null;
  const blocks = argumentsOnMap.map((node) => nodeBlock(node, `ARGUMENT ${node.id}`)).join("\n\n");
  return `--- BEGIN UNTRUSTED DEBATE DATA ---

THE MOTION
${debate.motion}

THE THESIS
${cleanText(debate.thesisText) || debate.motion}

${blocks}

--- END UNTRUSTED DEBATE DATA ---

Group only the arguments above by shared premise or mechanism. Return one record for every argument id. Do not assess strength, rule on a link, or decide the motion.`;
}

function cleanReasoning(value: unknown): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text.length > 1200 ? `${text.slice(0, 1199).trimEnd()}…` : text;
}

function localSupport(edge: DebateEdge): SupportAssessment {
  return {
    edgeId: edge.id,
    from: edge.from,
    to: edge.to,
    type: "support",
    quality: "moderate",
    confidence: "medium",
    reasoning:
      "Local structural review: no judge model is connected, so this support is assigned a neutral structural rating for procedure only."
  };
}

function localRuling(edge: DebateEdge): ClashJudgment {
  return {
    edgeId: edge.id,
    from: edge.from,
    to: edge.to,
    type: edge.type as "attack" | "undercut",
    verdict: "defeats",
    impact: "material",
    criterion: "sufficiency",
    confidence: "low",
    targetComponent: edge.type === "undercut" ? "inference" : "conclusion",
    reasoning:
      "Local structural review: no judge model is connected, so this link is treated as decisive only to demonstrate the procedure. Connect a judge model for a substantive ruling on the argument's content."
  };
}

function enforceStrictness(judgment: ClashJudgment, strictness: JudgeStrictness): ClashJudgment {
  if (judgment.verdict !== "defeats" || strictness === "generous") return judgment;
  const tooUnsure = judgment.confidence === "low" || (strictness === "strict" && judgment.confidence === "medium");
  if (!tooUnsure) return judgment;
  const fallback: ClashJudgment["verdict"] = strictness === "strict" ? "weakens" : "undecided";
  return {
    ...judgment,
    verdict: fallback,
    reasoning: `${judgment.reasoning} Under the ${strictness} standard, a ${judgment.confidence}-confidence strike is recorded as ${fallback} rather than a defeat.`.trim()
  };
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
  shouldStop?: () => boolean
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!shouldStop?.()) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await run(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

function providerError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Unknown provider error";
  return raw.replace(/\s+/g, " ").slice(0, 240);
}

async function assessLink(
  debate: Debate,
  edge: DebateEdge,
  settings: StoredSettings,
  strictness: JudgeStrictness
): Promise<LinkAssessment> {
  const prompt = linkPrompt(debate, edge);
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const content = await callModel(
        settings,
        [
          { role: "system", content: LINK_RULES },
          { role: "user", content: prompt }
        ],
        { temperature: 0, maxTokens: 900 }
      );
      const raw = normalizeLinkRaw(parseJsonObject(content));
      if (edge.type === "support") {
        const parsed = SupportLinkSchema.safeParse(raw);
        if (!parsed.success) throw new Error("The link assessor returned an invalid support shape.");
        return {
          edgeId: edge.id,
          from: edge.from,
          to: edge.to,
          type: "support",
          quality: parsed.data.quality,
          confidence: parsed.data.confidence,
          reasoning: cleanReasoning(parsed.data.reasoning)
        };
      }
      const parsed = ConflictLinkSchema.safeParse(raw);
      if (!parsed.success) throw new Error("The link assessor returned an invalid conflict shape.");
      return enforceStrictness(
        {
          edgeId: edge.id,
          from: edge.from,
          to: edge.to,
          type: edge.type,
          verdict: parsed.data.verdict,
          impact: parsed.data.impact,
          criterion: parsed.data.criterion,
          confidence: parsed.data.confidence,
          targetComponent: parsed.data.target_component,
          reasoning:
            cleanReasoning(parsed.data.reasoning) ||
            "The judge did not provide a reason. The link is left as assessed, but the reasoning is missing."
        },
        strictness
      );
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `The judge could not assess the ${edge.type} link “${edge.id}”: ${providerError(lastError)}`
  );
}

async function assessAllLinks(
  debate: Debate,
  settings: StoredSettings,
  strictness: JudgeStrictness,
  options: Pick<JudgeOptions, "onProgress" | "signal"> = {}
): Promise<LinkAssessment[]> {
  const total = debate.edges.length;
  let completed = 0;
  return mapLimit(
    debate.edges,
    JUDGE_LINK_CONCURRENCY,
    async (edge, index) => {
      ensureActive(options.signal);
      const link: JudgeLinkProgress = {
        edgeId: edge.id,
        index,
        total,
        type: edge.type
      };
      const startedAt = Date.now();
      options.onProgress?.({ type: "link-start", link, startedAt });
      try {
        const assessment = await assessLink(debate, edge, settings, strictness);
        ensureActive(options.signal);
        completed += 1;
        const completedAt = Date.now();
        options.onProgress?.({
          type: "link-done",
          link,
          completed,
          durationMs: completedAt - startedAt,
          completedAt
        });
        return assessment;
      } catch (error) {
        if (options.signal?.aborted) throw new JudgeCancelledError();
        throw error;
      }
    },
    () => Boolean(options.signal?.aborted)
  );
}

export async function clusterArguments(
  debate: Debate,
  settings: StoredSettings,
  warnings: string[]
): Promise<ClusterAssignment[]> {
  const prompt = clusterPrompt(debate);
  if (!prompt) return [];
  const argumentNodes = debate.nodes.filter(
    (node) => node.kind === "argument" && node.id !== debate.thesisId
  );

  try {
    const content = await callModel(
      settings,
      [
        { role: "system", content: CLUSTER_RULES },
        { role: "user", content: prompt }
      ],
      { temperature: 0, maxTokens: 1600 }
    );
    const parsed = ClusterSchema.safeParse(normalizeClusterRaw(parseJsonObject(content)));
    if (!parsed.success) throw new Error("The clustering pass returned an invalid shape.");
    const byNode = new Map<string, { cluster: string; reasoning?: string }>();
    const known = new Set(argumentNodes.map((node) => node.id));
    for (const record of parsed.data.clusters) {
      if (!known.has(record.nodeId)) continue;
      byNode.set(record.nodeId, {
        cluster: normalizeCluster(record.cluster, record.nodeId),
        reasoning: cleanReasoning(record.reasoning) || undefined
      });
    }
    if (!byNode.size) throw new Error("The clustering pass did not group any argument.");
    if (byNode.size < argumentNodes.length) {
      warnings.push(
        `The clustering pass grouped ${byNode.size} of ${argumentNodes.length} arguments. Missing arguments use their own node id.`
      );
    }
    return argumentNodes.map((node) => ({
      nodeId: node.id,
      cluster: byNode.get(node.id)?.cluster ?? node.id,
      reasoning: byNode.get(node.id)?.reasoning
    }));
  } catch (error) {
    warnings.push(
      `The clustering pass could not group the arguments: ${providerError(error)}. Unique node ids were used.`
    );
    return [];
  }
}

export async function judgeDebate(debate: Debate, options: JudgeOptions): Promise<ReturnType<typeof buildJudgmentRun>> {
  ensureActive(options.signal);
  const settings = getSettings();
  const model = options.model?.trim() || settings.model;
  const judgeSettings: StoredSettings = { ...settings, model };
  const engine: "llm" | "local" = isReady(judgeSettings) ? "llm" : "local";
  if (debate.edges.length > MAX_LINKS) {
    throw new Error(
      `This map has ${debate.edges.length} argument links. The bench can hear at most ${MAX_LINKS} in one sitting.`
    );
  }

  const warnings: string[] = [];
  if (engine === "local") {
    warnings.push(
      "Local structural review: no judge model is connected. The link assessments are neutral placeholders that demonstrate the procedure, not substantive judgments."
    );
  }

  let links: LinkAssessment[];
  let clusters: ClusterAssignment[] = [];

  if (engine === "llm") {
    // Clustering is independent: it runs before any link ruling and sees only
    // argument text, never verdicts, strengths, or edge data.
    options.onProgress?.({ type: "phase", phase: "clustering", totalLinks: debate.edges.length });
    clusters = await clusterArguments(debate, judgeSettings, warnings);
    ensureActive(options.signal);
    options.onProgress?.({ type: "phase", phase: "assessing", totalLinks: debate.edges.length });
    links = await assessAllLinks(debate, judgeSettings, options.strictness, {
      onProgress: options.onProgress,
      signal: options.signal
    });
    ensureActive(options.signal);
    options.onProgress?.({ type: "phase", phase: "resolving", totalLinks: debate.edges.length });
  } else {
    options.onProgress?.({ type: "phase", phase: "local", totalLinks: debate.edges.length });
    links = debate.edges.map((edge) => (edge.type === "support" ? localSupport(edge) : localRuling(edge)));
  }

  if (!debate.edges.length) {
    warnings.push("There are no argument links on this map, so there is nothing for the bench to assess.");
  }

  ensureActive(options.signal);
  const corroborated = solveJudgment(
    debate,
    links,
    clusters,
    options.standard,
    options.strictness,
    engine === "llm"
  );
  if (corroborated.withheldHardDefeats.length) {
    warnings.push(
      "A hard fall was withheld: the direct defeat of the thesis was not corroborated by a decisive link assessment at the selected evidence bar, or its attacker was under pressure. The weighted balance decided the motion."
    );
  }

  return buildJudgmentRun({
    id: uid("judgment"),
    debate,
    engine,
    judge:
      engine === "llm"
        ? { provider: settings.provider, model }
        : { provider: "local", model: "local structural review" },
    standard: options.standard,
    strictness: options.strictness,
    links,
    clusters,
    warnings: [...new Set(warnings)].slice(0, 8)
  });
}
