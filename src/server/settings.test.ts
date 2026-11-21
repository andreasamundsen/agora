import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSettings, saveSettings, SettingsError } from "./settings";

const PROVIDER_ENV = [
  "AGORA_PACKAGED",
  "AGORA_LLM_API_KEY",
  "AGORA_LLM_BASE_URL",
  "AGORA_LLM_MODEL",
  "AGORA_LLM_REASONING_EFFORT",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "DEEPSEEK_API_KEY",
  "OPENROUTER_API_KEY"
];

let tempDir = "";
let previous: Record<string, string | undefined> = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agora-settings-"));
  previous = {};
  for (const name of [...PROVIDER_ENV, "AGORA_DATA_DIR"]) {
    previous[name] = process.env[name];
    delete process.env[name];
  }
  process.env.AGORA_DATA_DIR = tempDir;
});

afterEach(() => {
  for (const name of [...PROVIDER_ENV, "AGORA_DATA_DIR"]) {
    if (previous[name] === undefined) delete process.env[name];
    else process.env[name] = previous[name];
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("settings", () => {
  it("ignores ambient provider keys in a packaged build", () => {
    process.env.OPENAI_API_KEY = "ambient-test-key";
    process.env.AGORA_PACKAGED = "1";
    expect(getSettings().apiKey).toBe("");
  });

  it("keeps the environment fallback for development", () => {
    process.env.OPENAI_API_KEY = "ambient-test-key";
    expect(getSettings().apiKey).toBe("ambient-test-key");
  });

  it("rejects cleartext remote URLs when saving a key", () => {
    expect(() =>
      saveSettings({
        provider: "custom",
        baseUrl: "http://example.com/v1",
        model: "test-model",
        apiKey: "test-key"
      })
    ).toThrow(SettingsError);
    expect(fs.existsSync(path.join(tempDir, "settings.json"))).toBe(false);
  });

  it("allows a local HTTP provider with a key", () => {
    const saved = saveSettings({
      provider: "custom",
      baseUrl: "http://localhost:1234/v1",
      model: "local-model",
      apiKey: "test-key"
    });
    expect(saved.ready).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "settings.json"))).toBe(true);
  });

  it("persists the extended thinking ladder", () => {
    const saved = saveSettings({
      provider: "xai",
      baseUrl: "https://api.x.ai/v1",
      model: "grok-4.7",
      apiKey: "test-key",
      reasoningEffort: "medium"
    });
    expect(saved.reasoningEffort).toBe("medium");
    expect(getSettings().reasoningEffort).toBe("medium");
  });
});
