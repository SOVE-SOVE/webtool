"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type Me } from "@/lib/api";
import {
  FOOTER_NAV_LINKS,
  SHEET_PRIMARY_NAV_LINKS,
  isNavLinkActive,
  type NavLink as NavLinkType,
} from "@/lib/nav";
import type { NavCounts } from "@/lib/navCounts";
import { useDismissableOverlay } from "@/lib/useDismissableOverlay";
import { CountBadge } from "@/components/ui/CountBadge";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { PrimaryNavIcon, useNavIconHoverPlay } from "@/components/nav/AnimatedNavIcon";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

/** Tracks a trigger element's viewport rect while a popover anchored to
 * it is open — recomputed on resize/scroll so the flyout stays aligned.
 * `position: fixed` (used by both flyouts below) is positioned purely
 * from this rect, so it's never clipped by the sidebar nav list's own
 * `overflow-y-auto`.
 *
 * Both flyouts are also portalled to <body>: the desktop `<aside>` is
 * `position: sticky`, which always makes it a stacking context, so a
 * z-index on anything inside it only ranks against the sidebar's own
 * children — the part of a flyout that reaches past the sidebar's edge
 * painted *under* any positioned/z-indexed main content (e.g. a lifted
 * or turning Clients card's `z-10`). From <body>, `z-40` ranks against
 * the app's real overlay layers: above page content and the z-30 top
 * bars, still below modals/side panels (z-50). */
function useTriggerRect(open: boolean, triggerRef: React.RefObject<HTMLElement | null>): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    // Stale rect while closed is harmless — every read of it downstream
    // is already gated on `open` too, and this avoids a synchronous
    // setState-in-effect on the closing render just to null it out.
    if (!open) return;
    const el = triggerRef.current;
    if (!el) return;
    const update = () => setRect(el.getBoundingClientRect());
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return rect;
}

// A collapsed row's hover/focus-revealed label tracks the trigger's
// rect only while actually shown, via useTriggerRect + a visible flag —
// see each call site below (kept inline, not a combined-object hook:
// the lint rule for the React Compiler flags *any* property access on
// an object a hook returns once that object also carries a ref, even
// to an unrelated field like a boolean or rect, as "accessing a ref
// during render"). Renders a `position: fixed` bubble — see the
// .sidebar-tooltip comment in globals.css for why this can't be plain
// CSS `absolute`.
function RowTooltip({ rect, children }: { rect: DOMRect | null; children: React.ReactNode }) {
  if (!rect) return null;
  return createPortal(
    <span
      role="tooltip"
      className="sidebar-tooltip"
      style={{ left: rect.right + 8, top: rect.top + rect.height / 2 }}
    >
      {children}
    </span>,
    document.body,
  );
}

/** Escape + focus-trap + focus-restore via the app's existing overlay
 * hook, plus outside-click-to-close (which that hook doesn't cover) —
 * the trigger itself is excluded from "outside" so clicking it to
 * close an open popover doesn't immediately reopen it. */
function usePopoverDismiss(
  open: boolean,
  onClose: () => void,
  triggerRef: React.RefObject<HTMLElement | null>,
): React.RefObject<HTMLDivElement | null> {
  const { containerRef } = useDismissableOverlay({ open, onClose });
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return containerRef;
}

function rowClasses(collapsed: boolean, active: boolean): string {
  const base =
    "group relative flex items-center rounded-md text-sm transition-colors duration-[var(--duration-fast)] ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring";
  const spacing = collapsed ? "justify-center px-2.5 py-2.5" : "gap-2.5 px-3 py-2";
  const tone = active ? "bg-accent-soft font-medium text-fg" : "text-fg-muted hover:bg-surface-hover hover:text-fg";
  return `${base} ${spacing} ${tone}`;
}

function NavRow({
  link,
  active,
  count,
  collapsed,
  onNavigate,
}: {
  link: NavLinkType;
  active: boolean;
  count?: number;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const tooltipRef = useRef<HTMLAnchorElement>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const tooltipRect = useTriggerRect(tooltipVisible, tooltipRef);
  // Hover/keyboard-focus icon animation — a no-op for rows without one
  // (Settings). Independent of `active`, which only drives colour.
  const iconPlay = useNavIconHoverPlay(link.icon);
  return (
    <Link
      ref={tooltipRef}
      href={link.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={rowClasses(collapsed, active)}
      onPointerEnter={iconPlay.onPointerEnter}
      onMouseEnter={collapsed ? () => setTooltipVisible(true) : undefined}
      onMouseLeave={collapsed ? () => setTooltipVisible(false) : undefined}
      onFocus={(e) => {
        iconPlay.onFocus(e);
        if (collapsed) setTooltipVisible(true);
      }}
      onBlur={collapsed ? () => setTooltipVisible(false) : undefined}
    >
      <PrimaryNavIcon
        name={link.icon}
        className={`h-[18px] w-[18px] shrink-0 ${active ? "text-accent" : ""}`}
        playToken={iconPlay.playToken}
        onPlayEnd={iconPlay.onPlayEnd}
      />
      <span className={collapsed ? "sr-only" : "min-w-0 flex-1 truncate"}>{link.label}</span>
      {!collapsed && <CountBadge count={count} />}
      {collapsed && !!count && (
        <span aria-hidden="true" className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-accent" />
      )}
      {collapsed && (
        <RowTooltip rect={tooltipVisible ? tooltipRect : null}>
          {link.label}
          {count ? ` (${count})` : ""}
        </RowTooltip>
      )}
    </Link>
  );
}

/** The account footer control — avatar, name, and a menu indicator that
 * opens a compact popover with workspace/role, theme, and sign out.
 * Anchored to the trigger's bottom edge (grows upward) since this row
 * sits at the very bottom of the sidebar. */
function AccountMenu({ me, collapsed }: { me: Me; collapsed: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rect = useTriggerRect(open, triggerRef);
  const panelRef = usePopoverDismiss(open, () => setOpen(false), triggerRef);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const tooltipRect = useTriggerRect(tooltipVisible, triggerRef);

  async function handleLogout() {
    await api.logout();
    router.push("/login");
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Account menu — ${me.name}`}
        className={`flex w-full items-center rounded-md py-2 text-left transition-colors duration-[var(--duration-fast)] ease-standard hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
          collapsed ? "justify-center px-2.5" : "gap-2 px-2.5"
        }`}
        onMouseEnter={collapsed ? () => setTooltipVisible(true) : undefined}
        onMouseLeave={collapsed ? () => setTooltipVisible(false) : undefined}
        onFocus={collapsed ? () => setTooltipVisible(true) : undefined}
        onBlur={collapsed ? () => setTooltipVisible(false) : undefined}
      >
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-medium text-fg"
        >
          {initials(me.name)}
        </span>
        {!collapsed && (
          <>
            <span aria-hidden="true" className="min-w-0 flex-1 truncate text-xs font-medium text-fg">
              {me.name}
            </span>
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 shrink-0 text-fg-subtle">
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </>
        )}
        {collapsed && !open && <RowTooltip rect={tooltipVisible ? tooltipRect : null}>{me.name}</RowTooltip>}
      </button>
      {open && rect && createPortal(
        <div
          ref={panelRef}
          tabIndex={-1}
          role="menu"
          aria-label="Account"
          // Grows upward from the trigger; capped to the space above it so
          // a short window scrolls the panel instead of pushing its top
          // (account details) off-screen.
          style={{
            position: "fixed",
            left: rect.left,
            bottom: window.innerHeight - rect.top + 8,
            maxHeight: Math.max(rect.top - 16, 0),
          }}
          className="z-40 w-60 overflow-y-auto rounded-md border border-border bg-surface p-3 shadow-lg animate-fade-in focus:outline-none"
        >
          <p className="truncate text-sm font-medium text-fg">{me.name}</p>
          <p className="truncate text-xs text-fg-muted">{me.email}</p>
          <p className="mt-0.5 truncate text-xs text-fg-subtle">
            {me.workspace_name} · {me.role === "admin" ? "Admin" : "Member"}
          </p>
          <div className="mt-3 border-t border-border pt-3">
            <p className="mb-1.5 text-xs font-medium text-fg-muted">Theme</p>
            <ThemeToggle />
          </div>
          <div className="mt-3 border-t border-border pt-3">
            <button
              type="button"
              onClick={handleLogout}
              role="menuitem"
              className="w-full rounded px-1 py-1 text-left text-sm text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              Sign out
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function SidebarBody({
  me,
  pathname,
  search,
  counts,
  onNavigate,
  collapsed,
}: {
  me: Me;
  pathname: string;
  search: URLSearchParams;
  counts: NavCounts | null;
  onNavigate?: () => void;
  collapsed: boolean;
}) {
  return (
    <>
      <div className={`border-b border-border py-4 ${collapsed ? "px-2.5" : "px-4"}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-sm bg-accent" />
            {!collapsed && <span className="truncate text-sm font-semibold text-fg">Web Design OS</span>}
          </div>
        </div>
        {!collapsed && <p className="mt-1 truncate text-xs text-fg-muted">{me.workspace_name}</p>}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3" aria-label="Primary">
        {SHEET_PRIMARY_NAV_LINKS.map((link) => (
          <NavRow
            key={link.href}
            link={link}
            active={isNavLinkActive(pathname, search, link)}
            count={link.countKey ? counts?.[link.countKey] : undefined}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-border px-2 py-2">
        {FOOTER_NAV_LINKS.map((link) => (
          <NavRow
            key={link.href}
            link={link}
            active={isNavLinkActive(pathname, search, link)}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ))}
        <AccountMenu me={me} collapsed={collapsed} />
      </div>
    </>
  );
}

/**
 * The dashboard's full navigation list (every destination except
 * Clients, which the bottom nav shows directly; badges; and the
 * account/theme menu), rendered inside the navigation sheet that the
 * top bar and the bottom nav's "More" open in dashboard/layout.tsx — at
 * every width, since the persistent desktop sidebar was retired in
 * favour of the bottom nav. Always expanded: `collapsed` on the rows
 * below is a leftover of the retired icon-rail mode and is always false.
 */
export function Sidebar({
  me,
  pathname,
  search,
  counts,
  onNavigate,
}: {
  me: Me;
  pathname: string;
  search: URLSearchParams;
  counts: NavCounts | null;
  onNavigate?: () => void;
}) {
  return (
    <SidebarBody
      me={me}
      pathname={pathname}
      search={search}
      counts={counts}
      onNavigate={onNavigate}
      collapsed={false}
    />
  );
}
