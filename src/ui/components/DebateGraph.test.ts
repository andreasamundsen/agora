import { describe, expect, it } from "vitest";
import { restoredBadgeVisible } from "./DebateGraph";

describe("restoredBadgeVisible", () => {
  it("never marks the motion card as restored", () => {
    expect(restoredBadgeVisible(true, true, false)).toBe(false);
  });

  it("keeps the restoration event on ordinary argument cards", () => {
    expect(restoredBadgeVisible(false, true, false)).toBe(true);
  });

  it("does not show the marker when the card was not restored or is irrelevant", () => {
    expect(restoredBadgeVisible(false, false, false)).toBe(false);
    expect(restoredBadgeVisible(false, true, true)).toBe(false);
  });
});
