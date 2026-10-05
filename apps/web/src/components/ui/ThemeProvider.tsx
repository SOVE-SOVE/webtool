"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { CHART_ROLES, applyChartPalette, parseStoredPalette, sanitisePalette, serialisePalette, type ChartPalette } from "../../lib/chartPalette";

export type ThemeMode = "light" | "dark" | "system";
export type FontChoice = "geist" | "system" | "serif" | "mono";

export const THEME_KEY = "wdos-theme";
export const FONT_KEY = "wdos-font";
export const CHART_PALETTE_KEY = "wdos-chart-colours";

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
  /** The applied chart colours (overrides only; `{}` = built-in palette). */
  chartPalette: ChartPalette;
  /** Applies a palette to the whole app immediately and saves it to this
   * browser, like theme/font. Returns false when it could NOT be saved
   * (storage blocked or full): the colours are still applied for this
   * visit, but won't survive a reload — callers must say so. */
  setChartPalette: (p: ChartPalette) => boolean;
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
  const [chartPalette, setChartPaletteState] = useState<ChartPalette>({});

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
    const storedPalette = parseStoredPalette(localStorage.getItem(CHART_PALETTE_KEY));
    setChartPaletteState(storedPalette);
    applyChartPalette(document.documentElement, storedPalette);
  }, []);

  // Another tab applied different chart colours: follow it, so two open
  // tabs never disagree about what's saved.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== CHART_PALETTE_KEY) return;
      const next = parseStoredPalette(e.newValue);
      setChartPaletteState(next);
      applyChartPalette(document.documentElement, next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
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

  const setChartPalette = useCallback((p: ChartPalette) => {
    const next = sanitisePalette(p);
    setChartPaletteState(next);
    applyChartPalette(document.documentElement, next);
    try {
      // Nothing overridden is the same state as never having customised.
      if (Object.keys(next).length === 0) localStorage.removeItem(CHART_PALETTE_KEY);
      else localStorage.setItem(CHART_PALETTE_KEY, serialisePalette(next));
      return true;
    } catch {
      return false;
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, font, setFont, chartPalette, setChartPalette }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}

/** Inline, run before hydration (see layout.tsx) — keep in sync with
 * applyTheme/applyFont above and lib/chartPalette.ts (chartPaletteVars):
 * saved chart colours are set before first paint so charts never flash
 * the built-in palette. Invalid stored values are ignored. */
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
  try {
    var saved = JSON.parse(localStorage.getItem(${JSON.stringify(CHART_PALETTE_KEY)}) || "{}") || {};
    var roles = ${JSON.stringify(CHART_ROLES)};
    var style = document.documentElement.style;
    var colours = {};
    var custom = false;
    for (var i = 0; i < roles.length; i++) {
      var v = saved[roles[i]];
      if (typeof v === "string" && /^#[0-9a-f]{6}$/.test(v)) { colours[roles[i]] = v; custom = true; }
    }
    if (custom) {
      for (var j = 0; j < roles.length; j++) {
        var role = roles[j];
        style.setProperty("--chart-" + role, colours[role] || "var(--chart-" + role + "-default)");
      }
      style.setProperty("--chart-received-shade", colours.received || "var(--chart-received-shade-default)");
      style.setProperty("--chart-overdue-soft", colours.overdue ? "color-mix(in srgb, " + colours.overdue + " 85%, transparent)" : "var(--chart-overdue-soft-default)");
      style.setProperty("--chart-overdue-icon", colours.overdue || "var(--chart-overdue-icon-default)");
    }
  } catch (e) {}
})();
`;
