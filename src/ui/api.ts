import type { Debate, DebateSummary } from "../core/model";
import type {
  JudgeStrictness,
  JudgmentRun,
  SavedJudgment,
  SavedJudgmentSummary,
  StandardOfProof
} from "../core/judgment";
import type { JudgeProgressEvent } from "../shared/judge-progress";
import type { ThinkingLevel } from "../shared/thinking";

export type ReasoningEffort = ThinkingLevel;

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

export function fetchDebates(): Promise<{ debates: DebateSummary[]; warnings?: string[] }> {
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

export function saveDebate(id: string, debate: Debate): Promise<{ debate: Debate }> {
  return request(`/debates/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      motion: debate.motion,
      thesisText: debate.thesisText,
      nodes: debate.nodes,
      edges: debate.edges
    })
  });
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

export interface ProviderModelsResult {
  ok: boolean;
  models: string[];
  message?: string;
}

export function fetchProviderModels(): Promise<ProviderModelsResult> {
  return request("/settings/models");
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

export function fetchSavedJudgments(id: string): Promise<{
  judgments: SavedJudgmentSummary[];
  mapFingerprint: string;
}> {
  return request(`/debates/${encodeURIComponent(id)}/judgments`);
}

export function fetchSavedJudgment(
  debateId: string,
  runId: string
): Promise<{ judgment: SavedJudgment; stale: boolean }> {
  return request(`/debates/${encodeURIComponent(debateId)}/judgments/${encodeURIComponent(runId)}`);
}

export function saveJudgmentRun(
  debateId: string,
  run: JudgmentRun
): Promise<{ judgment: SavedJudgment; stale: boolean }> {
  return request(`/debates/${encodeURIComponent(debateId)}/judgments`, {
    method: "POST",
    body: JSON.stringify({ run })
  });
}

export function deleteSavedJudgment(debateId: string, runId: string): Promise<{ ok: boolean }> {
  return request(`/debates/${encodeURIComponent(debateId)}/judgments/${encodeURIComponent(runId)}`, {
    method: "DELETE"
  });
}

export interface JudgeStreamOptions {
  onProgress?: (event: JudgeProgressEvent) => void;
  signal?: AbortSignal;
}

/**
 * Consume the judge's NDJSON progress stream. Progress events contain work
 * status only; the final `done` event carries the completed judgment run.
 */
export async function judgeDebateStream(
  id: string,
  input: { model?: string; standard: StandardOfProof; strictness: JudgeStrictness },
  options: JudgeStreamOptions = {}
): Promise<{ run: JudgmentRun }> {
  const response = await fetch(`/api/debates/${encodeURIComponent(id)}/judge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, stream: true }),
    signal: options.signal
  });

  if (!response.ok) {
    const raw = await response.text();
    let message = `Request failed (${response.status})`;
    try {
      const body = raw ? (JSON.parse(raw) as { error?: unknown }) : null;
      if (typeof body?.error === "string" && body.error.trim()) message = body.error;
    } catch {
      // Keep the status-based message when the error body is not JSON.
    }
    throw new ApiError(message, response.status);
  }

  if (!response.body) throw new ApiError("The bench did not open a progress stream.", 500);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completedRun: JudgmentRun | null = null;

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as JudgeProgressEvent;
    if (event.type === "done") {
      completedRun = event.run;
      return;
    }
    if (event.type === "error") throw new ApiError(event.error, 500);
    options.onProgress?.(event);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        handleLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleLine(buffer);
  } finally {
    reader.releaseLock();
  }

  if (!completedRun) throw new ApiError("The bench ended before delivering a judgment.", 500);
  return { run: completedRun };
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
