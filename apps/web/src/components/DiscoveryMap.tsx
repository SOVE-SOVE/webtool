"use client";

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { DiscoveredBusiness } from "@/lib/api";
import { hasCoordinates, type LocatedBusiness } from "@/lib/filters";

// Leaflet's default marker asset paths break under a bundler, so every
// pin is an inline SVG divIcon instead — no external image requests.
function pinIcon(selected: boolean): L.DivIcon {
  const fill = selected ? "#2563eb" : "#94a3b8";
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

function popupHtml(b: Located): string {
  const addr = b.address ? `<br/>${esc(b.address)}` : "";
  const site = b.website_url
    ? `<br/><a href="${esc(b.website_url)}" target="_blank" rel="noreferrer">${esc(b.website_url)}</a>`
    : "";
  const details = `<br/><a href="/dashboard/discovered-businesses/${b.id}">View details &rarr;</a>`;
  return `<strong>${esc(b.name)}</strong>${addr}${site}${details}`;
}

export default function DiscoveryMap({
  businesses,
  selectedId,
  onSelect,
}: {
  businesses: DiscoveredBusiness[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const fittedSignatureRef = useRef<string>("");
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const located = useMemo<Located[]>(() => businesses.filter(hasCoordinates), [businesses]);

  // Create the map once.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const markers = markersRef.current;
    const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView([-25.3, 133.8], 3);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    // The container may get its final size a tick after mount (flex/grid).
    setTimeout(() => map.invalidateSize(), 0);
    return () => {
      map.remove();
      mapRef.current = null;
      markers.clear();
      fittedSignatureRef.current = "";
    };
  }, []);

  // Keep the markers in step with the visible (filtered) result set.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const wanted = new Set(located.map((b) => b.id));
    for (const [id, marker] of markersRef.current) {
      if (!wanted.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }
    for (const b of located) {
      let marker = markersRef.current.get(b.id);
      if (!marker) {
        marker = L.marker([b.latitude, b.longitude], { icon: pinIcon(false) }).addTo(map);
        marker.bindPopup(popupHtml(b));
        marker.on("click", () => onSelectRef.current(b.id));
        markersRef.current.set(b.id, marker);
      } else {
        marker.setLatLng([b.latitude, b.longitude]);
        marker.setPopupContent(popupHtml(b));
      }
    }

    // Re-frame the view only when the set of pins actually changed and
    // the user isn't focused on one — a selection drives its own view,
    // and a plain re-render shouldn't yank the map.
    const signature = [...wanted].sort().join(",");
    if (signature !== fittedSignatureRef.current && !selectedId && markersRef.current.size > 0) {
      const group = L.featureGroup([...markersRef.current.values()]);
      map.fitBounds(group.getBounds().pad(0.2), { maxZoom: 15 });
      fittedSignatureRef.current = signature;
    }
  }, [located, selectedId]);

  // Reflect the current selection: highlight + focus its marker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const [id, marker] of markersRef.current) {
      marker.setIcon(pinIcon(id === selectedId));
    }
    if (selectedId) {
      const marker = markersRef.current.get(selectedId);
      if (marker) {
        map.setView(marker.getLatLng(), Math.max(map.getZoom(), 13), { animate: true });
        marker.openPopup();
      }
    }
  }, [selectedId]);

  return (
    <div className="relative mt-4">
      <div
        ref={containerRef}
        className="h-72 w-full overflow-hidden rounded-md border border-border sm:h-80"
        aria-label="Map of discovered business locations"
      />
      {located.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-border bg-surface-subtle px-3 py-1.5 text-center text-xs text-fg-muted">
          No mapped locations in view — a business is pinned once its own site publishes map coordinates.
        </div>
      )}
    </div>
  );
}
