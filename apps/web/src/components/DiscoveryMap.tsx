"use client";

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { DiscoveredBusiness } from "@/lib/api";

// Leaflet's default marker asset paths break under a bundler, so every
// pin is an inline SVG divIcon instead — no external image requests.
function pinIcon(selected: boolean): L.DivIcon {
  const fill = selected ? "#2563eb" : "#94a3b8";
  return L.divIcon({
    className: "discovery-map-pin",
    html: `<svg width="${selected ? 30 : 24}" height="${selected ? 30 : 24}" viewBox="0 0 24 24" fill="${fill}" stroke="white" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg"><path d="M12 2c-3.87 0-7 3.13-7 7 0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5" fill="white" stroke="none"/></svg>`,
    iconSize: selected ? [30, 30] : [24, 24],
    iconAnchor: selected ? [15, 30] : [12, 24],
    popupAnchor: [0, selected ? -28 : -22],
  });
}

type Located = DiscoveredBusiness & { latitude: number; longitude: number };

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

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
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const located = useMemo<Located[]>(
    () =>
      businesses.filter(
        (b): b is Located => typeof b.latitude === "number" && typeof b.longitude === "number",
      ),
    [businesses],
  );

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
    return () => {
      map.remove();
      mapRef.current = null;
      markers.clear();
    };
  }, []);

  // Sync markers to the current located set.
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
        const link = b.website_url
          ? `<br/><a href="${esc(b.website_url)}" target="_blank" rel="noreferrer">${esc(b.website_url)}</a>`
          : "";
        const addr = b.address ? `<br/><span>${esc(b.address)}</span>` : "";
        marker.bindPopup(`<strong>${esc(b.name)}</strong>${addr}${link}`);
        marker.on("click", () => onSelectRef.current(b.id));
        markersRef.current.set(b.id, marker);
      } else {
        marker.setLatLng([b.latitude, b.longitude]);
      }
    }

    if (markersRef.current.size > 0) {
      const group = L.featureGroup([...markersRef.current.values()]);
      map.fitBounds(group.getBounds().pad(0.2), { maxZoom: 15 });
    }
  }, [located]);

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

  if (located.length === 0) {
    return (
      <div className="mt-4 rounded-md border border-dashed border-border-strong p-4 text-center text-xs text-fg-muted">
        No mapped locations yet — a business appears here once its own site publishes map coordinates.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="mt-4 h-72 w-full overflow-hidden rounded-md border border-border sm:h-80"
      aria-label="Map of discovered business locations"
    />
  );
}
