import { trimBaseUrl } from "./provider-url";

export type ProviderProtocol = "openai" | "anthropic" | "gemini";

export const ANTHROPIC_API_VERSION = "2026-10-21";

export function providerProtocol(provider: string): ProviderProtocol {
  if (provider === "anthropic" || provider === "claude") return "anthropic";
  if (provider === "google" || provider === "gemini") return "gemini";
  if (provider === "openrouter") return "openai";
  return "openai";
}

/** Native Claude base URL, tolerant of a pasted /v1 endpoint. */
export function anthropicBaseUrl(baseUrl: string): string {
  return trimBaseUrl(baseUrl).replace(/\/v1(?:\/messages)?$/, "");
}

export function anthropicMessagesEndpoint(baseUrl: string): string {
  return `${anthropicBaseUrl(baseUrl)}/v1/messages`;
}

export function anthropicModelsEndpoint(baseUrl: string): string {
  return `${anthropicBaseUrl(baseUrl)}/v1/models`;
}

/** Native Gemini base URL, tolerant of a pasted /v1beta endpoint. */
export function geminiBaseUrl(baseUrl: string): string {
  return trimBaseUrl(baseUrl).replace(/\/(?:v1beta|v1)(?:\/models)?$/, "");
}

export function geminiModelsEndpoint(baseUrl: string): string {
  return `${geminiBaseUrl(baseUrl)}/v1beta/models`;
}

export function geminiGenerateEndpoint(baseUrl: string, model: string): string {
  const id = model.trim().replace(/^models\//, "");
  return `${geminiBaseUrl(baseUrl)}/v1beta/models/${encodeURIComponent(id)}:generateContent`;
}
