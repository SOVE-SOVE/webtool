"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { ColourPicker } from "@/components/ui/ColourPicker";
import { Disclosure } from "@/components/ui/Disclosure";
import { useTheme } from "@/components/ui/ThemeProvider";
import { useToast } from "@/components/ui/ToastProvider";
import {
  CHART_PRESETS,
  CHART_ROLES,
  CHART_ROLE_LABELS,
  matchingPreset,
  paletteWarnings,
  palettesEqual,
  resolvedColour,
  type ChartPalette,
  type ChartRole,
} from "@/lib/chartPalette";
import { ChartColoursPreview } from "./ChartColoursPreview";

const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3 shrink-0 fill-none stroke-current" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 6.5 5 9l4.5-5.5" />
    </svg>
  );
}

function NoteIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className={`size-3 shrink-0 fill-none stroke-current ${className}`} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 1.75 11 10.25H1L6 1.75Z" />
      <path d="M6 5v2.25" />
      <path d="M6 8.75h.01" strokeWidth="1.6" />
    </svg>
  );
}

/**
 * Settings → Appearance → Chart colours. Presets, six per-meaning
 * swatches and Reset only ever change a DRAFT, which the "Sample data"
 * preview shows; the rest of the app keeps the applied palette until
 * "Apply colours" (ThemeProvider.setChartPalette — applied app-wide at
 * once and saved to this browser, like theme and font).
 */
export function ChartColoursSection() {
  const { chartPalette, setChartPalette, resolvedTheme } = useTheme();
  const showToast = useToast();
  const [draft, setDraft] = useState<ChartPalette>(chartPalette);
  // The applied palette the draft was last compared against. When the
  // applied one changes under us (read from storage after mount, or
  // changed in another tab) the draft follows it — unless it holds
  // unsaved edits, which are kept. Adjusted during render, as React
  // documents for state derived from a changed prop.
  const [synced, setSynced] = useState<ChartPalette>(chartPalette);
  const [notice, setNotice] = useState<"saved" | "not-saved" | null>(null);

  if (!palettesEqual(synced, chartPalette)) {
    const hadEdits = !palettesEqual(draft, synced);
    setSynced(chartPalette);
    if (!hadEdits) setDraft(chartPalette);
  }

  const dirty = !palettesEqual(draft, chartPalette);
  const presetId = matchingPreset(draft);
  const warnings = paletteWarnings(draft, resolvedTheme);
  const flagged = new Set<ChartRole>(warnings.flatMap((w) => (w.kind === "contrast" ? [w.role] : w.roles)));

  function edit(next: ChartPalette) {
    setDraft(next);
    setNotice(null);
  }

  function save(palette: ChartPalette) {
    if (setChartPalette(palette)) {
      setNotice("saved");
      showToast("Chart colours applied");
    } else {
      setNotice("not-saved");
      showToast("Colours applied, but not saved to this browser", "error");
    }
  }

  return (
    <section aria-labelledby="chart-colours-title" className="card p-4">
      <h3 id="chart-colours-title" className="section-title">
        Chart colours
      </h3>
      <p className="mt-1 text-xs text-fg-muted">
        Used by the revenue charts and the payments calendar. Saved to this browser. Nothing changes outside the preview until you apply.
      </p>

      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-3">
          <p id="chart-palette-label" className="field-label">
            Palette
          </p>
          {presetId === null && <span className="text-xs font-medium text-fg-muted">Custom</span>}
        </div>
        <div role="group" aria-labelledby="chart-palette-label" className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CHART_PRESETS.map((preset) => {
            const selected = preset.id === presetId;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => edit(preset.palette)}
                aria-pressed={selected}
                className={`toggle-pill flex min-h-11 min-w-0 flex-col justify-center gap-1.5 rounded-md border px-3 py-2 text-left text-sm ${FOCUS_RING} ${
                  selected ? "border-accent bg-accent-soft" : "border-border-strong hover:bg-surface-hover"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className={selected ? "font-medium text-fg" : "text-fg"}>{preset.label}</span>
                  {selected && <CheckIcon />}
                </span>
                {/* Default has no overrides: its strip is the built-in colours for the current theme. */}
                <span aria-hidden="true" className="flex h-2.5 overflow-hidden rounded-sm">
                  {CHART_ROLES.map((role) => (
                    <span key={role} className="flex-1" style={{ backgroundColor: preset.palette[role] ?? `var(--chart-${role}-default)` }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3">
        <Disclosure
          title="Customise"
          hint="Choose each colour yourself"
          badge={warnings.length > 0 ? <Badge tone="warning">{warnings.length === 1 ? "1 note" : `${warnings.length} notes`}</Badge> : undefined}
        >
          <ul className="grid gap-2 sm:grid-cols-2">
            {CHART_ROLES.map((role) => {
              const colour = resolvedColour(draft, role, resolvedTheme);
              const overridden = draft[role] !== undefined;
              return (
                <li key={role} className="min-w-0">
                  <ColourPicker
                    label={CHART_ROLE_LABELS[role]}
                    value={colour}
                    onChange={(hex) => edit({ ...draft, [role]: hex })}
                    className={`toggle-pill flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-md border border-border px-2 py-1.5 text-left hover:border-border-strong hover:bg-surface-hover aria-expanded:border-border-strong aria-expanded:bg-surface-hover ${FOCUS_RING}`}
                  >
                    <span
                      aria-hidden="true"
                      className="size-7 shrink-0 rounded-md border border-black/10 dark:border-white/15"
                      style={{ backgroundColor: draft[role] ?? `var(--chart-${role}-default)` }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg">{CHART_ROLE_LABELS[role]}</span>
                      <span className="block text-xs text-fg-muted">
                        <span className="font-mono uppercase">{colour}</span>
                        {!overridden && " · default"}
                      </span>
                    </span>
                    {flagged.has(role) && (
                      <span className="text-pill-warning-fg">
                        <NoteIcon />
                        <span className="sr-only">Has a readability note</span>
                      </span>
                    )}
                    <span className="sr-only">. Change colour</span>
                  </ColourPicker>
                </li>
              );
            })}
          </ul>
          {warnings.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-fg">Readability notes</p>
              <ul className="mt-1 space-y-1 text-xs text-fg-muted">
                {warnings.map((w) => (
                  <li key={w.message} className="flex items-start gap-1.5">
                    <NoteIcon className="mt-0.5 text-pill-warning-fg" />
                    <span>{w.message}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-fg-subtle">Advice only — you can still apply these colours.</p>
            </div>
          )}
        </Disclosure>
      </div>

      <div className="mt-3">
        <ChartColoursPreview palette={draft} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => edit({})} disabled={palettesEqual(draft, {})} className="btn btn-ghost -ml-2">
          Reset to default
        </button>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => edit(chartPalette)} disabled={!dirty} className="btn btn-secondary">
            Cancel
          </button>
          <button type="button" onClick={() => save(draft)} disabled={!dirty} className="btn btn-primary">
            Apply colours
          </button>
        </div>
      </div>

      {/* One line reserved, so the hint never moves the buttons above it. */}
      <div aria-live="polite" className="mt-2 min-h-4 text-xs leading-4">
        {dirty ? (
          <p className="text-fg-muted">
            <span className="font-medium text-fg">Unsaved changes.</span> Only the preview shows them until you apply.
          </p>
        ) : notice === "not-saved" ? (
          <p className="flex flex-wrap items-start gap-x-2 gap-y-1 text-fg">
            <span className="flex min-w-0 flex-1 basis-64 items-start gap-1.5">
              <NoteIcon className="mt-0.5 text-pill-warning-fg" />
              <span>
                These colours are in use for now, but couldn&apos;t be saved to this browser — they&apos;ll go back to the saved ones when you reload.
              </span>
            </span>
            <button type="button" onClick={() => save(chartPalette)} className="btn btn-secondary btn-sm">
              Try saving again
            </button>
          </p>
        ) : notice === "saved" ? (
          <p className="flex items-center gap-1.5 text-fg-muted">
            <CheckIcon />
            Applied and saved to this browser.
          </p>
        ) : null}
      </div>
    </section>
  );
}
