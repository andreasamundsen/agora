export type ThemePreference = "system" | "light" | "dark";

const COOKIE_NAME = "agora_theme";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function systemTheme(): "light" | "dark" {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function parseThemePreference(cookie: string): ThemePreference {
  const match = cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=(system|light|dark)`));
  return (match?.[1] as ThemePreference | undefined) ?? "system";
}

export function resolveTheme(preference: ThemePreference, systemIsDark: boolean): "light" | "dark" {
  if (preference === "system") return systemIsDark ? "dark" : "light";
  return preference;
}

export function readThemePreference(): ThemePreference {
  return parseThemePreference(document.cookie);
}

export function resolvedTheme(preference: ThemePreference): "light" | "dark" {
  return resolveTheme(preference, systemTheme() === "dark");
}

export function applyThemePreference(preference: ThemePreference, persist = true): void {
  const resolved = resolvedTheme(preference);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = preference;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = resolved === "dark" ? "#15120e" : "#eee7da";
  if (persist) {
    document.cookie = `${COOKIE_NAME}=${preference}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  }
}

let initialized = false;

export function initTheme(): void {
  if (initialized) return;
  initialized = true;

  applyThemePreference(readThemePreference(), false);

  const query = window.matchMedia?.("(prefers-color-scheme: dark)");
  query?.addEventListener?.("change", () => {
    if (readThemePreference() === "system") applyThemePreference("system", false);
  });
}
