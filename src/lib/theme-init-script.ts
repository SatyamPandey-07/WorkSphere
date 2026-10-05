export const THEME_INIT_SCRIPT = `
(function () {
  // Apply the saved or system theme before the browser paints the page.
  var theme = null;
  try {
    var stored = localStorage.getItem("worksphere-theme");
    if (stored === "light" || stored === "dark" || stored === "cyberpunk") {
      theme = stored;
    }
  } catch (e) {}

  if (!theme) {
    try {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    } catch (e) {
      theme = "light";
    }
  }

  var root = document.documentElement;
  root.classList.remove("dark", "cyberpunk");

  if (theme === "dark") {
    root.classList.add("dark");
  } else if (theme === "cyberpunk") {
    root.classList.add("cyberpunk");
  }

  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme === "light" ? "light" : "dark";
  root.style.backgroundColor =
    theme === "dark" ? "#0a0a0a" : theme === "cyberpunk" ? "#090014" : "#ffffff";
  root.style.color =
    theme === "dark" ? "#ededed" : theme === "cyberpunk" ? "#f4f4ff" : "#171717";
  try {
    document.cookie =
      "worksphere-theme=" + theme + "; path=/; max-age=31536000; SameSite=Lax";
  } catch (e) {}

  try {
    var accentStored = localStorage.getItem("worksphere-accent");
    var accentColors = {
      blue: "#3b82f6",
      purple: "#a855f7",
      emerald: "#10b981",
      amber: "#f59e0b"
    };
    var accent = accentColors[accentStored] || accentColors.blue;
    document.documentElement.style.setProperty("--primary-accent", accent);
  } catch {}

  try {
    window.addEventListener("error", function (event) {
      if (
        event.message &&
        (event.message.indexOf("ResizeObserver") >= 0 ||
          event.message.indexOf("Resize observer") >= 0)
      ) {
        event.stopImmediatePropagation();
      }
    });
  } catch {}

})();
`;
