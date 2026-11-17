import { isLoopbackHostname } from "../shared/provider-url";

function hostnameFromHostHeader(host: string | undefined): string | null {
  if (!host) return null;
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}

function hostnameFromOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname;
  } catch {
    return null;
  }
}

/** The API must only answer requests addressed to a loopback host. */
export function isLoopbackHostHeader(host: string | undefined): boolean {
  const hostname = hostnameFromHostHeader(host);
  return hostname !== null && isLoopbackHostname(hostname);
}

/**
 * A browser may omit Origin for a same-origin request. If it supplies one,
 * it must itself be loopback; this blocks a public page from treating the
 * local API as its origin through DNS rebinding.
 */
export function isAllowedLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  const hostname = hostnameFromOrigin(origin);
  return hostname !== null && isLoopbackHostname(hostname);
}

export function isLocalApiRequest(headers: { host?: string; origin?: string }): boolean {
  return isLoopbackHostHeader(headers.host) && isAllowedLoopbackOrigin(headers.origin);
}
