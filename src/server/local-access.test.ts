import { describe, expect, it } from "vitest";
import { isAllowedLoopbackOrigin, isLocalApiRequest, isLoopbackHostHeader } from "./local-access";

describe("local API access guard", () => {
  it("accepts loopback Host headers", () => {
    expect(isLoopbackHostHeader("127.0.0.1:5173")).toBe(true);
    expect(isLoopbackHostHeader("localhost:5173")).toBe(true);
    expect(isLoopbackHostHeader("[::1]:5173")).toBe(true);
    expect(isLoopbackHostHeader("0.0.0.0:5173")).toBe(false);
  });

  it("rejects public and malformed Host headers", () => {
    expect(isLoopbackHostHeader("example.com:5173")).toBe(false);
    expect(isLoopbackHostHeader(undefined)).toBe(false);
    expect(isLoopbackHostHeader("not a host")).toBe(false);
  });

  it("requires a supplied Origin to be loopback", () => {
    expect(isAllowedLoopbackOrigin(undefined)).toBe(true);
    expect(isAllowedLoopbackOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(isAllowedLoopbackOrigin("http://localhost:5173")).toBe(true);
    expect(isAllowedLoopbackOrigin("https://attacker.example")).toBe(false);
    expect(isAllowedLoopbackOrigin("null")).toBe(false);
  });

  it("combines Host and Origin checks", () => {
    expect(isLocalApiRequest({ host: "127.0.0.1:5173" })).toBe(true);
    expect(isLocalApiRequest({ host: "127.0.0.1:5173", origin: "http://127.0.0.1:5173" })).toBe(true);
    expect(isLocalApiRequest({ host: "attacker.example:5173" })).toBe(false);
    expect(isLocalApiRequest({ host: "127.0.0.1:5173", origin: "https://attacker.example" })).toBe(false);
  });
});
