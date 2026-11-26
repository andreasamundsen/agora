import { geminiGenerateEndpoint } from "../shared/provider-protocol";
import {
  geminiThinkingLevel,
  geminiThinkingLevels,
  geminiThinkingStyle,
  thinkingTokenBudget,
  type ThinkingLevel
} from "../shared/thinking";
import type { StoredSettings } from "./settings";

type FetchLike = typeof fetch;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface CallOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  signal?: AbortSignal;
}

const GEMINI_DEFAULT_MAX_TOKENS = 4_200;

/**
 * Native Gemini transport. Gemini uses contents/parts rather than chat
 * messages, and its thinking controls are generationConfig.thinkingConfig.
 */
export async function callGemini(
  settings: StoredSettings,
  messages: ChatMessage[],
  options: CallOptions = {},
  fetchImpl: FetchLike = fetch
): Promise<string> {
  const style = geminiThinkingStyle(settings.model);
  const allowedLevels = geminiThinkingLevels(settings.model);
  const requestedLevel: ThinkingLevel = settings.reasoningEffort;
  const level: ThinkingLevel = allowedLevels.includes(requestedLevel) ? requestedLevel : "default";
  const thinkingEnabled = style !== "none" && level !== "default" && level !== "off";
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .filter(Boolean)
    .join("\n\n");
  const contents = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }]
    }));
  if (contents.length === 0) throw new Error("Gemini needs at least one user message.");

  let maxOutputTokens = options.maxTokens ?? GEMINI_DEFAULT_MAX_TOKENS;
  if (style === "budget" && thinkingEnabled) {
    maxOutputTokens = Math.max(maxOutputTokens, thinkingTokenBudget(level) + 8_192);
  }
  if (style === "level" && thinkingEnabled) {
    const floor = level === "max" ? 32_768 : level === "high" ? 16_384 : 8_192;
    maxOutputTokens = Math.max(maxOutputTokens, floor);
  }
  if (style !== "none" && level !== "off") {
    maxOutputTokens = Math.max(maxOutputTokens, 8_192);
  }

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens
  };
  if (style === "none") {
    generationConfig.temperature = options.temperature ?? settings.temperature;
  }
  if (options.jsonMode !== false) generationConfig.responseMimeType = "application/json";

  if (style === "level" && level !== "default" && level !== "off") {
    const thinkingLevel = geminiThinkingLevel(level);
    if (thinkingLevel) generationConfig.thinkingConfig = { thinkingLevel };
  } else if (style === "budget" && level !== "default") {
    generationConfig.thinkingConfig = {
      thinkingBudget: level === "off" ? 0 : thinkingTokenBudget(level)
    };
  }

  const body: Record<string, unknown> = {
    contents,
    generationConfig
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), style !== "none" && level !== "off" ? 240_000 : 150_000);
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  let response: Response;
  try {
    response = await fetchImpl(geminiGenerateEndpoint(settings.baseUrl, settings.model), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(settings.apiKey ? { "x-goog-api-key": settings.apiKey } : {})
      },
      body: JSON.stringify(body),
      signal
    });
  } catch (error) {
    if (options.signal?.aborted) throw new Error("The Gemini request was cancelled.");
    if (controller.signal.aborted) {
      throw new Error("Gemini did not answer before the request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`Gemini request failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  const payload = (await response.json()) as {
    candidates?: {
      finishReason?: string;
      content?: { parts?: { text?: string; thought?: boolean }[] };
    }[];
  };
  const candidate = payload.candidates?.[0];
  if (candidate?.finishReason === "MAX_TOKENS") {
    throw new Error("Gemini reached its output limit before finishing. Lower the thinking effort or raise the token budget.");
  }
  if (candidate?.finishReason === "SAFETY" || candidate?.finishReason === "RECITATION") {
    throw new Error(`Gemini stopped without answering (${candidate.finishReason}).`);
  }
  const parts = candidate?.content?.parts ?? [];
  const text = parts
    .filter((part) => !part.thought)
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
  if (text) return text;
  if (parts.some((part) => part.thought && part.text?.trim())) {
    throw new Error(
      "Gemini returned only internal thinking and no final answer. Lower the thinking effort or choose a different Gemini model."
    );
  }
  throw new Error("Gemini returned no text.");
}
