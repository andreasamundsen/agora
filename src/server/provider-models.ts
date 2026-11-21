import { modelsEndpoint, providerUrlProblem } from "../shared/provider-url";
import type { StoredSettings } from "./settings";

export const PROVIDER_MODELS_TIMEOUT_MS = 15_000;

export interface ProviderModelsResult {
  ok: boolean;
  models: string[];
  message?: string;
}

type FetchLike = typeof fetch;

interface ModelsPayload {
  data?: { id?: unknown }[];
  models?: { id?: unknown; name?: unknown }[];
}

/**
 * Read the model catalogue for the *saved* provider configuration. The API key
 * stays on the server: the browser can request the list but never receives or
 * supplies the credential.
 */
export async function listProviderModels(
  settings: StoredSettings,
  fetchImpl: FetchLike = fetch,
  timeoutMs = PROVIDER_MODELS_TIMEOUT_MS
): Promise<ProviderModelsResult> {
  const problem = providerUrlProblem(settings.baseUrl, Boolean(settings.apiKey.trim()));
  if (problem) return { ok: false, models: [], message: problem };
  if (!settings.baseUrl.trim()) {
    return { ok: false, models: [], message: "Add a base URL first." };
  }

  const auth: Record<string, string> = settings.apiKey
    ? { Authorization: `Bearer ${settings.apiKey}` }
    : {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(modelsEndpoint(settings.baseUrl), {
      headers: auth,
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
    const entries = Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.models)
        ? payload.models
        : [];
    const models = Array.from(
      new Set(
        entries
          .map((entry) => (typeof entry.id === "string" ? entry.id : undefined))
          .filter((id): id is string => Boolean(id && id.trim()))
          .map((id) => id.trim())
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
