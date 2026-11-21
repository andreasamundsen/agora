import { describe, expect, it } from "vitest";
import { presetDraft, temperatureVisible } from "./Modals";

const savedGoogle = {
  provider: "google",
  baseUrl: "https://generativelanguage.googleapis.com",
  model: "gemini-4-hydrogen"
};

describe("Settings provider presets", () => {
  it("restores the saved model and base URL for the saved provider", () => {
    expect(presetDraft("google", savedGoogle)).toEqual({
      baseUrl: "https://generativelanguage.googleapis.com",
      model: "gemini-4-hydrogen"
    });
  });

  it("uses the preset default for a different provider", () => {
    expect(presetDraft("openai", savedGoogle)).toEqual({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini"
    });
  });

  it("leaves custom fields untouched", () => {
    expect(presetDraft("custom", savedGoogle)).toBeNull();
  });

  it("keeps local mode fields blank even if stale values were saved", () => {
    expect(presetDraft("local", {
      provider: "local",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini"
    })).toEqual({ baseUrl: "", model: "" });
  });
});

describe("Settings temperature visibility", () => {
  it("shows temperature for a non-thinking model", () => {
    expect(temperatureVisible("openai", "gpt-4o-mini")).toBe(true);
    expect(temperatureVisible("custom", "my-local-model")).toBe(true);
  });

  it("hides temperature for a thinking model", () => {
    expect(temperatureVisible("google", "gemini-4-hydrogen")).toBe(false);
    expect(temperatureVisible("openai", "o3")).toBe(false);
  });

  it("hides temperature in no-model mode and before a model is entered", () => {
    expect(temperatureVisible("local", "gpt-4o-mini")).toBe(false);
    expect(temperatureVisible("openai", "")).toBe(false);
  });
});
