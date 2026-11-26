import { modelsEndpoint, providerUrlProblem } from "../shared/provider-url";
import type { ThinkingCapability } from "../shared/thinking";
import {
  ANTHROPIC_API_VERSION,
  anthropicModelsEndpoint,
  geminiModelsEndpoint,
  providerProtocol
} from "../shared/provider-protocol";
import type { StoredSettings } from "./settings";
import { isOpenRouterSettings, loadOpenRouterCatalog } from "./openrouter-catalog";

export const PROVIDER_MODELS_TIMEOUT_MS = 15_000;

export interface ProviderModelsResult {
  ok: boolean;
  models: string[];
  capabilities?: Record<string, ThinkingCapability>;
  message?: string;
}

type FetchLike = typeof fetch;

interface ModelsPayload {
  data?: { id?: unknown; name?: unknown }[];
  models?: { id?: unknown; name?: unknown; supportedGenerationMethods?: unknown }[];
}

/**
 * Read the model catalogue for the *saved* provider configuration. The API key
 * stays on the server: the browser can request the list but never receives or
 * supplies the credential.
 */
export async function listProviderModels(
  settings: StoredSettings,
  fetchImpl: FetchLike = fetch,
  timeoutMs = PROVIDER_MODELS_TIMEOUT_MS,
  force = false
): Promise<ProviderModelsResult> {
  const problem = providerUrlProblem(settings.baseUrl, Boolean(settings.apiKey.trim()));
  if (problem) return { ok: false, models: [], message: problem };
  if (!settings.baseUrl.trim()) {
    return { ok: false, models: [], message: "Add a base URL first." };
  }

  if (isOpenRouterSettings(settings)) {
    const catalog = await loadOpenRouterCatalog(settings, { fetchImpl, timeoutMs, force });
    if (!catalog.ok) {
      return { ok: false, models: [], message: catalog.message ?? "Could not load OpenRouter models." };
    }
    return { ok: true, models: catalog.models, capabilities: catalog.capabilities };
  }

  const protocol = providerProtocol(settings.provider);
  const headers: Record<string, string> =
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
  const endpoint =
    protocol === "anthropic"
      ? anthropicModelsEndpoint(settings.baseUrl)
      : protocol === "gemini"
        ? geminiModelsEndpoint(settings.baseUrl)
        : modelsEndpoint(settings.baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(endpoint, {
      headers,
      signal: controller.signal
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      return {
        ok: false,
        models: [],
        message: `The provider did not return a model list (${response.status})${detail ? `: ${detail}` : ""}.`
      };
    }

    const payload = (await response.json().catch(() => ({}))) as ModelsPayload;
    const entries =
      protocol === "anthropic" && Array.isArray(payload.data)
        ? payload.data
        : protocol === "gemini" && Array.isArray(payload.models)
          ? payload.models
          : Array.isArray(payload.data)
            ? payload.data
            : Array.isArray(payload.models)
              ? payload.models
              : [];
    const models = Array.from(
      new Set(
        entries
          .map((entry) => {
            if (
              protocol === "gemini" &&
              "supportedGenerationMethods" in entry &&
              Array.isArray(entry.supportedGenerationMethods) &&
              !entry.supportedGenerationMethods.includes("generateContent")
            ) {
              return undefined;
            }
            const raw =
              protocol === "gemini" && typeof entry.name === "string"
                ? entry.name.replace(/^models\//, "")
                : entry.id;
            return typeof raw === "string" ? raw.trim() : undefined;
          })
          .filter((id): id is string => Boolean(id))
      )
    ).sort((a, b) => a.localeCompare(b));

    if (models.length === 0) {
      return { ok: false, models: [], message: "The provider returned no models. Enter a model ID manually." };
    }
    return { ok: true, models };
  } catch (error) {
    if (controller.signal.aborted) {
      return {
        ok: false,
        models: [],
        message: `The provider did not answer within ${Math.round(timeoutMs / 1000)} seconds.`
      };
    }
    const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
    return { ok: false, models: [], message: `Could not load the model list.${detail}` };
  } finally {
    clearTimeout(timer);
  }
}
