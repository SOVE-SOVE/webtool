"use client";

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { INSTAGRAM_CHECK_STATE_LABEL, instagramCheckDisplayState, type DiscoveredBusiness } from "@/lib/api";
import { hasCoordinates, type LocatedBusiness } from "@/lib/filters";

// Leaflet's default marker asset paths break under a bundler, so every
// pin is an inline SVG divIcon instead — no external image requests.
function pinIcon(selected: boolean, noWebsite: boolean): L.DivIcon {
  const fill = selected ? "#2563eb" : noWebsite ? "#ea580c" : "#94a3b8";
  const size = selected ? 30 : 24;
  return L.divIcon({
    className: "discovery-map-pin",
    html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="white" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg"><path d="M12 2c-3.87 0-7 3.13-7 7 0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5" fill="white" stroke="none"/></svg>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size + 2],
  });
}

type Located = LocatedBusiness;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// The queue action rendered inside a Leaflet popup — plain HTML (Leaflet
// popups aren't React), wired up via the `popupopen` event below. Mirrors
// the results table's own three states (imported / queued / not queued).
function popupQueueAction(b: Located, busy: boolean): string {
  if (b.status === "imported" && b.imported_lead_id) {
    return `<br/><a href="/dashboard/leads/${b.imported_lead_id}">View lead &rarr;</a>`;
  }
  if (busy) return `<br/><em>Working…</em>`;
  if (b.review_queued_at) {
    return `<br/><span data-queue-state="in-queue">In Review Queue</span> · <a href="#" data-queue-action="remove" data-queue-id="${b.id}">Remove</a>`;
  }
  return `<br/><a href="#" data-queue-action="add" data-queue-id="${b.id}">Add to Review Queue</a>`;
}

function popupHtml(b: Located, busy: boolean): string {
  const category = b.business_category || b.industry;
  const cat = category ? ` · ${esc(category)}` : "";
  const handle = b.instagram_handle
    ? `<br/><a href="${esc(b.instagram_profile_url ?? `https://instagram.com/${b.instagram_handle}`)}" target="_blank" rel="noreferrer">@${esc(b.instagram_handle)}</a>`
    : "";
  const addr = b.address ? `<br/>${esc(b.address)}` : b.suburb ? `<br/>${esc(b.suburb)}` : "";
  const phone = b.phone ? `<br/><a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>` : "";
  const igState = instagramCheckDisplayState(b);
  const site =
    b.website_status === "found" && b.website_url
      ? `<br/><a href="${esc(b.website_url)}" target="_blank" rel="noreferrer">${esc(b.website_url)}</a>`
      : igState
        ? `<br/><em>${esc(INSTAGRAM_CHECK_STATE_LABEL[igState])}</em>`
        : b.website_status === "none"
          ? `<br/><em>No website</em>`
          : "";
  const details = `<br/><a href="/dashboard/discovered-businesses/${b.id}">View details &rarr;</a>`;
  return `<strong>${esc(b.name)}</strong>${cat}${handle}${addr}${phone}${site}${details}${popupQueueAction(b, busy)}`;
}

const noWebsite = (b: Located) => b.website_status === "none";

export default function DiscoveryMap({
  businesses,
  selectedId,
  onSelect,
  mapVisible = true,
  onQueue,
  onUnqueue,
  queuingId,
}: {
  businesses: DiscoveredBusiness[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Whether this map's (permanently-mounted) container is currently
   * shown — see DiscoveryWorkspace. Toggling it back to true re-measures
   * the Leaflet instance, which otherwise keeps stale 0-size bounds from
   * whenever it was last visible. */
  mapVisible?: boolean;
  onQueue?: (id: string) => void;
  onUnqueue?: (id: string) => void;
  queuingId?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  // Live auto-pan padding shared by every popup (Leaflet reads the Point
  // when a popup opens, so mutating it is enough) — keeps popups clear of
  // the floating header layer and search panel drawn over the map.
  const popupPaddingRef = useRef<L.Point>(L.point(16, 16));
  const fittedSignatureRef = useRef<string>("");
  const wasVisibleRef = useRef(mapVisible);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  const onQueueRef = useRef(onQueue);
  const onUnqueueRef = useRef(onUnqueue);
  useEffect(() => {
    onQueueRef.current = onQueue;
    onUnqueueRef.current = onUnqueue;
  }, [onQueue, onUnqueue]);

  const located = useMemo<Located[]>(() => businesses.filter(hasCoordinates), [businesses]);

  // Create the map once.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const markers = markersRef.current;
    // Zoom buttons top-right, not Leaflet's default top-left — that corner
    // is under the floating header card and search panel. (Offset below
    // the Import button via the container's className — `!` because
    // leaflet.css is unlayered and would otherwise outrank the utility.) Attribution keeps
    // its default bottom-right spot.
    const map = L.map(containerRef.current, { scrollWheelZoom: false, zoomControl: false }).setView(
      [-25.3, 133.8],
      3,
    );
    L.control.zoom({ position: "topright" }).addTo(map);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    // Nearby businesses collapse into a counted cluster bubble — the
    // point of the map for in-person prospecting is spotting where the
    // density is.
    const cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45 });
    map.addLayer(cluster);
    // Top: the header layer's height (`--discovery-layer-h`, published by
    // DiscoveryLayout) + a gutter. Left: from `sm` up, the search-form +
    // results-panel column (25rem/400px + 0.75rem inset) occupies that
    // space regardless of whether the results panel itself is open or
    // collapsed — collapsing only shortens it, the column's *width*
    // never changes — so this doesn't need to vary with that state.
    const popupPadding = popupPaddingRef.current;
    const container = containerRef.current;
    function syncPopupPadding() {
      const layerH = parseFloat(getComputedStyle(container).getPropertyValue("--discovery-layer-h")) || 0;
      popupPadding.x = window.innerWidth >= 640 ? 428 : 16;
      popupPadding.y = layerH + 16;
    }
    syncPopupPadding();
    map.on("resize", syncPopupPadding);
    mapRef.current = map;
    clusterRef.current = cluster;
    setTimeout(() => map.invalidateSize(), 0);

    // Delegated on each popup's own element (via `popupopen`), NOT on
    // the map container — Leaflet's `Popup` calls
    // `L.DomEvent.disableClickPropagation` on its own container
    // specifically so clicks inside a popup never bubble up to the map
    // (it doesn't want a popup click to also fire a map/marker click).
    // That's exactly why a container-level delegated listener silently
    // never sees these clicks at all — confirmed live (POST .../queue
    // simply never fired). Delegating on `e.popup.getElement()` instead
    // still survives `setPopupContent` updates while the popup is open:
    // that only replaces the *inner* content node's `innerHTML`
    // (`Popup.prototype._updateContent`), never the outer element this
    // listener is bound to — so "Add to Review Queue" flipping into "In
    // Review Queue" mid-popup still has a working "Remove" link. The
    // `_queueDelegated` flag guards against double-binding if Leaflet
    // ever reuses the same element across multiple `popupopen` firings.
    function handlePopupOpen(e: L.PopupEvent) {
      const el = e.popup.getElement() as (HTMLElement & { _queueDelegated?: boolean }) | null;
      if (!el || el._queueDelegated) return;
      el._queueDelegated = true;
      el.addEventListener("click", (ev) => {
        const target = (ev.target as HTMLElement | null)?.closest("[data-queue-action]") as HTMLElement | null;
        if (!target) return;
        ev.preventDefault();
        const id = target.getAttribute("data-queue-id");
        const action = target.getAttribute("data-queue-action");
        if (!id) return;
        if (action === "add") onQueueRef.current?.(id);
        else if (action === "remove") onUnqueueRef.current?.(id);
      });
    }
    map.on("popupopen", handlePopupOpen);

    // Leaflet caches its container size and only re-measures on an
    // explicit invalidateSize() call — it has no way to notice the
    // container itself getting wider/narrower (e.g. the sidebar
    // collapse toggle resizing <main>, or a browser window resize).
    // Without this the map keeps rendering at its stale size until the
    // next full page reload. ResizeObserver catches every such change,
    // not just the sidebar's.
    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.off("popupopen", handlePopupOpen);
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
      markers.clear();
      fittedSignatureRef.current = "";
    };
  }, []);

  // Keep the markers in step with the visible (filtered) result set.
  //
  // `mapVisible` is in the dependency list purely to re-run this on a
  // hidden->visible transition (see below) — this component stays
  // mounted while CSS-`hidden` behind the Review Queue tab (see
  // DiscoveryWorkspace/DiscoveryLayout), and Leaflet can't compute a
  // meaningful `fitBounds` against a `display:none` container (it
  // reads 0x0, so the "fit" silently produces a nonsense/world-view
  // viewport). `wasVisibleRef` detects that exact transition and
  // forces a re-fit — `invalidateSize()` alone (a separate, narrower
  // fix) corrects the map's *size* cache but not a pan/zoom that was
  // already computed wrong while hidden.
  useEffect(() => {
    const cluster = clusterRef.current;
    const map = mapRef.current;
    if (!cluster || !map) return;

    if (mapVisible && !wasVisibleRef.current) {
      map.invalidateSize();
      fittedSignatureRef.current = ""; // force the fit below to re-run for real
    }
    wasVisibleRef.current = mapVisible;

    const wanted = new Set(located.map((b) => b.id));
    for (const [id, marker] of markersRef.current) {
      if (!wanted.has(id)) {
        cluster.removeLayer(marker);
        markersRef.current.delete(id);
      }
    }
    for (const b of located) {
      const busy = queuingId === b.id;
      let marker = markersRef.current.get(b.id);
      if (!marker) {
        marker = L.marker([b.latitude, b.longitude], { icon: pinIcon(false, noWebsite(b)) });
        marker.bindPopup(popupHtml(b, busy), { autoPanPaddingTopLeft: popupPaddingRef.current });
        marker.on("click", () => onSelectRef.current(b.id));
        markersRef.current.set(b.id, marker);
        cluster.addLayer(marker);
      } else {
        marker.setLatLng([b.latitude, b.longitude]);
        marker.setPopupContent(popupHtml(b, busy));
        marker.setIcon(pinIcon(b.id === selectedId, noWebsite(b)));
      }
    }

    const signature = [...wanted].sort().join(",");
    if (mapVisible && signature !== fittedSignatureRef.current && !selectedId && markersRef.current.size > 0) {
      map.fitBounds(cluster.getBounds().pad(0.2), { maxZoom: 15 });
      fittedSignatureRef.current = signature;
    }
  }, [located, selectedId, queuingId, mapVisible]);

  // Reflect the current selection: highlight + reveal + focus its marker.
  useEffect(() => {
    const cluster = clusterRef.current;
    const map = mapRef.current;
    if (!cluster || !map) return;
    for (const [id, marker] of markersRef.current) {
      const b = located.find((x) => x.id === id);
      marker.setIcon(pinIcon(id === selectedId, b ? noWebsite(b) : false));
    }
    if (selectedId) {
      const marker = markersRef.current.get(selectedId);
      if (marker) {
        cluster.zoomToShowLayer(marker, () => {
          const zoom = Math.max(map.getZoom(), 14);
          // Center on the marker, then nudge that center left by half the
          // results column's own width (the same clearance the popup's
          // own autoPan below uses) — so the marker itself lands in the
          // middle of the map area the column doesn't cover, not the
          // container's true (partly-obstructed) center.
          const offsetX = popupPaddingRef.current.x;
          if (offsetX > 0) {
            const point = map.project(marker.getLatLng(), zoom).subtract([offsetX / 2, 0]);
            map.setView(map.unproject(point, zoom), zoom, { animate: true });
          } else {
            map.setView(marker.getLatLng(), zoom, { animate: true });
          }
          marker.openPopup();
        });
      }
    }
  }, [selectedId, located]);

  return (
    // Full-viewport base layer: pinned to everything the dashboard chrome
    // leaves free — below the mobile top bar / desktop header strip,
    // above the mobile bottom nav, right of the desktop sidebar — so the
    // app navigation stays reachable. Offsets mirror dashboard/layout.tsx.
    // `left` reads the sidebar's real width from `--sidebar-w` (published
    // by Sidebar.tsx) rather than a hard-coded constant, so it tracks the
    // collapsed/expanded toggle instead of drifting out of sync with it —
    // the ResizeObserver below already re-measures Leaflet whenever this
    // resulting width changes.
    <div className="fixed inset-x-0 bottom-14 top-12 z-0 lg:bottom-0 lg:left-[var(--sidebar-w)] lg:top-11">
      <div
        ref={containerRef}
        className="h-full w-full [&_.leaflet-top.leaflet-right]:top-10!"
        aria-label="Map of discovered business locations"
      />
      {/* A small frosted note, kept clear of the attribution (bottom-right)
          and — on narrow screens — of the bottom-left results panel. */}
      {businesses.length > 0 && located.length === 0 && (
        <div className="pointer-events-none absolute bottom-24 right-3 z-[1000] max-w-xs map-glass px-3 py-2 text-xs text-fg-muted lg:bottom-9">
          No mapped locations in view — a business is pinned once its own site publishes map coordinates.
        </div>
      )}
    </div>
  );
}
