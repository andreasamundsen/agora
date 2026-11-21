import { chatEndpoint, modelsEndpoint, providerUrlProblem } from "../shared/provider-url";
import {
  ANTHROPIC_API_VERSION,
  anthropicMessagesEndpoint,
  anthropicModelsEndpoint,
  geminiGenerateEndpoint,
  geminiModelsEndpoint,
  providerProtocol
} from "../shared/provider-protocol";
import type { StoredSettings } from "./settings";

export const SETTINGS_TEST_TIMEOUT_MS = 15_000;

export interface ProviderTestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

type FetchLike = typeof fetch;

/**
 * Test the configured provider without letting a hung socket keep the
 * Settings modal busy for minutes. The same signal covers both requests.
 */
export async function testProviderConnection(
  settings: StoredSettings,
  fetchImpl: FetchLike = fetch,
  timeoutMs = SETTINGS_TEST_TIMEOUT_MS
): Promise<ProviderTestResult> {
  const problem = providerUrlProblem(settings.baseUrl, Boolean(settings.apiKey.trim()));
  if (problem) return { ok: false, message: problem };

  const started = Date.now();
  const protocol = providerProtocol(settings.provider);
  const authHeaders: Record<string, string> =
    protocol === "anthropic"
      ? {
          ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
          "anthropic-version": ANTHROPIC_API_VERSION
        }
      : protocol === "gemini"
        ? settings.apiKey
          ? { "x-goog-api-key": settings.apiKey }
          : {}
        : settings.apiKey
          ? { Authorization: `Bearer ${settings.apiKey}` }
          : {};
  const modelsUrl =
    protocol === "anthropic"
      ? anthropicModelsEndpoint(settings.baseUrl)
      : protocol === "gemini"
        ? geminiModelsEndpoint(settings.baseUrl)
        : modelsEndpoint(settings.baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const models = await fetchImpl(modelsUrl, {
      headers: authHeaders,
      signal: controller.signal
    }).catch(() => null);

    if (controller.signal.aborted) {
      return { ok: false, message: `The provider did not answer within ${Math.round(timeoutMs / 1000)} seconds.` };
    }
    if (models?.ok) {
      return { ok: true, message: `Connected to ${settings.model}.`, latencyMs: Date.now() - started };
    }

    let chat: Response;
    if (protocol === "anthropic") {
      chat = await fetchImpl(anthropicMessagesEndpoint(settings.baseUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          model: settings.model,
          messages: [{ role: "user", content: "Reply with the single word: ready" }],
          max_tokens: 8
        }),
        signal: controller.signal
      });
    } else if (protocol === "gemini") {
      chat = await fetchImpl(geminiGenerateEndpoint(settings.baseUrl, settings.model), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Reply with the single word: ready" }] }],
          generationConfig: { maxOutputTokens: 8, temperature: 0 }
        }),
        signal: controller.signal
      });
    } else {
      chat = await fetchImpl(chatEndpoint(settings.baseUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          model: settings.model,
          messages: [{ role: "user", content: "Reply with the single word: ready" }],
          max_tokens: 8,
          temperature: 0
        }),
        signal: controller.signal
      });
    }

    if (!chat.ok) {
      const detail = (await chat.text().catch(() => "")).slice(0, 300);
      return { ok: false, message: `Provider rejected the request (${chat.status}). ${detail}` };
    }
    return { ok: true, message: `Connected to ${settings.model}.`, latencyMs: Date.now() - started };
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, message: `The provider did not answer within ${Math.round(timeoutMs / 1000)} seconds.` };
    }
    const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
    return { ok: false, message: `Could not reach the provider.${detail}` };
  } finally {
    clearTimeout(timer);
  }
}
