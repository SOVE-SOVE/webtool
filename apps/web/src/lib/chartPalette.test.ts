import { describe, expect, it } from "vitest";
import {
  CHART_PRESETS,
  CHART_ROLES,
  chartPaletteVars,
  colourDifference,
  contrastRatio,
  hexToHsv,
  hsvToHex,
  matchingPreset,
  paletteWarnings,
  palettesEqual,
  parseHex,
  parseStoredPalette,
  resolvedColour,
  sanitisePalette,
  serialisePalette,
} from "./chartPalette";

describe("parseHex", () => {
  it("normalises valid input", () => {
    expect(parseHex("#0D9488")).toBe("#0d9488");
    expect(parseHex("0d9488")).toBe("#0d9488");
    expect(parseHex("  #abc ")).toBe("#aabbcc");
    expect(parseHex("FFF")).toBe("#ffffff");
  });

  it("rejects anything that isn't an opaque RGB colour", () => {
    for (const bad of ["", "#", "#12", "#12345", "#1234567", "#12345678", "#ggg", "red", "rgb(0,0,0)", "#abcd"]) {
      expect(parseHex(bad)).toBeNull();
    }
  });
});

describe("hsv conversion", () => {
  it("round-trips arbitrary colours", () => {
    for (const hex of ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#0d9488", "#615fff", "#e17100", "#808080", "#123456"]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it("keeps hue when a colour is grey (callers hold the hue themselves)", () => {
    expect(hexToHsv("#808080")).toMatchObject({ h: 0, s: 0 });
    expect(hsvToHex({ h: 200, s: 0, v: 1 })).toBe("#ffffff");
    expect(hsvToHex({ h: 360, s: 1, v: 1 })).toBe("#ff0000");
  });
});

describe("stored palette", () => {
  it("treats nothing stored, garbage and non-objects as the default palette", () => {
    expect(parseStoredPalette(null)).toEqual({});
    expect(parseStoredPalette("")).toEqual({});
    expect(parseStoredPalette("{not json")).toEqual({});
    expect(parseStoredPalette('"#ff0000"')).toEqual({});
    expect(parseStoredPalette("null")).toEqual({});
  });

  it("drops unknown roles and invalid colours, keeps the rest", () => {
    expect(sanitisePalette({ received: "#ABCDEF", overdue: "nope", hosting: 5, accent: "#000000", other: "#12345678" })).toEqual({
      received: "#abcdef",
    });
  });

  it("round-trips through storage", () => {
    const palette = { received: "#0d9488", other: "#64748b" };
    expect(parseStoredPalette(serialisePalette(palette))).toEqual(palette);
    expect(serialisePalette({})).toBe("{}");
  });
});

describe("presets", () => {
  it("Default is the empty palette, so existing users keep the built-in colours", () => {
    expect(CHART_PRESETS[0]).toMatchObject({ id: "default", palette: {} });
    expect(matchingPreset({})).toBe("default");
  });

  it("every other preset sets all six roles and is recognised", () => {
    for (const preset of CHART_PRESETS.slice(1)) {
      expect(Object.keys(preset.palette).sort()).toEqual([...CHART_ROLES].sort());
      expect(matchingPreset({ ...preset.palette })).toBe(preset.id);
    }
    expect(matchingPreset({ received: "#123456" })).toBeNull();
  });

  it("every preset is readable and distinguishable in both themes", () => {
    for (const preset of CHART_PRESETS) {
      expect(paletteWarnings(preset.palette, "light"), preset.id).toEqual([]);
      expect(paletteWarnings(preset.palette, "dark"), preset.id).toEqual([]);
    }
  });
});

describe("palettesEqual / resolvedColour", () => {
  it("compares by role, treating a missing role as default", () => {
    expect(palettesEqual({}, {})).toBe(true);
    expect(palettesEqual({ received: "#111111" }, { received: "#111111" })).toBe(true);
    expect(palettesEqual({ received: "#111111" }, {})).toBe(false);
  });

  it("falls back to the theme's built-in colour", () => {
    expect(resolvedColour({}, "overdue", "light")).toBe("#e7000b");
    expect(resolvedColour({}, "overdue", "dark")).toBe("#fb2c36");
    expect(resolvedColour({ overdue: "#aa00aa" }, "overdue", "dark")).toBe("#aa00aa");
  });
});

describe("chartPaletteVars", () => {
  it("always emits every token, pointing untouched roles at their defaults", () => {
    const vars = chartPaletteVars({});
    for (const role of CHART_ROLES) expect(vars[`--chart-${role}`]).toBe(`var(--chart-${role}-default)`);
    expect(vars["--chart-received-shade"]).toBe("var(--chart-received-shade-default)");
    expect(vars["--chart-overdue-soft"]).toBe("var(--chart-overdue-soft-default)");
    expect(vars["--chart-overdue-icon"]).toBe("var(--chart-overdue-icon-default)");
    expect(Object.keys(chartPaletteVars({ received: "#111111" })).sort()).toEqual(Object.keys(vars).sort());
  });

  it("derives the shading and overdue tints from the chosen base colour", () => {
    const vars = chartPaletteVars({ received: "#0d9488", overdue: "#aa00aa" });
    expect(vars["--chart-received"]).toBe("#0d9488");
    expect(vars["--chart-received-shade"]).toBe("#0d9488");
    expect(vars["--chart-overdue"]).toBe("#aa00aa");
    expect(vars["--chart-overdue-icon"]).toBe("#aa00aa");
    expect(vars["--chart-overdue-soft"]).toBe("color-mix(in srgb, #aa00aa 85%, transparent)");
    expect(vars["--chart-website"]).toBe("var(--chart-website-default)");
  });
});

describe("readability checks", () => {
  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
  });

  it("measures colour difference", () => {
    expect(colourDifference("#123456", "#123456")).toBe(0);
    expect(colourDifference("#ff0000", "#00ff00")).toBeGreaterThan(100);
    // Red vs green collapses under deuteranopia.
    expect(colourDifference("#d03030", "#6f8f00", true)).toBeLessThan(colourDifference("#d03030", "#6f8f00"));
  });

  it("the built-in palette raises nothing", () => {
    expect(paletteWarnings({}, "light")).toEqual([]);
    expect(paletteWarnings({}, "dark")).toEqual([]);
  });

  it("warns about low contrast per theme without changing the colour", () => {
    const palette = { received: "#f8f8f8" };
    const warnings = paletteWarnings(palette, "light");
    expect(warnings.some((w) => w.kind === "contrast" && w.role === "received" && w.theme === "light")).toBe(true);
    expect(warnings.some((w) => w.kind === "contrast" && w.theme === "dark")).toBe(false);
    expect(palette).toEqual({ received: "#f8f8f8" });

    const dark = paletteWarnings({ overdue: "#1a1a1a" }, "light");
    expect(dark.some((w) => w.kind === "contrast" && w.role === "overdue" && w.theme === "dark")).toBe(true);
  });

  it("warns when two roles in the same chart are too close", () => {
    const warnings = paletteWarnings({ received: "#615fff" }, "light");
    expect(warnings).toContainEqual(expect.objectContaining({ kind: "similar", roles: ["received", "outstanding"], colourBlindOnly: false }));
  });

  it("does not compare roles that never share a chart", () => {
    // Same colour as the built-in Website blue, but Received is in a different group.
    const warnings = paletteWarnings({ received: "#0084d1" }, "light");
    expect(warnings.filter((w) => w.kind === "similar" && w.roles.includes("website"))).toEqual([]);
  });

  it("flags pairs that only collapse for colour-blind viewers", () => {
    const warnings = paletteWarnings({ received: "#6f8f00", overdue: "#d03030" }, "light");
    const pair = warnings.find((w) => w.kind === "similar" && w.roles[0] === "received" && w.roles[1] === "overdue");
    if (pair && pair.kind === "similar") expect(pair.colourBlindOnly).toBe(true);
  });
});
