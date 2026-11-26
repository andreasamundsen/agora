import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Modal, filterModelOptions, presetDraft, temperatureVisible } from "./Modals";
import { openRouterThinkingCapability } from "../../shared/thinking";

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

  it("offers a dedicated OpenRouter preset with a tested default", () => {
    expect(presetDraft("openrouter", savedGoogle)).toEqual({
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4o-mini"
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

  it("uses OpenRouter's detected capability instead of a model-name guess", () => {
    const detected = openRouterThinkingCapability({
      supported_parameters: ["reasoning"],
      reasoning: { mandatory: false, supported_efforts: ["high", "none"] }
    });
    expect(detected.supported).toBe(true);
    expect(temperatureVisible("openai", "deepseek/any-model", detected)).toBe(false);
    const unsupported = openRouterThinkingCapability({
      supported_parameters: [],
      reasoning: null
    });
    expect(temperatureVisible("openai", "gpt-4o-mini", unsupported)).toBe(true);
  });
});

describe("Model suggestions", () => {
  const options = ["gpt-4o-mini", "gpt-5", "o3", "gemini-4-hydrogen"];

  it("shows the full list when the query is empty", () => {
    expect(filterModelOptions(options, "")).toEqual(options);
  });

  it("filters case-insensitively by substring", () => {
    expect(filterModelOptions(options, "GPT-")).toEqual(["gpt-4o-mini", "gpt-5"]);
    expect(filterModelOptions(options, "hydrogen")).toEqual(["gemini-4-hydrogen"]);
  });

  it("returns no entries when nothing matches", () => {
    expect(filterModelOptions(options, "not-a-model")).toEqual([]);
  });
});

describe("Modal close control", () => {
  const child = createElement("p", null, "Body");

  it("keeps the × disabled while busy when there is no close action", () => {
    const html = renderToStaticMarkup(
      createElement(Modal, { title: "Test", onClose: () => undefined, busy: true, children: child })
    );
    expect(html).toContain('class="modal-close"');
    expect(html).toContain("disabled");
  });

  it("enables the × while busy when the close action is the cancellation path", () => {
    const html = renderToStaticMarkup(
      createElement(Modal, {
        title: "Test",
        onClose: () => undefined,
        busy: true,
        closeAction: () => undefined,
        closeLabel: "Cancel judgment",
        children: child
      })
    );
    expect(html).toContain('aria-label="Cancel judgment"');
    expect(html).not.toContain("disabled");
  });
});
