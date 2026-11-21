import { z } from "zod";
import {
  Debate,
  DebateEdge,
  DebateNode,
  Stance,
  claimFromPrompt,
  cleanTag,
  cleanText,
  cleanTitle,
  message,
  normaliseRelation,
  reconcileDebate,
  slugId,
  topicFromPrompt,
  uid,
  uniqueId
} from "../core/model";
import { debateContext } from "../core/argdown";
import { chatEndpoint, isLocalProvider, providerUrlProblem } from "../shared/provider-url";
import { AUTHORING_RULES as BASE_RULES, CHAMBER_RULES as ASK_RULES } from "../shared/instructions";
import { getSettings, isReady, StoredSettings, ReasoningEffort } from "./settings";
import { providerReasoningEffort, thinkingCapability } from "../shared/thinking";

/**
 * Authoring adapter. The rest of the app only sees Debate objects; whether
 * they came from a model or from the local scaffolder is an implementation
 * detail recorded on the result.
 */

export type AuthorEngine = "llm" | "local";

export interface AuthorResult {
  debate: Debate;
  reply: string;
  engine: AuthorEngine;
  warning?: string;
}

export interface AskResult {
  reply: string;
  engine: "llm" | "local";
  warning?: string;
}

const RawNodeSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["statement", "argument"]).default("argument"),
  title: z.string().min(1).max(160),
  text: z.string().default(""),
  stance: z.enum(["pro", "con", "neutral"]).default("neutral"),
  speaker: z.enum(["advocate", "challenger", "moderator", "you"]).optional(),
  tags: z.array(z.string()).default([]),
  group: z.string().optional(),
  premises: z.array(z.string()).default([]),
  conclusion: z.string().optional()
});

const RawEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.string().default("support")
});

const AuthorOutputSchema = z.object({
  reply: z.string().default(""),
  motion: z.string().optional(),
  thesis: z
    .object({
      title: z.string().min(1),
      text: z.string().optional()
    })
    .optional(),
  nodes: z.array(RawNodeSchema).default([]),
  edges: z.array(RawEdgeSchema).default([])
});

type AuthorOutput = z.infer<typeof AuthorOutputSchema>;

function intakePrompt(input: string): string {
  return `${BASE_RULES}

Return exactly this shape:
{
  "reply": "2-3 sentences telling the user what the map shows and where the sharpest clash is. No praise, no filler.",
  "motion": "Should ...?",
  "thesis": { "title": "at most 12 words", "text": "the full claim in 1-2 sentences" },
  "nodes": [
    {
      "id": "lower_snake_case_unique",
      "kind": "argument",
      "title": "short label",
      "text": "compact explanation, max 60 words",
      "stance": "pro",
      "speaker": "advocate",
      "tags": ["mobility"],
      "group": "For the motion",
      "premises": ["premise one", "premise two"],
      "conclusion": "the conclusion this argument reaches"
    }
  ],
  "edges": [{ "from": "node_id", "to": "thesis", "type": "support" }]
}

Use the id "thesis" for the central claim; do not include the thesis in "nodes". Every edge must use an id from "nodes" or "thesis".
The user's statement follows:
"""
${input.slice(0, 4000)}
"""`;
}

function expansionPrompt(debate: Debate, input: string): string {
  return `${BASE_RULES}

You are extending an existing map. Return a JSON patch only:
{
  "reply": "1-3 sentences describing what you changed and why it matters. No praise.",
  "nodes": [
    {
      "id": "new_unique_snake_case",
      "kind": "argument",
      "title": "short label",
      "text": "compact explanation, max 60 words",
      "stance": "pro",
      "speaker": "advocate",
      "tags": ["..."],
      "group": "For the motion",
      "premises": ["...", "..."],
      "conclusion": "..."
    }
  ],
  "edges": [{ "from": "new_or_existing_id", "to": "existing_or_new_id", "type": "attack" }]
}

Rules for the patch:
- The coverage rules describe a complete map. For this patch, add only the 2–5 new nodes and edges needed for the request; do not rebuild the map.
- Add 2–5 nodes that respond to the request and attach them to existing ids.
- Do not redefine existing nodes. Use new unique ids for new nodes.
- Use an edge type that expresses the actual move: attack, support or undercut.
- If the user asks a question rather than requesting an edit, answer briefly in "reply" and add the most useful argument the map is missing.
- Keep the map honest: do not add a weak counterargument just to appear balanced.
- Do not remove, rename or contradict existing nodes. Cross-links from new nodes are welcome.

THE CURRENT MAP
${debateContext(debate)}

THE USER'S REQUEST
"""
${input.slice(0, 3000)}
"""`;
}

const THINKING_TOKEN_BUDGET: Record<ReasoningEffort, number> = {
  default: 16_384,
  off: 4200,
  low: 8192,
  medium: 12_288,
  high: 16384,
  max: 32768
};

export function supportsDeepSeekThinking(settings: Pick<StoredSettings, "provider" | "model">): boolean {
  return settings.provider === "deepseek" && thinkingCapability(settings.provider, settings.model).supported;
}

/**
 * Local models often expose their chain of thought in reasoning_content.
 * Some of them spend the whole completion budget there before emitting the
 * final answer, especially when asked for a large JSON map. Keep a roomier
 * floor for loopback providers without changing remote-provider costs.
 */
const LOCAL_OUTPUT_TOKEN_FLOOR = 12_000;

export async function callModel(
  settings: StoredSettings,
  messages: { role: "system" | "user"; content: string }[],
  options: { temperature?: number; maxTokens?: number; jsonMode?: boolean } = {}
): Promise<string> {
  const urlProblem = providerUrlProblem(settings.baseUrl, Boolean(settings.apiKey.trim()));
  if (urlProblem) throw new Error(urlProblem);
  if (!isReady(settings)) throw new Error("No model is configured.");
  const capability = thinkingCapability(settings.provider, settings.model);
  const thinkingModel = capability.supported;
  const thinkingEnabled = thinkingModel && settings.reasoningEffort !== "default" && settings.reasoningEffort !== "off";
  const localProvider = isLocalProvider(settings.baseUrl);
  const maxTokens = thinkingEnabled
    ? Math.max(
        options.maxTokens ?? 0,
        THINKING_TOKEN_BUDGET[settings.reasoningEffort],
        localProvider ? LOCAL_OUTPUT_TOKEN_FLOOR : 0
      )
    : localProvider
      ? Math.max(options.maxTokens ?? 0, LOCAL_OUTPUT_TOKEN_FLOOR)
      : options.maxTokens ?? 4200;
  const tokenField = settings.provider === "openai" && thinkingModel ? "max_completion_tokens" : "max_tokens";
  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
    [tokenField]: maxTokens
  };

  if (settings.provider === "deepseek" && thinkingModel && settings.reasoningEffort !== "default") {
    body.thinking = { type: thinkingEnabled ? "enabled" : "disabled" };
    if (thinkingEnabled) body.reasoning_effort = providerReasoningEffort(settings.provider, settings.reasoningEffort);
  } else if (thinkingEnabled) {
    const effort = providerReasoningEffort(settings.provider, settings.reasoningEffort);
    if (effort) body.reasoning_effort = effort;
  }

  const sendTemperature =
    !thinkingModel || (settings.provider === "deepseek" && settings.reasoningEffort === "off");
  if (sendTemperature) {
    body.temperature = options.temperature ?? settings.temperature;
  }

  const send = async (useJsonMode: boolean): Promise<Response> => {
    const controller = new AbortController();
    const timeoutMs = thinkingEnabled ? 240_000 : localProvider ? 300_000 : 150_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(chatEndpoint(settings.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {})
        },
        body: JSON.stringify(useJsonMode ? { ...body, response_format: { type: "json_object" } } : body),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  };

  const useJsonMode = options.jsonMode !== false;
  let response = await send(useJsonMode);
  if (useJsonMode && (response.status === 400 || response.status === 422)) {
    response = await send(false);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`Model request failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  const payload = (await response.json()) as {
    choices?: {
      finish_reason?: string;
      message?: {
        content?: string | { type?: string; text?: string }[];
        reasoning_content?: string;
      };
    }[];
  };
  const choice = payload.choices?.[0];
  const content = choice?.message?.content;
  if (choice?.finish_reason === "length") {
    throw new Error(
      "The model reached its output limit before finishing. Lower the reasoning effort or raise the token budget."
    );
  }
  if (typeof content === "string" && content.trim()) return content;
  if (Array.isArray(content)) {
    const text = content.map((part) => (typeof part === "string" ? part : part?.text ?? "")).join("\n");
    if (text.trim()) return text;
  }
  if (typeof choice?.message?.reasoning_content === "string" && choice.message.reasoning_content.trim()) {
    throw new Error(
      "The model returned only hidden reasoning and no final answer. Turn off reasoning in the local model or choose a model that returns a final response."
    );
  }
  throw new Error("The model returned no text.");
}

export function parseJsonObject(text: string): unknown {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return a JSON object.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Resolve model-authored node IDs and edge references into a unique,
 * Argdown-safe namespace. This is where underscore ids become hyphens and
 * where a title reference is allowed to stand in for an id.
 */
function mergeGraph(
  existing: DebateNode[],
  incoming: z.infer<typeof RawNodeSchema>[],
  edges: z.infer<typeof RawEdgeSchema>[],
  thesisId: string,
  thesisTitle: string
): { nodes: Partial<DebateNode>[]; edges: Partial<DebateEdge>[] } {
  const takenIds = new Set(existing.map((node) => node.id));
  const byRawId = new Map<string, string>();
  const byTitle = new Map<string, string>();
  for (const node of existing) {
    byRawId.set(node.id, node.id);
    byTitle.set(node.title.toLowerCase(), node.id);
  }
  byRawId.set("thesis", thesisId);
  byTitle.set(thesisTitle.toLowerCase(), thesisId);

  const nodes: Partial<DebateNode>[] = [];
  for (const raw of incoming) {
    if (raw.id === "thesis") continue;
    const base = slugId(raw.id || raw.title, "argument");
    const id = uniqueId(base, takenIds);
    byRawId.set(raw.id || base, id);
    byRawId.set(base, id);
    byTitle.set(cleanTitle(raw.title).toLowerCase(), id);
    nodes.push({
      id,
      kind: raw.kind,
      title: raw.title,
      text: raw.text,
      stance: raw.stance,
      speaker: raw.speaker ?? (raw.stance === "pro" ? "advocate" : raw.stance === "con" ? "challenger" : "moderator"),
      tags: raw.tags.map(cleanTag).filter(Boolean),
      group: raw.group,
      premises: raw.premises.map(cleanText).filter(Boolean),
      conclusion: raw.conclusion ? cleanText(raw.conclusion) : undefined
    });
  }

  const resolve = (ref: string): string | undefined => {
    const direct = byRawId.get(ref) ?? byRawId.get(ref.toLowerCase());
    if (direct) return direct;
    const title = byTitle.get(cleanTitle(ref).toLowerCase());
    return title;
  };

  const resolvedEdges: Partial<DebateEdge>[] = [];
  for (const edge of edges) {
    const from = resolve(edge.from);
    const to = resolve(edge.to);
    const type = normaliseRelation(edge.type);
    if (!from || !to || !type || from === to) continue;
    resolvedEdges.push({ from, to, type });
  }

  return { nodes, edges: resolvedEdges };
}

export async function authorDebate(input: string): Promise<AuthorResult> {
  const settings = getSettings();
  if (!isReady(settings)) {
    return localAuthorDebate(input);
  }
  try {
    const content = await callModel(settings, [
      { role: "system", content: BASE_RULES },
      { role: "user", content: intakePrompt(input) }
    ]);
    const parsed = AuthorOutputSchema.parse(parseJsonObject(content));
    const thesisTitle = cleanTitle(parsed.thesis?.title || topicFromPrompt(input));
    const thesisText = cleanText(parsed.thesis?.text || thesisTitle);
    const rawNodes = parsed.nodes.filter((node) => node.id !== "thesis");
    if (!rawNodes.length) {
      throw new Error("The model returned no argument nodes.");
    }
    const merged = mergeGraph([], rawNodes, parsed.edges, "thesis", thesisTitle);
    const warnings = new Set<string>();

    const debate = reconcileDebate({
      id: uid("debate"),
      motion: cleanTitle(parsed.motion || thesisTitle),
      thesisId: "thesis",
      thesisText,
      nodes: [
        {
          id: "thesis",
          kind: "statement",
          title: thesisTitle,
          text: thesisText,
          stance: "neutral",
          speaker: "you",
          tags: ["motion", "user"],
          group: "The motion",
          premises: []
        },
        ...merged.nodes
      ],
      edges: merged.edges,
      origin: "authored",
      position: input,
      authorNote: parsed.reply,
      chat: [message("user", input), message("assistant", parsed.reply, "intake")]
    }, (warning) => warnings.add(warning));

    return {
      debate,
      reply: parsed.reply,
      engine: "llm",
      warning: warnings.size ? [...warnings].join(" ") : undefined
    };
  } catch (error) {
    const fallback = localAuthorDebate(input);
    fallback.warning = `Model unavailable (${error instanceof Error ? error.message : String(error)}). Using the local scaffolder.`;
    return fallback;
  }
}

export async function extendDebate(debate: Debate, input: string): Promise<AuthorResult> {
  const settings = getSettings();
  if (!isReady(settings)) {
    return localExtendDebate(debate, input);
  }
  try {
    const content = await callModel(settings, [
      { role: "system", content: BASE_RULES },
      { role: "user", content: expansionPrompt(debate, input) }
    ]);
    const parsed = AuthorOutputSchema.parse(parseJsonObject(content));
    const merged = mergeGraph(debate.nodes, parsed.nodes, parsed.edges, debate.thesisId, debate.nodes.find((n) => n.id === debate.thesisId)?.title ?? debate.motion);
    if (!merged.nodes.length && !parsed.reply.trim()) {
      throw new Error("The model returned an empty patch.");
    }
    const warnings = new Set<string>();
    const next = reconcileDebate({
      ...debate,
      motion: parsed.motion ? cleanTitle(parsed.motion) : debate.motion,
      nodes: [...debate.nodes, ...merged.nodes],
      edges: [...debate.edges, ...merged.edges],
      authorNote: parsed.reply || debate.authorNote,
      chat: debate.chat,
      updatedAt: Date.now()
    }, (warning) => warnings.add(warning));
    return {
      debate: next,
      reply: parsed.reply || "I extended the map without adding new nodes.",
      engine: "llm",
      warning: warnings.size ? [...warnings].join(" ") : undefined
    };
  } catch (error) {
    const fallback = localExtendDebate(debate, input);
    const reason = `Model unavailable (${error instanceof Error ? error.message : String(error)}). Added a local scaffold instead.`;
    fallback.warning = [fallback.warning, reason].filter(Boolean).join(" ");
    return fallback;
  }
}

function askPrompt(debate: Debate, input: string): string {
  return `THE MAP
${debateContext(debate)}

THE USER'S QUESTION
"""
${input.slice(0, 3000)}
"""`;
}

function cleanAnswer(content: string): string {
  const fenced = content.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const text = (fenced?.[1] ?? content).trim();
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      for (const key of ["answer", "reply", "text", "response"]) {
        if (typeof record[key] === "string" && record[key].trim()) {
          return record[key].trim();
        }
      }
      if ("nodes" in record || "edges" in record) {
        throw new Error("The model returned a map patch instead of an answer.");
      }
    }
  } catch (error) {
    if (error instanceof SyntaxError) return text;
    throw error;
  }
  return text;
}

function localAskDebate(debate: Debate, warning?: string): AskResult {
  const argumentsCount = debate.nodes.filter((node) => node.kind === "argument").length;
  const directPro = debate.edges.filter(
    (edge) => edge.to === debate.thesisId && edge.type === "support"
  ).length;
  const directCon = debate.edges.filter(
    (edge) => edge.to === debate.thesisId && (edge.type === "attack" || edge.type === "undercut")
  ).length;
  const clashes = debate.edges.filter((edge) => edge.type === "attack" || edge.type === "undercut").length;
  const opening = warning
    ? "The connected model could not answer, so I can only describe the map's structure."
    : "No model is connected, so I can only describe the map's structure.";
  const closing = warning
    ? "Check the provider in Settings and try again."
    : "Connect a model in Settings for a substantive answer about the argument itself.";
  return {
    reply: `${opening} It contains ${argumentsCount} arguments: ${directPro} direct pro line${directPro === 1 ? "" : "s"}, ${directCon} direct con line${directCon === 1 ? "" : "s"}, and ${clashes} clash${clashes === 1 ? "" : "es"}. ${closing}`,
    engine: "local",
    warning: warning ?? "No model is connected; this is a structural summary, not an analytical answer."
  };
}

/**
 * Answer a question about the map without changing it. The chamber is
 * deliberately read-only: map edits belong to a separate, previewed flow.
 */
export async function askDebate(debate: Debate, input: string): Promise<AskResult> {
  const settings = getSettings();
  if (!isReady(settings)) return localAskDebate(debate);

  try {
    const content = await callModel(
      settings,
      [
        { role: "system", content: ASK_RULES },
        { role: "user", content: askPrompt(debate, input) }
      ],
      { temperature: 0.2, maxTokens: 900, jsonMode: false }
    );
    const reply = cleanAnswer(content);
    if (!reply) throw new Error("The model returned an empty answer.");
    return { reply, engine: "llm" };
  } catch (error) {
    return localAskDebate(
      debate,
      `Model unavailable (${error instanceof Error ? error.message : String(error)}). This is a structural summary.`
    );
  }
}

/* ------------------------------------------------------------------ */
/* Local scaffolder: honest about its limits, still useful offline.    */
/* ------------------------------------------------------------------ */

function shorten(text: string, max = 64): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function motionForClaim(claim: string): string {
  const text = claim.trim();
  if (!text) return "What is the motion?";
  if (text.endsWith("?")) return text;
  const bare = text.replace(/[.?!]+$/, "");
  const match = bare.match(/^(.+?)\s+(should|ought to|must)\s+(.+)$/i);
  if (match) {
    let measure = match[3]!.replace(/[.?!]+$/, "").trim();
    const subject = match[1]!;
    if (measure.length > 74) measure = measure.split(/[:;]/)[0]!.trim();
    const first = subject.split(/\s+/)[0] ?? "";
    const keepCaps = first === "I" || /[A-Z].*[A-Z]/.test(first) || /^[A-Z]{2,}$/.test(first);
    const spokenSubject = keepCaps ? subject : `${subject.charAt(0).toLowerCase()}${subject.slice(1)}`;
    let question = `Should ${spokenSubject} ${measure}?`;
    if (question.length > 94) {
      const shorter = measure.split(/[:;]/)[0]!.trim();
      question = `Should ${spokenSubject} ${shorter}?`;
    }
    return question;
  }
  const first = bare.split(/\s+/)[0] ?? "";
  const keepCaps = first === "I" || /^[A-Z]{2,}/.test(first) || /[A-Z].*[A-Z]/.test(first);
  return `Is it true that ${keepCaps ? bare : `${bare.charAt(0).toLowerCase()}${bare.slice(1)}`}?`;
}

function localAuthorDebate(input: string): AuthorResult {
  const thesisText = claimFromPrompt(input) || cleanText(input);
  const title = cleanTitle(thesisText || "The motion", "The motion", 140);
  const motion = motionForClaim(thesisText || title);

  const base = (title.replace(/…$/, "").trim() || "this claim").replace(/[.?!]$/, "");
  const nodes: Partial<DebateNode>[] = [
    {
      id: "thesis",
      kind: "statement",
      title,
      text: thesisText || title,
      stance: "neutral",
      speaker: "you",
      tags: ["motion", "user"]
    },
    {
      id: "pro-principle",
      kind: "argument",
      title: "The principle is consistent",
      text: `The claim applies a principle already accepted elsewhere. If comparable cases are treated alike, “${base}” follows without special pleading.`,
      stance: "pro",
      speaker: "advocate",
      tags: ["principle"],
      premises: [
        "Comparable cases should be treated alike unless a relevant difference is shown.",
        `There is no relevant difference between “${base}” and the cases already accepted.`
      ],
      conclusion: "The claim should be accepted on consistency grounds."
    },
    {
      id: "pro-consequences",
      kind: "argument",
      title: "The consequences are better",
      text: "The expected benefits are large and reach the people with the weakest alternatives, while the main costs are transitional and can be managed.",
      stance: "pro",
      speaker: "advocate",
      tags: ["consequences"],
      premises: [
        "The policy produces benefits that are broad and durable.",
        "The costs are concentrated in implementation and can be phased.",
        "The people who benefit most have the fewest substitutes."
      ],
      conclusion: "The expected balance of consequences favours the claim."
    },
    {
      id: "pro-alternative",
      kind: "argument",
      title: "The status quo is worse",
      text: "Doing nothing preserves the problem the claim targets, and the costs of inaction compound quietly instead of appearing in a single budget line.",
      stance: "pro",
      speaker: "advocate",
      tags: ["status-quo"],
      premises: [
        "The status quo already imposes costs that fall unequally.",
        "Those costs persist and compound without a policy change.",
        "A contested reform can be revised; inaction is harder to reverse."
      ],
      conclusion: "The burden of proof should fall on the status quo, not only on the reform."
    },
    {
      id: "con-costs",
      kind: "argument",
      title: "The costs are underestimated",
      text: "The benefits are visible and the costs are diffuse. Fiscal and administrative burdens appear later, land on other budgets and are rarely counted in the case for change.",
      stance: "con",
      speaker: "challenger",
      tags: ["costs"],
      premises: [
        "Implementation costs are systematically understated in policy proposals.",
        "Diffuse costs are easy to ignore in the initial political case.",
        "The people who pay may not be the people who benefit."
      ],
      conclusion: "The proposal is likely to cost more and deliver less than advertised."
    },
    {
      id: "con-principle",
      kind: "argument",
      title: "The principle proves too much",
      text: "The same principle, applied consistently, would license outcomes its own defenders reject. A principle that cannot draw a boundary is not yet a policy.",
      stance: "con",
      speaker: "challenger",
      tags: ["principle"],
      premises: [
        "The proposed principle has no non-arbitrary stopping point.",
        "Consistent application would require accepting cases the proponent rejects.",
        "A principle that cannot distinguish cases cannot settle this one."
      ],
      conclusion: "The principle invoked in support is too broad to justify the claim."
    },
    {
      id: "con-implementation",
      kind: "argument",
      title: "Implementation will distort it",
      text: "Institutions respond to incentives, not intentions. Without a plausible implementation path, the policy will be captured, diluted or delivered to the wrong people.",
      stance: "con",
      speaker: "challenger",
      tags: ["implementation"],
      premises: [
        "Frontline institutions face incentives that differ from the policy's stated aim.",
        "Complex programmes create opportunities for capture and drift.",
        "The proposal lacks a concrete enforcement or delivery mechanism."
      ],
      conclusion: "The gap between the policy on paper and its delivery undermines the case."
    },
    {
      id: "pro-rebut-costs",
      kind: "argument",
      title: "Costs are a design question",
      text: "A cost is not a decisive objection unless it is compared with the cost of the alternative. The relevant question is whether the net burden can be distributed fairly.",
      stance: "pro",
      speaker: "advocate",
      tags: ["costs"],
      premises: [
        "Every policy has costs, including the status quo.",
        "The distribution of costs can be changed through design.",
        "The objection names a burden but does not compare it with the alternative."
      ],
      conclusion: "The cost objection is a reason for careful design, not for rejection."
    },
    {
      id: "con-rebut-principle",
      kind: "argument",
      title: "Consistency is not enough",
      text: "Many consistent principles are bad principles. Consistency tells us how to apply a rule, not whether the rule is worth having.",
      stance: "con",
      speaker: "challenger",
      tags: ["principle"],
      premises: [
        "Consistency is a property of application, not of justification.",
        "A rule can be applied consistently and still be unjust or harmful.",
        "The argument assumes the principle it needs to defend."
      ],
      conclusion: "The consistency argument does not establish the claim."
    }
  ];

  const edges: Partial<DebateEdge>[] = [
    { from: "pro-principle", to: "thesis", type: "support" },
    { from: "pro-consequences", to: "thesis", type: "support" },
    { from: "pro-alternative", to: "thesis", type: "support" },
    { from: "con-costs", to: "thesis", type: "attack" },
    { from: "con-principle", to: "thesis", type: "attack" },
    { from: "con-implementation", to: "thesis", type: "attack" },
    { from: "pro-rebut-costs", to: "con-costs", type: "attack" },
    { from: "con-rebut-principle", to: "pro-principle", type: "undercut" }
  ];

  const debate = reconcileDebate({
    id: uid("debate"),
    motion,
    thesisId: "thesis",
    thesisText,
    nodes,
    edges,
    origin: "authored",
    position: input,
    authorNote:
      "Local scaffold: the standard argument architecture, mapped honestly. Connect a model in Settings for topic-specific evidence, mechanisms and rebuttals.",
    chat: [
      message("user", input),
      message(
        "assistant",
        "I've mapped the standard argument architecture around your claim — consistency, consequences and the status quo against cost, overreach and implementation. This is the local scaffolder, so the nodes are structural rather than topic-specific. Add a model in Settings and ask me to deepen any branch.",
        "intake"
      )
    ]
  });

  return {
    debate,
    reply:
      "I've mapped the standard argument architecture around your claim — consistency, consequences and the status quo against cost, overreach and implementation. This is the local scaffolder, so the nodes are structural rather than topic-specific. Add a model in Settings and ask me to deepen any branch.",
    engine: "local"
  };
}

function localExtendDebate(debate: Debate, input: string): AuthorResult {
  const wantsCon = /counter|against|object|attack|weak|rebut|problem|risk|failure|free speech|enforce/i.test(input);
  const wantsPro = /support|defend|strengthen|evidence for|case for|benefit|works/i.test(input);
  const stance: Stance = wantsCon
    ? "con"
    : wantsPro
      ? "pro"
      : debate.nodes.filter((node) => node.stance === "con").length <= debate.nodes.filter((node) => node.stance === "pro").length
        ? "con"
        : "pro";
  const focus =
    input.match(/\b(?:about|on|regarding|concerning|around)\s+(.{3,90})$/i)?.[1]?.replace(/[.?!]+$/, "").trim() ||
    input.replace(/^(please\s+)?(add|include|give me|make)\s+(the\s+)?(strongest\s+)?/i, "").replace(/[.?!]+$/, "").trim();
  const focusShort = shorten(focus || (stance === "pro" ? "the core mechanism" : "implementation"), 56);
  const baseTitle =
    stance === "pro"
      ? focus
        ? `The case on ${focusShort}`
        : "A further supporting reason"
      : focus
        ? `The ${focusShort} objection`
        : "A serious objection";
  const title = cleanTitle(baseTitle, "Further argument", 96);
  const speaker = stance === "pro" ? "advocate" : "challenger";
  const target =
    debate.nodes.find((node) => node.stance === (stance === "con" ? "pro" : "con") && node.id !== debate.thesisId) ??
    debate.nodes.find((node) => node.id === debate.thesisId) ??
    debate.nodes[0]!;
  const newNodeId = `local-${Date.now().toString(36)}`;
  const warnings = new Set<string>();
  const next = reconcileDebate({
    ...debate,
    nodes: [
      ...debate.nodes,
      {
        id: newNodeId,
        kind: "argument",
        title,
        text:
          stance === "con"
            ? `The objection from ${focusShort} is not a detail. If it holds, the motion asks for a change whose costs arrive before its benefits do.`
            : `The case on ${focusShort} goes to the heart of the motion. It supplies a reason that does not depend on the other side's framing.`,
        stance,
        speaker,
        tags: ["local-scaffold"],
        premises:
          stance === "con"
            ? [
                `${focusShort.charAt(0).toUpperCase()}${focusShort.slice(1)} is a real constraint, not a hypothetical.`,
                "The motion does not yet show how that constraint is met.",
                "Unmet constraints shift costs onto people with less capacity to bear them."
              ]
            : [
                `${focusShort.charAt(0).toUpperCase()}${focusShort.slice(1)} is central to the outcome the motion targets.`,
                "The mechanism is plausible without requiring perfect implementation."
              ],
        conclusion:
          stance === "con"
            ? "The objection survives the strongest reply available on this map."
            : "This is an independent reason to accept the motion."
      }
    ],
    edges: [
      ...debate.edges,
      {
        id: `edge-${newNodeId}`,
        from: newNodeId,
        to: target.id,
        type: target.id === debate.thesisId ? (stance === "pro" ? "support" : "attack") : "attack"
      }
    ],
    updatedAt: Date.now()
  }, (warning) => warnings.add(warning));

  const landed = next.nodes.find((node) => node.id === newNodeId);
  const landedStance = landed?.stance ?? stance;
  const reply = `Added “${title}” as a ${landedStance === "pro" ? "supporting" : "challenging"} move against “${target.id === debate.thesisId ? "the motion" : shorten(target.title, 48)}”. Local mode is a scaffold; connect a model to develop the reasoning.`;
  return { debate: next, reply, engine: "local", warning: warnings.size ? [...warnings].join(" ") : undefined };
}
