import { modelsEndpoint, providerHost, providerUrlProblem } from "../shared/provider-url";
import {
  openRouterThinkingCapability,
  type ThinkingCapability
} from "../shared/thinking";
import type { StoredSettings } from "./settings";

export const OPENROUTER_CATALOG_TIMEOUT_MS = 15_000;
const OPENROUTER_CATALOG_TTL_MS = 5 * 60_000;

export interface OpenRouterCatalog {
  ok: boolean;
  models: string[];
  capabilities: Record<string, ThinkingCapability>;
  message?: string;
}

interface CachedCatalog {
  expiresAt: number;
  catalog: OpenRouterCatalog;
}

const cache = new Map<string, CachedCatalog>();
const inflight = new Map<string, Promise<OpenRouterCatalog>>();

/** OpenRouter can be selected by preset id or by its gateway host. */
export function isOpenRouterSettings(settings: Pick<StoredSettings, "provider" | "baseUrl">): boolean {
  if (settings.provider === "openrouter") return true;
  const host = providerHost(settings.baseUrl).toLowerCase();
  return host === "openrouter.ai" || host.startsWith("openrouter.ai:");
}

export function clearOpenRouterCatalogCache(): void {
  cache.clear();
  inflight.clear();
}

interface ModelEntry {
  id?: unknown;
  supported_parameters?: unknown;
  reasoning?: unknown;
}

/**
 * Read the reasoning capabilities OpenRouter publishes for every model.
 * The catalogue is cached because it is much larger than the identifiers the
 * settings modal needs, and it is shared by model discovery and generation.
 */
export async function loadOpenRouterCatalog(
  settings: StoredSettings,
  options: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    force?: boolean;
  } = {}
): Promise<OpenRouterCatalog> {
  if (!isOpenRouterSettings(settings)) {
    return { ok: false, models: [], capabilities: {}, message: "This is not an OpenRouter connection." };
  }
  const problem = providerUrlProblem(settings.baseUrl, Boolean(settings.apiKey.trim()));
  if (problem) {
    return { ok: false, models: [], capabilities: {}, message: problem };
  }
  const endpoint = modelsEndpoint(settings.baseUrl);
  const key = endpoint.toLowerCase();
  if (!options.force) {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.catalog;
    const pending = inflight.get(key);
    if (pending) return pending;
  }

  const task = (async (): Promise<OpenRouterCatalog> => {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? OPENROUTER_CATALOG_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {};
      if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
      const response = await (options.fetchImpl ?? fetch)(endpoint, {
        headers,
        signal: controller.signal
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 200);
        return {
          ok: false,
          models: [],
          capabilities: {},
          message: `OpenRouter did not return a model catalogue (${response.status})${detail ? `: ${detail}` : ""}.`
        };
      }
      const payload = (await response.json().catch(() => ({}))) as { data?: unknown };
      const entries = Array.isArray(payload.data) ? payload.data : [];
      const models: string[] = [];
      const capabilities: Record<string, ThinkingCapability> = {};
      for (const raw of entries) {
        if (!raw || typeof raw !== "object") continue;
        const entry = raw as ModelEntry;
        const id = typeof entry.id === "string" ? entry.id.trim() : "";
        if (!id) continue;
        models.push(id);
        capabilities[id] = openRouterThinkingCapability(entry);
      }
      const unique = Array.from(new Set(models)).sort((a, b) => a.localeCompare(b));
      const catalog: OpenRouterCatalog = { ok: true, models: unique, capabilities };
      if (unique.length === 0) {
        return {
          ok: false,
          models: [],
          capabilities: {},
          message: "OpenRouter returned no models. Enter a model ID manually."
        };
      }
      cache.set(key, { expiresAt: Date.now() + OPENROUTER_CATALOG_TTL_MS, catalog });
      return catalog;
    } catch (error) {
      if (controller.signal.aborted) {
        return {
          ok: false,
          models: [],
          capabilities: {},
          message: `OpenRouter did not answer within ${Math.round(timeoutMs / 1000)} seconds.`
        };
      }
      const detail = error instanceof Error && error.message ? ` ${error.message}` : "";
      return {
        ok: false,
        models: [],
        capabilities: {},
        message: `Could not load OpenRouter's model catalogue.${detail}`
      };
    } finally {
      clearTimeout(timer);
    }
  })();

  inflight.set(key, task);
  try {
    return await task;
  } finally {
    if (inflight.get(key) === task) inflight.delete(key);
  }
}

export async function openRouterCapabilityFor(
  settings: StoredSettings,
  model: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<ThinkingCapability | undefined> {
  const catalog = await loadOpenRouterCatalog(settings, options);
  return catalog.ok ? catalog.capabilities[model.trim()] : undefined;
}
