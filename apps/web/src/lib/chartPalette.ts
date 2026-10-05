/**
 * Chart colour customisation (Settings → Appearance → Chart colours).
 *
 * One colour per MEANING, shared by every revenue chart and the calendar
 * — the same roles `revenueChartParts.MARK` documents. A palette is a
 * set of overrides: a role with no override keeps the built-in colour
 * for the current theme (`--chart-*-default` in globals.css), so a user
 * who never customises anything sees exactly the original palette, and
 * the "Default" preset is simply the empty palette.
 *
 * Pure and DOM-free apart from `applyChartPalette`, so the rules are
 * unit-tested. Persistence lives in ThemeProvider, next to theme/font.
 */

export const CHART_ROLES = ["received", "outstanding", "overdue", "website", "hosting", "other"] as const;
export type ChartRole = (typeof CHART_ROLES)[number];

/** Lower-case `#rrggbb`. Always opaque — there is no alpha channel. */
export type Hex = string;
export type ChartPalette = Partial<Record<ChartRole, Hex>>;

export const CHART_ROLE_LABELS: Record<ChartRole, string> = {
  received: "Received",
  outstanding: "Outstanding / scheduled",
  overdue: "Overdue",
  website: "Website builds",
  hosting: "Hosting",
  other: "Other payment types",
};

/** Roles that are drawn side by side and so must be told apart: the
 * status trio (bars, calendar, breakdown ring) and the receipt
 * categories (the "Received by type" donut). */
export const CHART_ROLE_GROUPS: readonly (readonly ChartRole[])[] = [
  ["received", "outstanding", "overdue"],
  ["website", "hosting", "other"],
];

/** Hex equivalents of the built-in colours (globals.css
 * `--chart-*-default`), for showing a role's current colour in the
 * picker and for the readability checks. Keep in sync with globals.css. */
export const DEFAULT_CHART_COLOURS: Record<"light" | "dark", Record<ChartRole, Hex>> = {
  light: {
    received: "#009966",
    outstanding: "#615fff",
    overdue: "#e7000b",
    website: "#0084d1",
    hosting: "#e17100",
    other: "#9f9fa9",
  },
  dark: {
    received: "#009966",
    outstanding: "#615fff",
    overdue: "#fb2c36",
    website: "#0084d1",
    hosting: "#e17100",
    other: "#71717b",
  },
};

/** The card surface charts are drawn on (globals.css `--surface`). */
export const CHART_SURFACE: Record<"light" | "dark", Hex> = { light: "#ffffff", dark: "#171717" };

export type ChartPresetId = "default" | "ocean" | "forest" | "warm";

export const CHART_PRESETS: { id: ChartPresetId; label: string; palette: ChartPalette }[] = [
  { id: "default", label: "Default", palette: {} },
  {
    id: "ocean",
    label: "Ocean",
    palette: { received: "#0d9488", outstanding: "#2f6fed", overdue: "#e11d48", website: "#0284c7", hosting: "#8b5cf6", other: "#64748b" },
  },
  {
    id: "forest",
    label: "Forest",
    palette: { received: "#15803d", outstanding: "#0e7490", overdue: "#dc2626", website: "#4d7c0f", hosting: "#b45309", other: "#78716c" },
  },
  {
    id: "warm",
    label: "Warm",
    palette: { received: "#d97706", outstanding: "#a855f7", overdue: "#dc2626", website: "#ea580c", hosting: "#c026d3", other: "#78716c" },
  },
];

// --- HEX ------------------------------------------------------------------

/** Accepts `#rgb`, `rgb`, `#rrggbb` or `rrggbb` (any case, surrounding
 * spaces). Returns lower-case `#rrggbb`, or null when it isn't a colour
 * — callers keep their last valid colour in that case. */
export function parseHex(input: string): Hex | null {
  const raw = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw
      .split("")
      .map((c) => c + c)
      .join("")
      .toLowerCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`;
  return null;
}

export type Rgb = { r: number; g: number; b: number };
/** h: 0–360, s and v: 0–1. */
export type Hsv = { h: number; s: number; v: number };

export function hexToRgb(hex: Hex): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): Hex {
  const part = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function hexToHsv(hex: Hex): Hsv {
  const { r, g, b } = hexToRgb(hex);
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const d = max - Math.min(rn, gn, bn);
  let h = 0;
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): Hex {
  const hue = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex({ r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 });
}

// --- Palette --------------------------------------------------------------

/** Keeps only known roles with valid colours — anything else is dropped,
 * so a hand-edited or older stored value can never break the charts. */
export function sanitisePalette(value: unknown): ChartPalette {
  const out: ChartPalette = {};
  if (!value || typeof value !== "object") return out;
  for (const role of CHART_ROLES) {
    const v = (value as Record<string, unknown>)[role];
    const hex = typeof v === "string" ? parseHex(v) : null;
    if (hex) out[role] = hex;
  }
  return out;
}

/** Stored JSON → palette. Null/garbage → the default (empty) palette. */
export function parseStoredPalette(raw: string | null): ChartPalette {
  if (!raw) return {};
  try {
    return sanitisePalette(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function serialisePalette(palette: ChartPalette): string {
  return JSON.stringify(sanitisePalette(palette));
}

export function palettesEqual(a: ChartPalette, b: ChartPalette): boolean {
  return CHART_ROLES.every((role) => (a[role] ?? null) === (b[role] ?? null));
}

/** The preset a palette matches exactly, else null ("Custom"). */
export function matchingPreset(palette: ChartPalette): ChartPresetId | null {
  return CHART_PRESETS.find((p) => palettesEqual(p.palette, palette))?.id ?? null;
}

/** The colour a role is actually drawn in, for a theme. */
export function resolvedColour(palette: ChartPalette, role: ChartRole, theme: "light" | "dark"): Hex {
  return palette[role] ?? DEFAULT_CHART_COLOURS[theme][role];
}

/**
 * The CSS custom properties for a palette — EVERY chart token, always:
 * an overridden role gets its colour, any other role points back at its
 * built-in default. Complete on purpose, so setting these on a subtree
 * (the Appearance preview) fully isolates it from the applied palette.
 *
 * The softer / icon / shading tokens are derived from the one base
 * colour so a custom colour stays one colour everywhere; the defaults
 * keep their original per-theme tints (see globals.css).
 */
export function chartPaletteVars(palette: ChartPalette): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const role of CHART_ROLES) {
    vars[`--chart-${role}`] = palette[role] ?? `var(--chart-${role}-default)`;
  }
  const received = palette.received;
  vars["--chart-received-shade"] = received ?? "var(--chart-received-shade-default)";
  const overdue = palette.overdue;
  vars["--chart-overdue-soft"] = overdue ? `color-mix(in srgb, ${overdue} 85%, transparent)` : "var(--chart-overdue-soft-default)";
  vars["--chart-overdue-icon"] = overdue ?? "var(--chart-overdue-icon-default)";
  return vars;
}

/** Applies a palette to an element (the document root, for the app). */
export function applyChartPalette(el: HTMLElement, palette: ChartPalette): void {
  const vars = chartPaletteVars(palette);
  const custom = CHART_ROLES.some((role) => palette[role]);
  for (const [name, value] of Object.entries(vars)) {
    // Nothing overridden: leave the stylesheet's own values in charge.
    if (custom) el.style.setProperty(name, value);
    else el.style.removeProperty(name);
  }
}

// --- Readability checks ---------------------------------------------------

function channelToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: Hex): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

/** WCAG contrast ratio, 1–21. */
export function contrastRatio(a: Hex, b: Hex): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function toLab(hex: Hex, simulateDeuteranopia = false): [number, number, number] {
  const { r, g, b } = hexToRgb(hex);
  let [lr, lg, lb] = [channelToLinear(r), channelToLinear(g), channelToLinear(b)];
  if (simulateDeuteranopia) {
    // Machado et al. (2009), deuteranopia, severity 1.0, on linear RGB.
    [lr, lg, lb] = [
      0.367322 * lr + 0.860646 * lg - 0.227968 * lb,
      0.280085 * lr + 0.672501 * lg + 0.047413 * lb,
      -0.01182 * lr + 0.04294 * lg + 0.968881 * lb,
    ].map((v) => Math.max(0, Math.min(1, v)));
  }
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb;
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 colour difference (0 = identical; ~2 is just noticeable). */
export function colourDifference(a: Hex, b: Hex, simulateDeuteranopia = false): number {
  const [l1, a1, b1] = toLab(a, simulateDeuteranopia);
  const [l2, a2, b2] = toLab(b, simulateDeuteranopia);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** A graphical mark needs 3:1 against its background (WCAG 1.4.11). */
export const MIN_MARK_CONTRAST = 3;
/** Below this, two marks read as the same colour at chart sizes. */
export const MIN_DIFFERENCE = 18;
/** Same, as seen with red–green colour blindness (deuteranopia). */
export const MIN_CVD_DIFFERENCE = 10;

export type PaletteWarning =
  | { kind: "contrast"; role: ChartRole; theme: "light" | "dark"; ratio: number; message: string }
  | { kind: "similar"; roles: [ChartRole, ChartRole]; colourBlindOnly: boolean; message: string };

/**
 * Advisory only — never changes the palette. Checks every role against
 * the chart surface in BOTH themes (a colour is saved once and used in
 * either), and every pair of roles that share a chart. Only roles the
 * user overrode can raise a contrast warning; a pair warns when at least
 * one side is overridden. `theme` decides which default an untouched
 * role is compared as.
 */
export function paletteWarnings(palette: ChartPalette, theme: "light" | "dark"): PaletteWarning[] {
  const warnings: PaletteWarning[] = [];
  for (const role of CHART_ROLES) {
    const colour = palette[role];
    if (!colour) continue;
    for (const t of ["light", "dark"] as const) {
      const ratio = contrastRatio(colour, CHART_SURFACE[t]);
      if (ratio < MIN_MARK_CONTRAST) {
        warnings.push({
          kind: "contrast",
          role,
          theme: t,
          ratio,
          message: `${CHART_ROLE_LABELS[role]} is hard to see on the ${t} theme (${ratio.toFixed(1)}:1 against the background; 3:1 is recommended).`,
        });
      }
    }
  }
  for (const group of CHART_ROLE_GROUPS) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [a, b] = [group[i], group[j]];
        if (!palette[a] && !palette[b]) continue;
        const [ca, cb] = [resolvedColour(palette, a, theme), resolvedColour(palette, b, theme)];
        const names = `${CHART_ROLE_LABELS[a]} and ${CHART_ROLE_LABELS[b]}`;
        if (colourDifference(ca, cb) < MIN_DIFFERENCE) {
          warnings.push({ kind: "similar", roles: [a, b], colourBlindOnly: false, message: `${names} look very similar and appear in the same charts.` });
        } else if (colourDifference(ca, cb, true) < MIN_CVD_DIFFERENCE) {
          warnings.push({
            kind: "similar",
            roles: [a, b],
            colourBlindOnly: true,
            message: `${names} may be hard to tell apart with red–green colour blindness.`,
          });
        }
      }
    }
  }
  return warnings;
}
