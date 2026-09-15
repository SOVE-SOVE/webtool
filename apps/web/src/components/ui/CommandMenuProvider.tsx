"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { loadCommandMenuData, type CommandMenuData } from "@/lib/commandMenuCache";
import { NAV_SECTIONS } from "@/lib/nav";
import { useDismissableOverlay } from "@/lib/useDismissableOverlay";
import { NavIcon } from "./Icons";

const CommandMenuContext = createContext<(() => void) | null>(null);

export function useCommandMenu(): () => void {
  const open = useContext(CommandMenuContext);
  if (!open) throw new Error("useCommandMenu must be used within CommandMenuProvider");
  return open;
}

type ResultItem = { key: string; label: string; sublabel?: string; href: string };
type ResultGroup = { label: string; items: ResultItem[] };

const MAX_PER_GROUP = 5;

function buildGroups(query: string, data: CommandMenuData | null): ResultGroup[] {
  const q = query.trim().toLowerCase();
  const navMatches = NAV_SECTIONS.flatMap((s) => s.links)
    .filter((l) => !q || l.label.toLowerCase().includes(q))
    .slice(0, MAX_PER_GROUP)
    .map((l) => ({ key: `nav:${l.href}`, label: l.label, href: l.href }));

  const groups: ResultGroup[] = [];
  if (navMatches.length > 0) groups.push({ label: "Go to", items: navMatches });

  if (!data) return groups;

  if (q) {
    const leadMatches = data.leads
      .filter((l) => l.business_name.toLowerCase().includes(q))
      .slice(0, MAX_PER_GROUP)
      .map((l) => ({ key: `lead:${l.id}`, label: l.business_name, sublabel: l.industry ?? undefined, href: `/dashboard/leads/${l.id}` }));
    if (leadMatches.length > 0) groups.push({ label: "Leads", items: leadMatches });

    const planningMatches = data.planning
      .filter((p) => p.lead_business_name.toLowerCase().includes(q))
      .slice(0, MAX_PER_GROUP)
      .map((p) => ({ key: `planning:${p.id}`, label: p.lead_business_name, href: `/dashboard/planning/${p.id}` }));
    if (planningMatches.length > 0) groups.push({ label: "Planning", items: planningMatches });

    const projectMatches = data.projects
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, MAX_PER_GROUP)
      .map((p) => ({ key: `project:${p.id}`, label: p.name, href: `/dashboard/projects/${p.id}` }));
    if (projectMatches.length > 0) groups.push({ label: "Projects", items: projectMatches });

    // A Business has no standalone page of its own in this app — it's
    // always viewed through the Lead or Project that wraps it, so a
    // match here links to whichever of those exists (skipped if
    // neither does, rather than linking somewhere wrong).
    const businessMatches = data.businesses
      .filter((b) => b.name.toLowerCase().includes(q))
      .map((b): ResultItem | null => {
        const lead = data.leads.find((l) => l.business_id === b.id);
        const project = data.projects.find((p) => p.business_id === b.id);
        const href = lead ? `/dashboard/leads/${lead.id}` : project ? `/dashboard/projects/${project.id}` : null;
        if (!href) return null;
        return { key: `business:${b.id}`, label: b.name, sublabel: b.industry ?? undefined, href };
      })
      .filter((item): item is ResultItem => item !== null)
      .slice(0, MAX_PER_GROUP);
    if (businessMatches.length > 0) groups.push({ label: "Businesses", items: businessMatches });
  }

  return groups;
}

function CommandMenu({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [data, setData] = useState<CommandMenuData | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { containerRef } = useDismissableOverlay({ open: true, onClose, initialFocusRef: inputRef });

  useEffect(() => {
    loadCommandMenuData().then(setData);
  }, []);

  const groups = useMemo(() => buildGroups(query, data), [query, data]);
  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // Reset the selection whenever the query changes — reacted to during
  // render (comparing against the previous render's query) rather than
  // in an effect, so there's no extra render pass just to zero it out.
  const [prevQuery, setPrevQuery] = useState(query);
  if (query !== prevQuery) {
    setPrevQuery(query);
    if (selectedIndex !== 0) setSelectedIndex(0);
  }

  function go(href: string) {
    router.push(href);
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flatItems[selectedIndex];
      if (item) go(item.href);
    }
  }

  return (
    <div className="modal-overlay items-start pt-24" onClick={onClose}>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="modal-panel max-w-lg p-0"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search leads, Planning, projects, businesses…"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-fg outline-none placeholder:text-fg-subtle"
        />
        <div className="max-h-96 overflow-y-auto p-2">
          {groups.length === 0 && <p className="px-2 py-4 text-sm text-fg-muted">No matches.</p>}
          {groups.map((group) => (
            <div key={group.label} className="mb-1">
              <p className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-fg-subtle">{group.label}</p>
              {group.items.map((item) => {
                const itemIndex = flatItems.findIndex((i) => i.key === item.key);
                const active = itemIndex === selectedIndex;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => go(item.href)}
                    onMouseEnter={() => setSelectedIndex(itemIndex)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                      active ? "bg-surface-hover text-fg" : "text-fg"
                    }`}
                  >
                    <span className="truncate">
                      {item.label}
                      {item.sublabel && <span className="ml-1.5 text-xs text-fg-muted">{item.sublabel}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-xs text-fg-subtle">
          <span>
            <kbd className="rounded border border-border-strong px-1">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="rounded border border-border-strong px-1">↵</kbd> open
          </span>
          <span>
            <kbd className="rounded border border-border-strong px-1">esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}

export function CommandMenuProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <CommandMenuContext.Provider value={() => setOpen(true)}>
      {children}
      {open && <CommandMenu onClose={() => setOpen(false)} />}
    </CommandMenuContext.Provider>
  );
}

/** Discoverability entry point for the command menu — the desktop header. */
export function CommandMenuButton() {
  const open = useCommandMenu();
  return (
    <button
      type="button"
      onClick={open}
      aria-label="Search (Cmd+K)"
      title="Search (Cmd+K)"
      className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg"
    >
      <NavIcon name="discovery" className="h-4 w-4" />
      <kbd className="rounded border border-border-strong px-1 text-[10px]">⌘K</kbd>
    </button>
  );
}
