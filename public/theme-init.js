(() => {
  const match = document.cookie.match(/(?:^|; )agora_theme=(system|light|dark|aurora)(?:;|$)/);
  const preference = match?.[1] || "system";
  const resolved = preference === "system"
    ? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : preference === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = preference;
  if (preference === "aurora") {
    document.documentElement.dataset.palette = "aurora";
  } else {
    delete document.documentElement.dataset.palette;
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  const color = resolved === "light" ? "#eee7da" : preference === "aurora" ? "#080b14" : "#15120e";
  if (meta) meta.setAttribute("content", color);
})();
