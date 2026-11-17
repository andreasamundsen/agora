export function trimBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function isLoopbackHostname(hostname: string): boolean {
  const value = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

export function providerHost(baseUrl: string): string {
  try {
    return new URL(trimBaseUrl(baseUrl)).host;
  } catch {
    return "";
  }
}

export function isLocalProvider(baseUrl: string): boolean {
  try {
    return isLoopbackHostname(new URL(trimBaseUrl(baseUrl)).hostname);
  } catch {
    return false;
  }
}

/**
 * Returns a user-facing problem with a provider URL, or null when it is usable.
 * Empty URLs are handled by the caller's readiness check.
 */
export function providerUrlProblem(baseUrl: string, hasKey: boolean): string | null {
  const trimmed = trimBaseUrl(baseUrl);
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "Base URL must start with http:// or https://.";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Base URL must start with http:// or https://.";
  }
  if (parsed.username || parsed.password) {
    return "Base URL must not include credentials.";
  }
  if (hasKey && parsed.protocol === "http:" && !isLoopbackHostname(parsed.hostname)) {
    return "Use https:// for a remote provider when an API key is present.";
  }
  return null;
}

export function chatEndpoint(baseUrl: string): string {
  const trimmed = trimBaseUrl(baseUrl);
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

export function modelsEndpoint(baseUrl: string): string {
  const trimmed = trimBaseUrl(baseUrl).replace(/\/chat\/completions$/, "");
  return `${trimmed}/models`;
}
