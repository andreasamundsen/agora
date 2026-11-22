export type ThemePreference = "system" | "light" | "dark" | "aurora";
export type ResolvedTheme = "light" | "dark";
export type ThemePalette = "night" | "aurora";

const COOKIE_NAME = "agora_theme";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const LIGHT_THEME_COLOR = "#eee7da";
const DARK_THEME_COLOR = "#15120e";
const AURORA_THEME_COLOR = "#08090b";

function systemTheme(): "light" | "dark" {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function parseThemePreference(cookie: string): ThemePreference {
  const match = cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=(system|light|dark|aurora)(?:;|$)`));
  return (match?.[1] as ThemePreference | undefined) ?? "system";
}

export function resolveTheme(preference: ThemePreference, systemIsDark: boolean): ResolvedTheme {
  if (preference === "system") return systemIsDark ? "dark" : "light";
  return preference === "light" ? "light" : "dark";
}

export function themePalette(preference: ThemePreference): ThemePalette {
  return preference === "aurora" ? "aurora" : "night";
}

export function readThemePreference(): ThemePreference {
  return parseThemePreference(document.cookie);
}

export function resolvedTheme(preference: ThemePreference): ResolvedTheme {
  return resolveTheme(preference, systemTheme() === "dark");
}

function themeColor(preference: ThemePreference, resolved: ResolvedTheme): string {
  if (resolved === "light") return LIGHT_THEME_COLOR;
  return preference === "aurora" ? AURORA_THEME_COLOR : DARK_THEME_COLOR;
}

export function applyThemePreference(preference: ThemePreference, persist = true): void {
  const resolved = resolvedTheme(preference);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = preference;
  if (themePalette(preference) === "aurora") {
    document.documentElement.dataset.palette = "aurora";
  } else {
    delete document.documentElement.dataset.palette;
  }
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = themeColor(preference, resolved);
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
