import { describe, expect, it } from "vitest";
import { parseThemePreference, resolveTheme } from "./theme";

describe("theme preference", () => {
  it("defaults to system when no theme cookie exists", () => {
    expect(parseThemePreference("")).toBe("system");
    expect(parseThemePreference("session=abc; other=1")).toBe("system");
  });

  it("reads explicit and system preferences from a cookie header", () => {
    expect(parseThemePreference("agora_theme=light")).toBe("light");
    expect(parseThemePreference("a=1; agora_theme=dark; b=2")).toBe("dark");
    expect(parseThemePreference("agora_theme=system")).toBe("system");
  });

  it("ignores invalid theme cookies", () => {
    expect(parseThemePreference("agora_theme=sepia")).toBe("system");
    expect(parseThemePreference("not_agora_theme=dark")).toBe("system");
  });

  it("resolves system against the platform appearance", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});
