import type { Debate, DebateSummary } from "../core/model";
import type {
  JudgeStrictness,
  JudgmentRun,
  StandardOfProof
} from "../core/judgment";

export type ReasoningEffort = "off" | "low" | "high" | "max";

export interface UiSettings {
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

export class ApiError extends Error {
  issues: { message: string; line?: number }[];
  status: number;
  constructor(message: string, status: number, issues: { message: string; line?: number }[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.issues = issues;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers
    }
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const record = body as { error?: string; issues?: { message: string; line?: number }[] } | null;
    throw new ApiError(record?.error || `Request failed (${response.status})`, response.status, record?.issues ?? []);
  }
  return body as T;
}

export function fetchDebates(): Promise<{ debates: DebateSummary[] }> {
  return request("/debates");
}

export function fetchDebate(id: string): Promise<{ debate: Debate }> {
  return request(`/debates/${encodeURIComponent(id)}`);
}

export function createDebate(text: string): Promise<{ debate: Debate; engine: "llm" | "local"; warning?: string }> {
  return request("/debates", { method: "POST", body: JSON.stringify({ text }) });
}

export function deleteDebate(id: string): Promise<{ ok: boolean }> {
  return request(`/debates/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function sendChat(id: string, text: string): Promise<{ debate: Debate; engine: "llm" | "local"; warning?: string }> {
  return request(`/debates/${encodeURIComponent(id)}/chat`, { method: "POST", body: JSON.stringify({ text }) });
}

export async function fetchArgdown(id: string): Promise<string> {
  const response = await fetch(`/api/debates/${encodeURIComponent(id)}/argdown`);
  if (!response.ok) throw new ApiError("Could not export this debate", response.status);
  return response.text();
}

export function importArgdown(source: string, motion?: string): Promise<{ debate: Debate; warnings: string[] }> {
  return request("/import", { method: "POST", body: JSON.stringify({ source, motion }) });
}

export function fetchSettings(): Promise<{ settings: UiSettings }> {
  return request("/settings");
}

export function saveSettings(input: {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  temperature: number;
  reasoningEffort: ReasoningEffort;
}): Promise<{ settings: UiSettings }> {
  return request("/settings", { method: "PUT", body: JSON.stringify(input) });
}

export function testSettings(): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
  return request("/settings/test", { method: "POST" });
}

export function judgeDebate(
  id: string,
  input: { model?: string; standard: StandardOfProof; strictness: JudgeStrictness }
): Promise<{ run: JudgmentRun }> {
  return request(`/debates/${encodeURIComponent(id)}/judge`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function downloadArgdown(id: string, filename: string): Promise<void> {
  const text = await fetchArgdown(id);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
