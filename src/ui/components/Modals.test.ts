import { describe, expect, it } from "vitest";
import { presetDraft } from "./Modals";

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
});
