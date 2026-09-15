import type { Density } from "@/lib/useDensity";

/** Same pill-toggle styling as Leads' existing List/Board control — one
 * consistent control reused across the Leads/Planning/Projects lists. */
export function DensityToggle({ density, onChange }: { density: Density; onChange: (next: Density) => void }) {
  return (
    <div className="flex rounded-md border border-border-strong p-0.5 text-sm">
      <button
        type="button"
        onClick={() => onChange("comfortable")}
        className={`rounded px-2 py-1 ${density === "comfortable" ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg"}`}
      >
        Comfortable
      </button>
      <button
        type="button"
        onClick={() => onChange("compact")}
        className={`rounded px-2 py-1 ${density === "compact" ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg"}`}
      >
        Compact
      </button>
    </div>
  );
}
