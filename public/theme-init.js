(() => {
  const match = document.cookie.match(/(?:^|; )agora_theme=(system|light|dark)/);
  const preference = match?.[1] || "system";
  const resolved = preference === "system"
    ? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : preference;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = preference;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "dark" ? "#15120e" : "#eee7da");
})();
