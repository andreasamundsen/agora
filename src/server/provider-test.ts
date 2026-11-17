import { chatEndpoint, modelsEndpoint, providerUrlProblem } from "../shared/provider-url";
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
  const auth: Record<string, string> = settings.apiKey
    ? { Authorization: `Bearer ${settings.apiKey}` }
    : {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const models = await fetchImpl(modelsEndpoint(settings.baseUrl), {
      headers: auth,
      signal: controller.signal
    }).catch(() => null);

    if (controller.signal.aborted) {
      return { ok: false, message: `The provider did not answer within ${Math.round(timeoutMs / 1000)} seconds.` };
    }
    if (models?.ok) {
      return { ok: true, message: `Connected to ${settings.model}.`, latencyMs: Date.now() - started };
    }

    const chat = await fetchImpl(chatEndpoint(settings.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({
        model: settings.model,
        messages: [{ role: "user", content: "Reply with the single word: ready" }],
        max_tokens: 8,
        temperature: 0
      }),
      signal: controller.signal
    });

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
