"use client";

import { useTheme, type ThemeMode } from "@/components/ui/ThemeProvider";

const OPTIONS: { mode: ThemeMode; label: string; icon: React.ReactNode }[] = [
  {
    mode: "light",
    label: "Light",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
        <path d="M10 3a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1Zm0 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-5a1 1 0 1 1 0 2h-1a1 1 0 1 1 0-2h1ZM4 10a1 1 0 0 1-1 1H2a1 1 0 1 1 0-2h1a1 1 0 0 1 1 1Zm11.657-5.657a1 1 0 0 1 0 1.414l-.707.707a1 1 0 1 1-1.414-1.414l.707-.707a1 1 0 0 1 1.414 0ZM6.464 13.536a1 1 0 0 1 0 1.414l-.707.707a1 1 0 0 1-1.414-1.414l.707-.707a1 1 0 0 1 1.414 0Zm9.193 1.414a1 1 0 0 1-1.414 0l-.707-.707a1 1 0 1 1 1.414-1.414l.707.707a1 1 0 0 1 0 1.414ZM6.464 6.464a1 1 0 0 1-1.414 0l-.707-.707A1 1 0 1 1 5.757 4.34l.707.707a1 1 0 0 1 0 1.414ZM10 17a1 1 0 0 1 1 1v0a1 1 0 1 1-2 0v0a1 1 0 0 1 1-1Z" />
      </svg>
    ),
  },
  {
    mode: "dark",
    label: "Dark",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
        <path d="M17.293 13.293A8 8 0 0 1 6.707 2.707a8.001 8.001 0 1 0 10.586 10.586Z" />
      </svg>
    ),
  },
  {
    mode: "system",
    label: "System",
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
        <path
          fillRule="evenodd"
          d="M2 4.75A1.75 1.75 0 0 1 3.75 3h12.5A1.75 1.75 0 0 1 18 4.75v7.5A1.75 1.75 0 0 1 16.25 14h-4.19l.5 2H14a.75.75 0 0 1 0 1.5H6a.75.75 0 0 1 0-1.5h1.44l.5-2H3.75A1.75 1.75 0 0 1 2 12.25v-7.5Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25H3.75Z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
];

/** Compact 3-way theme switch — sidebar footer, no label needed at this size. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex rounded-md border border-border-strong p-0.5" role="radiogroup" aria-label="Theme">
      {OPTIONS.map((opt) => (
        <button
          key={opt.mode}
          type="button"
          role="radio"
          aria-checked={theme === opt.mode}
          title={opt.label}
          onClick={() => setTheme(opt.mode)}
          className={`flex flex-1 items-center justify-center rounded px-2 py-1 transition-colors ${
            theme === opt.mode ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-surface-hover hover:text-fg"
          }`}
        >
          {opt.icon}
          <span className="sr-only">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}
