import fs from "node:fs";
import path from "node:path";
import { isLoopbackHostname, providerUrlProblem } from "../shared/provider-url";

export type ReasoningEffort = "off" | "low" | "high" | "max";

export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsError";
  }
}

export const REASONING_EFFORTS: ReasoningEffort[] = ["off", "low", "high", "max"];

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === "off" || value === "low" || value === "high" || value === "max";
}

export interface StoredSettings {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  reasoningEffort: ReasoningEffort;
}

export interface PublicSettings {
  provider: string;
  baseUrl: string;
  model: string;
  temperature: number;
  reasoningEffort: ReasoningEffort;
  hasKey: boolean;
  ready: boolean;
  source: "settings" | "env" | "none";
  localBaseUrl: boolean;
}

const DEFAULTS: StoredSettings = {
  provider: "local",
  baseUrl: "",
  model: "",
  apiKey: "",
  temperature: 0.7,
  reasoningEffort: "high"
};

export function dataDir(): string {
  return process.env.AGORA_DATA_DIR
    ? path.resolve(process.env.AGORA_DATA_DIR)
    : path.resolve(process.cwd(), "data");
}

export function settingsFile(): string {
  return path.join(dataDir(), "settings.json");
}

function isLocalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return isLoopbackHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function readJson(file: string): Partial<StoredSettings> {
  try {
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    return {
      provider: typeof parsed.provider === "string" ? parsed.provider : undefined,
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : undefined,
      model: typeof parsed.model === "string" ? parsed.model : undefined,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : undefined,
      temperature: typeof parsed.temperature === "number" ? parsed.temperature : undefined,
      reasoningEffort: isReasoningEffort(parsed.reasoningEffort) ? parsed.reasoningEffort : undefined
    };
  } catch {
    return {};
  }
}

function envSettings(): Partial<StoredSettings> {
  // The desktop build must not silently adopt an unrelated provider key from
  // the user's environment. Development runs keep the fallback for convenience.
  if (process.env.AGORA_PACKAGED === "1") return {};
  const apiKey =
    process.env.AGORA_LLM_API_KEY ??
    process.env.OPENAI_API_KEY ??
    process.env.DEEPSEEK_API_KEY ??
    process.env.OPENROUTER_API_KEY ??
    "";
  const baseUrl =
    process.env.AGORA_LLM_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    (process.env.DEEPSEEK_API_KEY && !process.env.OPENAI_API_KEY ? "https://api.deepseek.com" : "");
  const model = process.env.AGORA_LLM_MODEL ?? process.env.OPENAI_MODEL ?? "";
  const reasoningEffort = isReasoningEffort(process.env.AGORA_LLM_REASONING_EFFORT)
    ? process.env.AGORA_LLM_REASONING_EFFORT
    : undefined;
  return {
    apiKey: apiKey || undefined,
    baseUrl: baseUrl || undefined,
    model: model || undefined,
    reasoningEffort,
    provider: apiKey ? "env" : undefined
  };
}

/** Settings file wins field-by-field; environment supplies fallbacks. */
export function getSettings(): StoredSettings {
  const file = readJson(settingsFile());
  const env = envSettings();
  return {
    provider: file.provider?.trim() || env.provider || DEFAULTS.provider,
    baseUrl: file.baseUrl?.trim() || env.baseUrl || DEFAULTS.baseUrl,
    model: file.model?.trim() || env.model || DEFAULTS.model,
    apiKey: file.apiKey?.trim() || env.apiKey || DEFAULTS.apiKey,
    temperature: file.temperature ?? DEFAULTS.temperature,
    reasoningEffort: file.reasoningEffort || env.reasoningEffort || DEFAULTS.reasoningEffort
  };
}

export function settingsSource(): "settings" | "env" | "none" {
  const file = readJson(settingsFile());
  if (file.apiKey || file.baseUrl || file.model) return "settings";
  const env = envSettings();
  if (env.apiKey || env.baseUrl || env.model) return "env";
  return "none";
}

export function isReady(settings: StoredSettings): boolean {
  if (!settings.baseUrl.trim() || !settings.model.trim()) return false;
  if (providerUrlProblem(settings.baseUrl, Boolean(settings.apiKey.trim()))) return false;
  return Boolean(settings.apiKey.trim()) || isLocalUrl(settings.baseUrl);
}

export function publicSettings(): PublicSettings {
  const s = getSettings();
  return {
    provider: s.provider,
    baseUrl: s.baseUrl,
    model: s.model,
    temperature: s.temperature,
    reasoningEffort: s.reasoningEffort,
    hasKey: Boolean(s.apiKey),
    ready: isReady(s),
    source: settingsSource(),
    localBaseUrl: isLocalUrl(s.baseUrl)
  };
}

export function saveSettings(input: Partial<StoredSettings>): PublicSettings {
  const current = getSettings();
  const next: StoredSettings = {
    provider: typeof input.provider === "string" ? input.provider.slice(0, 40) : current.provider,
    baseUrl: typeof input.baseUrl === "string" ? input.baseUrl.trim().slice(0, 300) : current.baseUrl,
    model: typeof input.model === "string" ? input.model.trim().slice(0, 120) : current.model,
    apiKey:
      typeof input.apiKey === "string" && input.apiKey.trim()
        ? input.apiKey.trim().slice(0, 300)
        : current.apiKey,
    temperature:
      typeof input.temperature === "number" && Number.isFinite(input.temperature)
        ? Math.max(0, Math.min(2, input.temperature))
        : current.temperature,
    reasoningEffort: isReasoningEffort(input.reasoningEffort)
      ? input.reasoningEffort
      : current.reasoningEffort
  };
  if (input.apiKey === "") next.apiKey = "";
  const problem = providerUrlProblem(next.baseUrl, Boolean(next.apiKey.trim()));
  if (problem) throw new SettingsError(problem);
  fs.mkdirSync(dataDir(), { recursive: true });
  const tmp = `${settingsFile()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(tmp, settingsFile());
  return publicSettings();
}

export function clearApiKey(): PublicSettings {
  return saveSettings({ apiKey: "" });
}
