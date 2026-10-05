import { describe, expect, it } from "vitest";
import { chartPaletteVars, type ChartPalette } from "../../lib/chartPalette";
import { CHART_PALETTE_KEY, THEME_INIT_SCRIPT } from "./ThemeProvider";

/** Runs the pre-hydration script against stub globals and returns the
 * inline custom properties it set on <html>. */
function runInitScript(stored: string | null): Record<string, string> {
  const props: Record<string, string> = {};
  const document = {
    documentElement: { dataset: {} as Record<string, string>, style: { setProperty: (k: string, v: string) => void (props[k] = v) } },
  };
  const localStorage = { getItem: (key: string) => (key === CHART_PALETTE_KEY ? stored : null) };
  const window = { matchMedia: () => ({ matches: false }) };
  new Function("document", "localStorage", "window", THEME_INIT_SCRIPT)(document, localStorage, window);
  return props;
}

describe("THEME_INIT_SCRIPT chart colours", () => {
  it("sets nothing when no colours are saved, so the built-in palette shows", () => {
    expect(runInitScript(null)).toEqual({});
    expect(runInitScript("{}")).toEqual({});
  });

  it("sets exactly what chartPaletteVars would, before first paint", () => {
    const palettes: ChartPalette[] = [
      { received: "#0d9488" },
      { overdue: "#aa00aa", other: "#64748b" },
      { received: "#15803d", outstanding: "#0e7490", overdue: "#dc2626", website: "#4d7c0f", hosting: "#b45309", other: "#78716c" },
    ];
    for (const palette of palettes) {
      expect(runInitScript(JSON.stringify(palette))).toEqual(chartPaletteVars(palette));
    }
  });

  it("ignores corrupt or invalid stored values", () => {
    expect(runInitScript("{not json")).toEqual({});
    expect(runInitScript('"red"')).toEqual({});
    expect(runInitScript(JSON.stringify({ received: "red", bogus: "#000000" }))).toEqual({});
    expect(runInitScript(JSON.stringify({ received: "red", hosting: "#123456" }))).toEqual(chartPaletteVars({ hosting: "#123456" }));
  });
});
