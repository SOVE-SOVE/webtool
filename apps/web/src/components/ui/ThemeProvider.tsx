"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type FontChoice = "geist" | "system" | "serif" | "mono";

export const THEME_KEY = "wdos-theme";
export const FONT_KEY = "wdos-font";

export const FONT_LABELS: Record<FontChoice, string> = {
  geist: "Geist (default)",
  system: "System UI",
  serif: "Serif",
  mono: "Monospace",
};

type ThemeContextValue = {
  theme: ThemeMode;
  resolvedTheme: "light" | "dark";
  setTheme: (t: ThemeMode) => void;
  font: FontChoice;
  setFont: (f: FontChoice) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme: ThemeMode): "light" | "dark" {
  const resolved = theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

function applyFont(font: FontChoice) {
  if (font === "geist") delete document.documentElement.dataset.font;
  else document.documentElement.dataset.font = font;
}

/**
 * Wraps the app to make theme/font a controlled, persisted setting.
 * The actual light/dark class is set twice: once synchronously by the
 * inline script in layout.tsx (before paint, so there's no flash of the
 * wrong theme), and again here on mount so React's state matches the
 * DOM and stays in sync afterwards (toggle clicks, OS theme changes).
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [font, setFontState] = useState<FontChoice>("geist");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    // Deliberately deferred to an effect, not a lazy useState initializer:
    // the server has no localStorage, so reading it during render would
    // make the first client render disagree with the server-rendered
    // markup and trigger a hydration mismatch. The DOM theme attribute
    // itself has no such flash — THEME_INIT_SCRIPT already set it before
    // this component ever mounts.
    const storedTheme = (localStorage.getItem(THEME_KEY) as ThemeMode | null) ?? "system";
    const storedFont = (localStorage.getItem(FONT_KEY) as FontChoice | null) ?? "geist";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(storedTheme);
    setFontState(storedFont);
    setResolvedTheme(applyTheme(storedTheme));
    applyFont(storedFont);
  }, []);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolvedTheme(applyTheme("system"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((t: ThemeMode) => {
    setThemeState(t);
    localStorage.setItem(THEME_KEY, t);
    setResolvedTheme(applyTheme(t));
  }, []);

  const setFont = useCallback((f: FontChoice) => {
    setFontState(f);
    localStorage.setItem(FONT_KEY, f);
    applyFont(f);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, font, setFont }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}

/** Inline, run before hydration (see layout.tsx) — keep in sync with applyTheme/applyFont above. */
export const THEME_INIT_SCRIPT = `
(function() {
  try {
    var theme = localStorage.getItem(${JSON.stringify(THEME_KEY)}) || "system";
    var font = localStorage.getItem(${JSON.stringify(FONT_KEY)}) || "geist";
    var resolved = theme === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : theme;
    document.documentElement.dataset.theme = resolved;
    if (font !== "geist") document.documentElement.dataset.font = font;
  } catch (e) {}
})();
`;
